import {
  AnimationNameSchema,
  BubbleTextSchema,
  PersistentPhaseSchema,
  TransientEventTypeSchema,
  VisualPhaseSchema,
} from '@pi-deepseek-pet/protocol';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { z } from 'zod';

const PoolSchema = z.array(AnimationNameSchema).min(1);
const MoveParamsObjectSchema = z
  .object({
    minDist: z.number().nonnegative(),
    maxDist: z.number().positive(),
    margin: z.number().nonnegative(),
    leadSec: z.number().nonnegative(),
    tailSec: z.number().nonnegative(),
  })
  .strict();
const MoveParamsSchema = MoveParamsObjectSchema.refine(
  (value) => value.maxDist >= value.minDist,
  'maxDist must be greater than or equal to minDist',
);

const PhasePoolsSchema = z
  .object({
    offline: PoolSchema,
    idle: PoolSchema,
    thinking: PoolSchema,
    responding: PoolSchema,
    tool: PoolSchema,
    waiting: PoolSchema,
    compacting: PoolSchema,
  })
  .strict();

const EventPoolsSchema = z
  .object({
    completed: PoolSchema,
    failed: PoolSchema,
    cancelled: PoolSchema,
    truncated: PoolSchema,
    tool_failed: PoolSchema,
    attention: PoolSchema,
  })
  .strict();

export const AnimationManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    canvas: z
      .object({
        width: z.literal(640),
        height: z.literal(360),
        feetY: z.number().min(0).max(360),
        hitBox: z
          .object({
            x0: z.number().min(0).max(640),
            y0: z.number().min(0).max(360),
            x1: z.number().min(0).max(640),
            y1: z.number().min(0).max(360),
          })
          .strict(),
      })
      .strict(),
    assets: z.array(AnimationNameSchema).min(1),
    idle: PoolSchema,
    turn: PoolSchema,
    drag: PoolSchema,
    clicks: PoolSchema,
    moves: z
      .object({
        default: MoveParamsSchema,
        actions: z
          .array(
            z
              .object({
                name: AnimationNameSchema,
                params: MoveParamsObjectSchema.partial().strict().optional(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    categories: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            weight: z.number().nonnegative(),
            noMirror: z.boolean().optional(),
            actions: PoolSchema,
          })
          .strict(),
      )
      .min(1),
    weights: z
      .object({
        idle: z.number().nonnegative(),
        turn: z.number().nonnegative(),
        move: z.number().nonnegative(),
      })
      .strict(),
    phasePools: PhasePoolsSchema,
    eventPools: EventPoolsSchema,
    bubbles: z
      .object({
        phases: z.record(VisualPhaseSchema, BubbleTextSchema).default({}),
        events: z.record(TransientEventTypeSchema, BubbleTextSchema).default({}),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const assets = new Set(manifest.assets);
    if (assets.size !== manifest.assets.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['assets'], message: 'asset names must be unique' });
    }
    if (
      manifest.canvas.hitBox.x1 <= manifest.canvas.hitBox.x0 ||
      manifest.canvas.hitBox.y1 <= manifest.canvas.hitBox.y0
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['canvas', 'hitBox'], message: 'hit box is inverted' });
    }

    const references: Array<readonly [string, readonly string[]]> = [
      ['idle', manifest.idle],
      ['turn', manifest.turn],
      ['drag', manifest.drag],
      ['clicks', manifest.clicks],
      ['moves.actions', manifest.moves.actions.map((move) => move.name)],
      ...manifest.categories.map((category) => [`categories.${category.id}`, category.actions] as const),
      ...PersistentPhaseSchema.options.map((phase) => [`phasePools.${phase}`, manifest.phasePools[phase]] as const),
      ['phasePools.offline', manifest.phasePools.offline],
      ...TransientEventTypeSchema.options.map((event) => [`eventPools.${event}`, manifest.eventPools[event]] as const),
    ];
    for (const [path, names] of references) {
      for (const name of names) {
        if (!assets.has(name)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `unknown animation: ${name}` });
        }
      }
    }

    const total =
      manifest.weights.idle +
      manifest.weights.turn +
      manifest.weights.move +
      manifest.categories.reduce((sum, category) => sum + category.weight, 0);
    if (Math.abs(total - 100) > 0.001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weights'],
        message: `animation weights total ${total}, expected 100`,
      });
    }
  });

export type MoveParams = z.infer<typeof MoveParamsSchema>;
export type AnimationManifest = z.infer<typeof AnimationManifestSchema>;

export function parseAnimationManifestText(source: string): AnimationManifest {
  const errors: ParseError[] = [];
  const value = parse(source, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0) {
    const summary = errors
      .slice(0, 3)
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join('; ');
    throw new Error(`Invalid animation manifest JSONC: ${summary}`);
  }
  return AnimationManifestSchema.parse(value);
}

export interface ManifestAssetDiagnostic {
  missing: string[];
  unexpected: string[];
}

export function compareManifestAssets(
  manifest: AnimationManifest,
  availableFileNames: readonly string[],
): ManifestAssetDiagnostic {
  const expected = new Set(manifest.assets);
  const available = new Set(availableFileNames);
  return {
    missing: [...expected].filter((name) => !available.has(name)).sort(),
    unexpected: [...available].filter((name) => !expected.has(name)).sort(),
  };
}
