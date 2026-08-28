import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  BridgeDescriptorSchema,
  HEARTBEAT_INTERVAL_MS,
  HeartbeatSchema,
  type BridgeDescriptor,
  type SourceState,
  type TransientEvent,
} from '@pi-deepseek-pet/protocol';

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const EVENT_MAX_AGE_MS = 2 * 60_000;

export interface TransportDiagnostics {
  bridgeFile: string;
  connected: boolean;
  enabled: boolean;
  stateQueued: boolean;
  eventQueueLength: number;
  lastError?: string;
}

export interface TransportOptions {
  sourceId: string;
  bridgeFile?: string;
  fetch?: typeof fetch;
  readBridge?: () => Promise<BridgeDescriptor | undefined>;
  now?: () => number;
  timeoutMs?: number;
  debug?: boolean;
}

interface QueuedEvent {
  event: TransientEvent;
  expiresAt: number;
}

export class PiPetTransport {
  readonly #sourceId: string;
  readonly #bridgeFile: string;
  readonly #fetch: typeof fetch;
  readonly #readBridgeOverride?: () => Promise<BridgeDescriptor | undefined>;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #debug: boolean;
  #currentState?: SourceState;
  #latestState?: SourceState;
  #events: QueuedEvent[] = [];
  #active = false;
  #enabled: boolean;
  #connected = false;
  #lastError?: string;
  #lastDebugAt = 0;
  #backoffIndex = 0;
  #flushTimer?: ReturnType<typeof setTimeout>;
  #heartbeatTimer?: ReturnType<typeof setInterval>;
  #flushing = false;
  #abortControllers = new Set<AbortController>();
  #lastAppInstanceId?: string;

  constructor(options: TransportOptions) {
    this.#sourceId = options.sourceId;
    this.#bridgeFile = options.bridgeFile ?? defaultBridgeFile();
    this.#fetch = options.fetch ?? fetch;
    this.#readBridgeOverride = options.readBridge;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? 450;
    this.#debug = options.debug ?? false;
    this.#enabled = process.env.PI_DEEPSEEK_PET_DISABLED !== '1';
  }

  get diagnostics(): TransportDiagnostics {
    return {
      bridgeFile: this.#bridgeFile,
      connected: this.#connected,
      enabled: this.#enabled,
      stateQueued: this.#latestState !== undefined,
      eventQueueLength: this.#events.length,
      lastError: this.#lastError,
    };
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    if (!this.#enabled) return;
    this.#heartbeatTimer = setInterval(() => this.#schedule(0), HEARTBEAT_INTERVAL_MS);
    this.#heartbeatTimer.unref?.();
    this.#schedule(0);
  }

  publishState(state: SourceState): void {
    this.#currentState = state;
    this.#latestState = state;
    this.#schedule(0);
  }

  publishEvent(event: TransientEvent): void {
    this.#events.push({ event, expiresAt: this.#now() + EVENT_MAX_AGE_MS });
    if (this.#events.length > 20) this.#events.shift();
    this.#schedule(0);
  }

  enable(): void {
    this.#enabled = true;
    if (this.#active && !this.#heartbeatTimer) {
      this.#heartbeatTimer = setInterval(() => this.#schedule(0), HEARTBEAT_INTERVAL_MS);
      this.#heartbeatTimer.unref?.();
    }
    this.forceReconnect();
  }

  async disable(): Promise<void> {
    this.#enabled = false;
    this.#connected = false;
    this.#clearTimers();
    for (const controller of this.#abortControllers) controller.abort();
    this.#abortControllers.clear();
    await this.#deleteSource();
  }

  forceReconnect(): void {
    this.#backoffIndex = 0;
    this.#lastError = undefined;
    if (this.#currentState) this.#latestState = this.#currentState;
    this.#schedule(0, true);
  }

  async stop(): Promise<void> {
    this.#active = false;
    this.#clearTimers();
    for (const controller of this.#abortControllers) controller.abort();
    this.#abortControllers.clear();
    if (this.#enabled) await this.#deleteSource();
    this.#connected = false;
  }

  #schedule(delayMs: number, replace = false): void {
    if (!this.#active || !this.#enabled) return;
    if (this.#flushTimer && !replace) return;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = undefined;
      void this.#flush();
    }, delayMs);
    this.#flushTimer.unref?.();
  }

  async #flush(): Promise<void> {
    if (this.#flushing || !this.#active || !this.#enabled) return;
    this.#flushing = true;
    try {
      this.#events = this.#events.filter((queued) => queued.expiresAt > this.#now());
      const bridge = await this.#readBridge();
      if (!bridge) throw new Error('bridge file is unavailable');
      if (bridge.appInstanceId !== this.#lastAppInstanceId && this.#currentState) {
        this.#latestState = this.#currentState;
      }
      this.#lastAppInstanceId = bridge.appInstanceId;

      const state = this.#latestState;
      if (state) {
        await this.#request(bridge, `/api/v1/sources/${this.#sourceId}/state`, 'PUT', state);
        if (this.#latestState === state) this.#latestState = undefined;
      }

      while (this.#events.length > 0) {
        const queued = this.#events[0]!;
        await this.#request(bridge, `/api/v1/sources/${this.#sourceId}/events`, 'POST', queued.event);
        if (this.#events[0] === queued) this.#events.shift();
      }

      if (!state && this.#events.length === 0) {
        await this.#request(
          bridge,
          `/api/v1/sources/${this.#sourceId}/heartbeat`,
          'POST',
          HeartbeatSchema.parse({ protocolVersion: 1, sentAt: new Date(this.#now()).toISOString() }),
        );
      }
      this.#connected = true;
      this.#lastError = undefined;
      this.#backoffIndex = 0;
      if (this.#latestState || this.#events.length > 0) this.#schedule(0);
    } catch (error) {
      this.#connected = false;
      if (this.#currentState) this.#latestState = this.#currentState;
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#debugError(this.#lastError);
      const delay = BACKOFF_MS[Math.min(this.#backoffIndex, BACKOFF_MS.length - 1)]!;
      this.#backoffIndex = Math.min(this.#backoffIndex + 1, BACKOFF_MS.length - 1);
      this.#schedule(delay, true);
    } finally {
      this.#flushing = false;
    }
  }

  async #request(bridge: BridgeDescriptor, path: string, method: string, body?: unknown): Promise<void> {
    const controller = new AbortController();
    this.#abortControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    timer.unref?.();
    try {
      const response = await this.#fetch(`${bridge.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bridge.token}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`desktop API returned HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
      this.#abortControllers.delete(controller);
    }
  }

  async #readBridge(): Promise<BridgeDescriptor | undefined> {
    if (this.#readBridgeOverride) return this.#readBridgeOverride();
    try {
      return BridgeDescriptorSchema.parse(JSON.parse(await readFile(this.#bridgeFile, 'utf8')) as unknown);
    } catch {
      return undefined;
    }
  }

  async #deleteSource(): Promise<void> {
    const bridge = await this.#readBridge().catch(() => undefined);
    if (!bridge) return;
    await this.#request(bridge, `/api/v1/sources/${this.#sourceId}`, 'DELETE').catch(() => undefined);
  }

  #clearTimers(): void {
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#flushTimer = undefined;
    this.#heartbeatTimer = undefined;
  }

  #debugError(message: string): void {
    if (!this.#debug || this.#now() - this.#lastDebugAt < 30_000) return;
    this.#lastDebugAt = this.#now();
    console.debug(`[pi-deepseek-pet] transport unavailable: ${message}`);
  }
}

export function defaultBridgeFile(): string {
  return process.env.PI_DEEPSEEK_PET_BRIDGE_FILE
    ? resolve(process.env.PI_DEEPSEEK_PET_BRIDGE_FILE)
    : join(homedir(), '.pi-deepseek-pet', 'bridge-v1.json');
}
