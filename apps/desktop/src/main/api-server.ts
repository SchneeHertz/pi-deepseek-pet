import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_API_PORT,
  HeartbeatSchema,
  MAX_JSON_BODY_BYTES,
  PROTOCOL_VERSION,
  PetActionSchema,
  PetSettingsPatchSchema,
  SourceIdSchema,
  SourceStateSchema,
  TransientEventSchema,
  type AnimationCatalog,
  type ApiErrorCode,
  type PetAction,
  type PetSettings,
  type PetSettingsPatch,
} from '@pi-deepseek-pet/protocol';
import type { output, ZodTypeAny } from 'zod';
import type { SourceRegistry } from './source-registry.js';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface AuditEntry {
  requestId: string;
  method: string;
  path: string;
  status: number;
}

export interface PetApiOptions {
  token: string;
  appInstanceId: string;
  appVersion: string;
  registry: SourceRegistry;
  animations: AnimationCatalog;
  getSettings: () => PetSettings;
  updateSettings: (patch: PetSettingsPatch) => Promise<PetSettings>;
  handleAction: (action: PetAction) => Promise<void> | void;
  preferredPort?: number;
  audit?: (entry: AuditEntry) => void;
}

interface RateBucket {
  startedAt: number;
  count: number;
}

export class PetApiServer {
  readonly #options: PetApiOptions;
  readonly #server: Server;
  readonly #rateBuckets = new Map<string, RateBucket>();
  #baseUrl?: string;

  constructor(options: PetApiOptions) {
    this.#options = options;
    this.#server = createServer((request, response) => void this.#route(request, response));
    this.#server.requestTimeout = 2_000;
    this.#server.headersTimeout = 2_000;
    this.#server.keepAliveTimeout = 1_000;
  }

  get baseUrl(): string {
    if (!this.#baseUrl) throw new Error('API server has not started');
    return this.#baseUrl;
  }

  async start(): Promise<string> {
    const preferredPort = this.#options.preferredPort ?? DEFAULT_API_PORT;
    try {
      await this.#listen(preferredPort);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      await this.#listen(0);
    }
    const address = this.#server.address() as AddressInfo;
    this.#baseUrl = `http://127.0.0.1:${address.port}`;
    return this.#baseUrl;
  }

  async stop(): Promise<void> {
    if (!this.#server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
      this.#server.closeAllConnections();
    });
    this.#baseUrl = undefined;
  }

  async #listen(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        this.#server.off('error', onError);
        resolve();
      };
      this.#server.once('error', onError);
      this.#server.once('listening', onListening);
      this.#server.listen({ host: '127.0.0.1', port, exclusive: true });
    });
  }

  async #route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const method = request.method ?? 'GET';
    let path = '/';
    let status = 500;
    response.on('finish', () => {
      status = response.statusCode;
      this.#options.audit?.({ requestId, method, path, status });
    });

    try {
      if (!this.#isLoopback(request.socket.remoteAddress)) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Only loopback clients are allowed');
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      path = url.pathname;

      if (method === 'GET' && path === '/api/v1/health') {
        this.#sendJson(response, 200, {
          app: 'Pi DeepSeek Pet',
          appVersion: this.#options.appVersion,
          protocolVersion: PROTOCOL_VERSION,
          appInstanceId: this.#options.appInstanceId,
          status: 'ok',
        });
        return;
      }

      if (request.headers.origin !== undefined) {
        throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Browser-originated control requests are not allowed');
      }
      if (!this.#isAuthorized(request.headers.authorization)) {
        throw new HttpError(401, 'UNAUTHORIZED', 'A valid bearer token is required');
      }

      if (method === 'GET' && path === '/api/v1/state') {
        this.#sendJson(response, 200, {
          protocolVersion: PROTOCOL_VERSION,
          presentation: this.#options.registry.presentation,
          ...this.#options.registry.diagnostics(),
          settings: this.#options.getSettings(),
        });
        return;
      }

      if (method === 'GET' && path === '/api/v1/animations') {
        this.#sendJson(response, 200, this.#options.animations);
        return;
      }

      const sourceMatch = path.match(/^\/api\/v1\/sources\/([^/]+)(?:\/(state|heartbeat|events))?$/u);
      if (sourceMatch) {
        const sourceId = SourceIdSchema.parse(decodeURIComponent(sourceMatch[1]!));
        const operation = sourceMatch[2];
        this.#checkRate(`${sourceId}:${operation ?? 'delete'}`, operation === 'heartbeat' ? 12 : 120);

        if (method === 'PUT' && operation === 'state') {
          const body = await this.#readJson(request, SourceStateSchema);
          const result = this.#options.registry.putState(sourceId, body);
          if (!result.ok)
            throw new HttpError(409, 'SEQUENCE_CONFLICT', `Current sequence is ${result.currentSequence}`);
          this.#sendJson(response, 200, { ok: true, duplicate: result.duplicate });
          return;
        }
        if (method === 'POST' && operation === 'heartbeat') {
          await this.#readJson(request, HeartbeatSchema);
          if (!this.#options.registry.heartbeat(sourceId)) throw new HttpError(404, 'NOT_FOUND', 'Source not found');
          this.#sendJson(response, 200, { ok: true });
          return;
        }
        if (method === 'POST' && operation === 'events') {
          const body = await this.#readJson(request, TransientEventSchema);
          const result = this.#options.registry.postEvent(sourceId, body);
          if (!result) throw new HttpError(404, 'NOT_FOUND', 'Source not found');
          if (!result.ok)
            throw new HttpError(409, 'SEQUENCE_CONFLICT', `Current sequence is ${result.currentSequence}`);
          this.#sendJson(response, 202, { ok: true, duplicate: result.duplicate });
          return;
        }
        if (method === 'DELETE' && operation === undefined) {
          if (!this.#options.registry.delete(sourceId)) throw new HttpError(404, 'NOT_FOUND', 'Source not found');
          this.#sendJson(response, 200, { ok: true });
          return;
        }
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed for source route');
      }

      if (method === 'POST' && path === '/api/v1/pet/actions') {
        this.#checkRate('pet-actions', 30);
        const action = await this.#readJson(request, PetActionSchema);
        if (action.type === 'play' && !this.#options.animations.animations.includes(action.animation)) {
          throw new HttpError(404, 'NOT_FOUND', 'Animation is not in the manifest');
        }
        await this.#options.handleAction(action);
        this.#sendJson(response, 202, { ok: true });
        return;
      }

      if (method === 'PATCH' && path === '/api/v1/pet/settings') {
        this.#checkRate('pet-settings', 30);
        const patch = await this.#readJson(request, PetSettingsPatchSchema);
        const settings = await this.#options.updateSettings(patch);
        this.#sendJson(response, 200, { ok: true, settings });
        return;
      }

      throw new HttpError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      const normalized = this.#normalizeError(error);
      this.#sendError(response, normalized.status, normalized.code, normalized.message, requestId);
    }
  }

  async #readJson<TSchema extends ZodTypeAny>(request: IncomingMessage, schema: TSchema): Promise<output<TSchema>> {
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    }
    const contentLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 16KB');
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      size += chunk.length;
      if (size <= MAX_JSON_BODY_BYTES) chunks.push(chunk);
    }
    if (size > MAX_JSON_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 16KB');

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new HttpError(400, 'INVALID_REQUEST', 'Request body is not valid JSON');
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const summary = result.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw new HttpError(400, 'INVALID_REQUEST', summary);
    }
    return result.data;
  }

  #checkRate(key: string, maximum: number): void {
    const now = Date.now();
    const current = this.#rateBuckets.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.#rateBuckets.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maximum) throw new HttpError(429, 'RATE_LIMITED', 'Request rate limit exceeded');
  }

  #isAuthorized(header: string | undefined): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(header.slice(7), 'utf8');
    const expected = Buffer.from(this.#options.token, 'utf8');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  #isLoopback(address: string | undefined): boolean {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  }

  #normalizeError(error: unknown): HttpError {
    if (error instanceof HttpError) return error;
    if (error && typeof error === 'object' && 'issues' in error) {
      return new HttpError(400, 'INVALID_REQUEST', 'Request parameters are invalid');
    }
    console.error('[pi-deepseek-pet] API request failed:', error);
    return new HttpError(500, 'INTERNAL_ERROR', 'Internal server error');
  }

  #sendError(response: ServerResponse, status: number, code: ApiErrorCode, message: string, requestId: string): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    this.#sendJson(response, status, { error: { code, message, requestId } });
  }

  #sendJson(response: ServerResponse, status: number, value: unknown): void {
    const body = JSON.stringify(value);
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(body);
  }
}
