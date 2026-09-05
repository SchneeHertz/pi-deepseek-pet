import { z } from 'zod';
import {
  API_ERROR_CODES,
  MAX_BUBBLE_DURATION_MS,
  MAX_BUBBLE_LENGTH,
  MIN_BUBBLE_DURATION_MS,
  PROTOCOL_VERSION,
} from './constants.js';

const noControlCharacters = (value: string): boolean =>
  [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  });
const noPathSeparators = (value: string): boolean => !/[\\/]/u.test(value);
const safeText = (max: number) =>
  z.string().min(1).max(max).refine(noControlCharacters, 'control characters are not allowed');
const safeName = (max: number) => safeText(max).refine(noPathSeparators, 'path separators are not allowed');

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);
export const IsoDateSchema = z.string().datetime({ offset: true });
export const SourceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
export const EventIdSchema = z.string().uuid();
export const AnimationNameSchema = safeName(128);
export const BubbleTextSchema = safeText(MAX_BUBBLE_LENGTH);
export const ToolNameSchema = safeName(64);

export const PersistentPhaseSchema = z.enum(['idle', 'thinking', 'responding', 'tool', 'waiting', 'compacting']);
export const VisualPhaseSchema = z.enum(['offline', ...PersistentPhaseSchema.options]);
export const TransientEventTypeSchema = z.enum([
  'completed',
  'failed',
  'cancelled',
  'truncated',
  'tool_failed',
  'attention',
]);

export const SourceMetadataSchema = z
  .object({
    kind: z.literal('pi'),
    label: safeText(64),
    projectName: safeName(100),
    sessionName: safeText(100).optional(),
  })
  .strict();

export const ModelMetadataSchema = z
  .object({
    provider: safeName(64),
    id: safeText(128),
    thinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  })
  .strict();

export const ActivityMetadataSchema = z
  .object({
    toolName: ToolNameSchema.optional(),
    activeToolCount: z.number().int().min(0).max(64).optional(),
  })
  .strict();

export const SourceStateSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    sequence: z.number().int().nonnegative().safe(),
    sentAt: IsoDateSchema,
    phase: PersistentPhaseSchema,
    source: SourceMetadataSchema,
    model: ModelMetadataSchema.optional(),
    activity: ActivityMetadataSchema.optional(),
  })
  .strict();

export const HeartbeatSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    sentAt: IsoDateSchema,
  })
  .strict();

export const TransientEventSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    eventId: EventIdSchema,
    sequence: z.number().int().nonnegative().safe(),
    occurredAt: IsoDateSchema,
    type: TransientEventTypeSchema,
    metadata: z
      .object({
        toolName: ToolNameSchema.optional(),
        code: safeName(32).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PlayActionSchema = z
  .object({
    type: z.literal('play'),
    animation: AnimationNameSchema,
  })
  .strict();

export const BubbleActionSchema = z
  .object({
    type: z.literal('bubble'),
    text: BubbleTextSchema,
    durationMs: z.number().int().min(MIN_BUBBLE_DURATION_MS).max(MAX_BUBBLE_DURATION_MS).default(5_000),
  })
  .strict();

export const VisibilityActionSchema = z
  .object({
    type: z.literal('set-visibility'),
    visible: z.boolean(),
  })
  .strict();

export const ResetPositionActionSchema = z.object({ type: z.literal('reset-position') }).strict();
export const PinSourceActionSchema = z
  .object({
    type: z.literal('pin-source'),
    sourceId: SourceIdSchema.nullable(),
  })
  .strict();
export const ReleaseSourceActionSchema = z
  .object({
    type: z.literal('release-source'),
    sourceId: SourceIdSchema,
    quitIfIdle: z.boolean(),
  })
  .strict();

export const PetActionSchema = z.discriminatedUnion('type', [
  PlayActionSchema,
  BubbleActionSchema,
  VisibilityActionSchema,
  ResetPositionActionSchema,
  PinSourceActionSchema,
  ReleaseSourceActionSchema,
]);

export const SavedPositionSchema = z
  .object({
    displayId: safeText(128),
    xRatio: z.number().min(0).max(1),
    yRatio: z.number().min(0).max(1),
  })
  .strict();

export const PetSettingsSchema = z
  .object({
    size: z.number().int().min(160).max(800),
    alwaysOnTop: z.boolean(),
    ambientActions: z.boolean(),
    bubblesEnabled: z.boolean(),
    launchAtLogin: z.boolean(),
    manageWithPi: z.boolean(),
    configurePiExtension: z.boolean(),
    pinnedSourceId: SourceIdSchema.nullable(),
    position: SavedPositionSchema.nullable(),
  })
  .strict();

export const PetSettingsPatchSchema = PetSettingsSchema.partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one setting is required');

export const PiLifecycleDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    managedBy: z.literal('pi-deepseek-pet-desktop'),
    enabled: z.literal(true),
    command: safeText(4_096),
    args: z.array(z.string().max(4_096).refine(noControlCharacters, 'control characters are not allowed')).max(8),
    extensionPath: safeText(4_096),
    updatedAt: IsoDateSchema,
  })
  .strict();

export const BridgeDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.username === '' && url.password === '';
      }, 'baseUrl must be an unauthenticated HTTP URL on 127.0.0.1'),
    token: z.string().regex(/^[a-f0-9]{64}$/u),
    appInstanceId: z.string().uuid(),
    pid: z.number().int().positive(),
    createdAt: IsoDateSchema,
  })
  .strict();

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.enum(API_ERROR_CODES),
        message: z.string().min(1).max(300),
        requestId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export const AnimationCatalogSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    animations: z.array(AnimationNameSchema),
    phasePools: z.record(VisualPhaseSchema, z.array(AnimationNameSchema)),
    eventPools: z.record(TransientEventTypeSchema, z.array(AnimationNameSchema)),
  })
  .strict();

export type PersistentPhase = z.infer<typeof PersistentPhaseSchema>;
export type VisualPhase = z.infer<typeof VisualPhaseSchema>;
export type TransientEventType = z.infer<typeof TransientEventTypeSchema>;
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
export type ActivityMetadata = z.infer<typeof ActivityMetadataSchema>;
export type SourceState = z.infer<typeof SourceStateSchema>;
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export type TransientEvent = z.infer<typeof TransientEventSchema>;
export type PetAction = z.infer<typeof PetActionSchema>;
export type PetSettings = z.infer<typeof PetSettingsSchema>;
export type PetSettingsPatch = z.infer<typeof PetSettingsPatchSchema>;
export type SavedPosition = z.infer<typeof SavedPositionSchema>;
export type PiLifecycleDescriptor = z.infer<typeof PiLifecycleDescriptorSchema>;
export type BridgeDescriptor = z.infer<typeof BridgeDescriptorSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;
export type AnimationCatalog = z.infer<typeof AnimationCatalogSchema>;
