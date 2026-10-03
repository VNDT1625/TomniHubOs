import {
  validateViuVectorGeometry,
  type ViuProjectState,
  type ViuTransaction,
  type ViuTransactionResult,
  type ViuVectorGeometry,
} from '../viu';
import { z } from 'zod';

/** The fixed, versioned surface for the first-party Design VIU contribution. */
export const DESIGN_VIU_ABI_VERSION = 1 as const;

export { DESIGN_VIU_NATIVE_CHANNELS } from '../types/platform/electron';

export type DesignViuResult<T> = Readonly<{ ok: true; data: T }> | Readonly<{ ok: false; code: DesignViuErrorCode }>;

export type DesignViuErrorCode =
  | 'DESIGN_VIU_SENDER_UNTRUSTED'
  | 'DESIGN_VIU_ACCOUNT_REQUIRED'
  | 'DESIGN_VIU_REQUEST_INVALID'
  | 'DESIGN_VIU_CONTRIBUTION_INACTIVE'
  | 'DESIGN_VIU_OPERATION_DENIED'
  | 'DESIGN_VIU_CANCELLED'
  | 'DESIGN_VIU_UNAVAILABLE';

export type DesignViuWorkspaceRequest = Readonly<{ workspaceKey: string }>;
export type DesignViuTransactionRequest = Readonly<{ workspaceKey: string; transaction: ViuTransaction }>;
export type DesignViuCreateRequest = Readonly<{
  prompt: string;
  mode?: 'faithful' | 'professional' | 'creative';
  viewport?: Readonly<{ width: number; height: number }>;
}>;
export type DesignViuCaptureRequest = Readonly<{
  url: string;
  maxPages?: number;
  viewport?: Readonly<{ width: number; height: number }>;
}>;
export type DesignViuImageRequest = Readonly<{ path: string }>;
export type DesignViuPersistRequest = Readonly<{ rootPath: string; project: unknown }>;
export type DesignViuAssetGrantRequest = Readonly<{
  workspaceKey: string;
  path: string;
  grantPath: string;
  mimeType: string;
}>;
export type DesignViuLocalAssetRef = Readonly<{
  id: string;
  protocolUrl: string;
  displayName: string;
  extension: string;
  mimeType: string;
  kind: 'image' | 'video' | 'model';
  sizeBytes: number;
  modifiedAtMs: number;
  metadataSha256: string;
  missing: boolean;
}>;
export type DesignViuSessionValidation = Readonly<{
  valid: boolean;
  revision: number;
  diagnostics: readonly unknown[];
}>;

/**
 * There is deliberately no generic `invoke(operation, payload)` method. The
 * renderer cannot claim package identity, account identity, host address, or a
 * dynamically selected operation.
 */
export type DesignViuNativeAPI = Readonly<{
  create(payload: DesignViuCreateRequest): Promise<DesignViuResult<unknown>>;
  capture(payload: DesignViuCaptureRequest): Promise<DesignViuResult<unknown>>;
  analyzeImage(payload: DesignViuImageRequest): Promise<DesignViuResult<unknown>>;
  persist(payload: DesignViuPersistRequest): Promise<DesignViuResult<unknown>>;
  inspect(payload: DesignViuWorkspaceRequest): Promise<DesignViuResult<ViuProjectState>>;
  preview(payload: DesignViuTransactionRequest): Promise<DesignViuResult<ViuTransactionResult>>;
  commit(payload: DesignViuTransactionRequest): Promise<DesignViuResult<ViuTransactionResult>>;
  validate(payload: DesignViuWorkspaceRequest): Promise<DesignViuResult<DesignViuSessionValidation>>;
  grantAsset(payload: DesignViuAssetGrantRequest): Promise<DesignViuResult<DesignViuLocalAssetRef>>;
  listAssets(payload: DesignViuWorkspaceRequest): Promise<DesignViuResult<DesignViuLocalAssetRef[]>>;
}>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });

const isWorkspaceKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !hasControlCharacter(value);

export const isDesignViuWorkspaceRequest = (value: unknown): value is DesignViuWorkspaceRequest =>
  isPlainObject(value) && Object.keys(value).length === 1 && isWorkspaceKey(value.workspaceKey);

export const isDesignViuTransactionRequest = (value: unknown): value is DesignViuTransactionRequest =>
  isPlainObject(value) &&
  Object.keys(value).length === 2 &&
  isWorkspaceKey(value.workspaceKey) &&
  isPlainObject(value.transaction);
const idSchema = z.string().trim().min(1).max(256);
const workspaceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .describe('Opaque workspace session key. It is used for routing and is never echoed in tool output.');

const finiteNumberSchema = z.number().finite();
const gradientStopSchema = z
  .object({ color: z.string().trim().min(1).max(1_000), position: finiteNumberSchema.min(0).max(1) })
  .strict();
const gradientStopsSchema = z
  .array(gradientStopSchema)
  .min(2)
  .max(32)
  .refine(
    (stops) => stops.every((stop, index) => index === 0 || stop.position >= stops[index - 1]!.position),
    'Gradient stops must be ordered by position.'
  );
const fillSchema = z.discriminatedUnion('type', [
  z
    .object({
      id: idSchema,
      type: z.literal('solid'),
      visible: z.boolean(),
      opacity: finiteNumberSchema.min(0).max(1),
      color: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal('linear'),
      visible: z.boolean(),
      opacity: finiteNumberSchema.min(0).max(1),
      angle: finiteNumberSchema.min(-3_600).max(3_600),
      stops: gradientStopsSchema,
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.literal('radial'),
      visible: z.boolean(),
      opacity: finiteNumberSchema.min(0).max(1),
      centerX: finiteNumberSchema.min(-1_000).max(1_000),
      centerY: finiteNumberSchema.min(-1_000).max(1_000),
      radius: finiteNumberSchema.positive().max(10_000),
      stops: gradientStopsSchema,
    })
    .strict(),
]);
const effectSchema = z.discriminatedUnion('type', [
  z
    .object({
      id: idSchema,
      type: z.enum(['drop-shadow', 'inner-shadow']),
      visible: z.boolean(),
      x: finiteNumberSchema.min(-10_000).max(10_000),
      y: finiteNumberSchema.min(-10_000).max(10_000),
      blur: finiteNumberSchema.nonnegative().max(10_000),
      spread: finiteNumberSchema.min(-10_000).max(10_000),
      color: z.string().trim().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      type: z.enum(['layer-blur', 'backdrop-blur']),
      visible: z.boolean(),
      radius: finiteNumberSchema.nonnegative().max(200),
    })
    .strict(),
]);

const strokeSchema = z
  .object({
    id: idSchema,
    visible: z.boolean(),
    opacity: finiteNumberSchema.min(0).max(1),
    color: z.string().trim().min(1).max(1_000),
    width: finiteNumberSchema.min(0).max(10_000),
    alignment: z.enum(['inside', 'center', 'outside']),
    cap: z.enum(['butt', 'round', 'square']),
    join: z.enum(['miter', 'round', 'bevel']),
    miterLimit: finiteNumberSchema.min(1).max(1_000),
    dashPattern: z.array(finiteNumberSchema.min(0).max(100_000)).max(32),
    dashOffset: finiteNumberSchema.min(-100_000).max(100_000),
  })
  .strict()
  .refine(
    (stroke) => stroke.dashPattern.length === 0 || !stroke.dashPattern.every((value) => value === 0),
    'A stroke dash pattern cannot contain only zeroes.'
  );
const imageTransformSchema = z
  .object({
    fit: z.enum(['cover', 'contain', 'fill', 'none', 'scale-down']),
    crop: z
      .object({
        x: finiteNumberSchema.min(0).max(1),
        y: finiteNumberSchema.min(0).max(1),
        width: finiteNumberSchema.min(0.001).max(1),
        height: finiteNumberSchema.min(0.001).max(1),
      })
      .strict(),
    focalPoint: z.object({ x: finiteNumberSchema.min(0).max(1), y: finiteNumberSchema.min(0).max(1) }).strict(),
    rotation: finiteNumberSchema.min(-360_000).max(360_000),
    flipHorizontal: z.boolean(),
    flipVertical: z.boolean(),
  })
  .strict()
  .refine(
    (transform) => transform.crop.x + transform.crop.width <= 1.000_001,
    'Image crop width extends beyond the source.'
  )
  .refine(
    (transform) => transform.crop.y + transform.crop.height <= 1.000_001,
    'Image crop height extends beyond the source.'
  );
const variableModeSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(500),
    kind: z.enum(['light', 'dark', 'brand', 'device', 'locale', 'custom']),
  })
  .strict();
const variableCollectionSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(500),
    defaultModeId: idSchema,
    modeIds: z.array(idSchema).min(1).max(100),
    modes: z.record(variableModeSchema),
  })
  .strict()
  .refine(
    (collection) => collection.modeIds.includes(collection.defaultModeId),
    'Default mode must belong to the collection.'
  )
  .refine(
    (collection) =>
      new Set(collection.modeIds).size === collection.modeIds.length &&
      collection.modeIds.every((modeId) => collection.modes[modeId]?.id === modeId),
    'Collection mode IDs must be unique and reference matching mode records.'
  );
const variableValueSchema = z.union([
  z.string().max(10_000),
  finiteNumberSchema,
  z.boolean(),
  z.object({ type: z.literal('alias'), variableId: idSchema }).strict(),
]);
const variableSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(500),
    collectionId: idSchema,
    type: z.enum(['color', 'number', 'string', 'boolean']),
    valuesByMode: z.record(variableValueSchema),
    description: z.string().max(2_000).optional(),
  })
  .strict()
  .refine(
    (variable) => Object.keys(variable.valuesByMode).length <= 100,
    'A variable cannot define more than 100 mode values.'
  );
const breakpointSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(500),
    preset: z.enum(['desktop', 'tablet', 'mobile', 'custom']),
    minWidth: finiteNumberSchema.min(0).max(1_000_000),
    maxWidth: finiteNumberSchema.min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine(
    (breakpoint) => breakpoint.maxWidth === undefined || breakpoint.maxWidth >= breakpoint.minWidth,
    'Breakpoint maximum width must be greater than or equal to its minimum width.'
  );
const guideSchema = z
  .object({
    id: idSchema,
    axis: z.enum(['horizontal', 'vertical']),
    position: finiteNumberSchema,
    locked: z.boolean().optional(),
  })
  .strict();
const snapSettingsSchema = z
  .object({
    enabled: z.boolean(),
    pixelGrid: finiteNumberSchema.positive().max(10_000),
    threshold: finiteNumberSchema.min(0).max(10_000),
    snapToGuides: z.boolean(),
    snapToObjects: z.boolean(),
  })
  .strict();

const timelineKeyframeSchema = z
  .object({
    offsetMs: z.number().int().min(0).max(3_600_000),
    value: finiteNumberSchema,
    easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'spring-soft']).optional(),
  })
  .strict();
const timelineTrackSchema = z
  .object({
    id: idSchema,
    nodeId: idSchema,
    property: z.enum(['x', 'y', 'opacity', 'scale', 'rotate', 'blur']),
    keyframes: z.array(timelineKeyframeSchema).min(1).max(1_000),
  })
  .strict()
  .refine(
    (track) =>
      track.keyframes.every(
        (keyframe, index) => index === 0 || keyframe.offsetMs >= track.keyframes[index - 1]!.offsetMs
      ),
    'Timeline keyframes must be ordered by offset.'
  );
const timelineBaseSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(500),
    durationMs: z.number().int().positive().max(3_600_000),
    loop: z.boolean().optional(),
    tracks: z.array(timelineTrackSchema).max(1_000).optional(),
  })
  .strict();
const timelineSchema = timelineBaseSchema.refine(
  (timeline) =>
    (timeline.tracks ?? []).every((track) =>
      track.keyframes.every((keyframe) => keyframe.offsetMs <= timeline.durationMs)
    ),
  'Timeline keyframes cannot extend beyond the timeline duration.'
);
const timelinePatchSchema = timelineBaseSchema
  .omit({ id: true })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'A timeline patch cannot be empty.')
  .refine(
    (patch) =>
      patch.durationMs === undefined ||
      (patch.tracks ?? []).every((track) =>
        track.keyframes.every((keyframe) => keyframe.offsetMs <= patch.durationMs!)
      ),
    'Timeline keyframes cannot extend beyond the patched timeline duration.'
  );
const scrollBindingSchema = z
  .object({
    id: idSchema,
    nodeId: idSchema,
    timelineId: idSchema.optional(),
    start: finiteNumberSchema.min(0).max(1),
    end: finiteNumberSchema.min(0).max(1),
    pin: z.boolean(),
    parallax: finiteNumberSchema.min(-100_000).max(100_000),
  })
  .strict()
  .refine((binding) => binding.end >= binding.start, 'Scroll binding end must be greater than or equal to start.');

const styleShape = {
  fills: z.array(fillSchema).max(32).optional(),
  effects: z.array(effectSchema).max(32).optional(),
  strokes: z.array(strokeSchema).max(32).optional(),
  background: z.string().trim().min(1).max(10_000).optional(),
  color: z.string().trim().min(1).max(1_000).optional(),
  fontFamily: z.string().trim().min(1).max(1_000).optional(),
  fontSize: finiteNumberSchema.positive().max(1_000).optional(),
  fontWeight: finiteNumberSchema.min(1).max(1_000).optional(),
  fontStyle: z.enum(['normal', 'italic', 'oblique']).optional(),
  lineHeight: finiteNumberSchema.positive().max(100).optional(),
  letterSpacing: finiteNumberSchema.min(-1_000).max(1_000).optional(),
  textDecoration: z.enum(['none', 'underline', 'line-through', 'underline line-through']).optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  borderColor: z.string().trim().min(1).max(1_000).optional(),
  borderWidth: finiteNumberSchema.nonnegative().max(10_000).optional(),
  borderStyle: z.enum(['none', 'solid', 'dashed', 'dotted', 'double']).optional(),
  borderRadius: finiteNumberSchema.nonnegative().max(100_000).optional(),
  borderRadii: z
    .tuple([
      finiteNumberSchema.nonnegative().max(1_000_000),
      finiteNumberSchema.nonnegative().max(1_000_000),
      finiteNumberSchema.nonnegative().max(1_000_000),
      finiteNumberSchema.nonnegative().max(1_000_000),
    ])
    .optional(),
  strokeAlignment: z.enum(['inside', 'center', 'outside']).optional(),
  shadow: z.string().max(20_000).optional(),
  blur: finiteNumberSchema.nonnegative().max(200).optional(),
  backdropBlur: finiteNumberSchema.nonnegative().max(200).optional(),
  overflow: z.enum(['visible', 'hidden', 'scroll']).optional(),
} as const;
const nodeStyleSchema = z.object({ ...styleShape, opacity: finiteNumberSchema.min(0).max(1) }).strict();
const stylePatchSchema = z.object({ ...styleShape, opacity: finiteNumberSchema.min(0).max(1).optional() }).strict();
const bindablePropertySchema = z.enum([
  'style.background',
  'style.color',
  'style.borderColor',
  'style.borderWidth',
  'style.borderRadius',
  'style.opacity',
  'style.fontSize',
  'style.lineHeight',
  'style.letterSpacing',
  'content.text',
  'content.placeholder',
  'layout.gap',
  'size.width',
  'size.height',
  'visible',
]);
const variableBindingSchema = z.object({ variableId: idSchema, modeId: idSchema.optional() }).strict();
const variableBindingsSchema = z
  .record(variableBindingSchema)
  .refine((bindings) => Object.keys(bindings).length <= 15, 'A node cannot bind more than 15 properties.')
  .refine(
    (bindings) => Object.keys(bindings).every((property) => bindablePropertySchema.safeParse(property).success),
    'A node contains an unsupported variable binding property.'
  );
const responsiveOverrideSchema = z
  .object({
    localTransform: z
      .tuple([
        finiteNumberSchema,
        finiteNumberSchema,
        finiteNumberSchema,
        finiteNumberSchema,
        finiteNumberSchema,
        finiteNumberSchema,
      ])
      .optional(),
    size: z
      .object({
        width: finiteNumberSchema.nonnegative().optional(),
        height: finiteNumberSchema.nonnegative().optional(),
      })
      .strict()
      .optional(),
    sizing: z
      .object({
        horizontal: z.enum(['fixed', 'fill', 'hug']).optional(),
        vertical: z.enum(['fixed', 'fill', 'hug']).optional(),
        minWidth: finiteNumberSchema.nonnegative().optional(),
        maxWidth: finiteNumberSchema.nonnegative().optional(),
        minHeight: finiteNumberSchema.nonnegative().optional(),
        maxHeight: finiteNumberSchema.nonnegative().optional(),
      })
      .strict()
      .optional(),
    constraints: z
      .object({
        horizontal: z.enum(['left', 'right', 'center', 'stretch', 'scale']).optional(),
        vertical: z.enum(['top', 'bottom', 'center', 'stretch', 'scale']).optional(),
      })
      .strict()
      .optional(),
    layout: z
      .object({
        mode: z.enum(['none', 'horizontal', 'vertical', 'grid']).optional(),
        gap: finiteNumberSchema.nonnegative().optional(),
        padding: z
          .tuple([
            finiteNumberSchema.nonnegative(),
            finiteNumberSchema.nonnegative(),
            finiteNumberSchema.nonnegative(),
            finiteNumberSchema.nonnegative(),
          ])
          .optional(),
        align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
        justify: z.enum(['start', 'center', 'end', 'space-between']).optional(),
        wrap: z.boolean().optional(),
        columns: z.number().int().positive().max(1_000).optional(),
      })
      .strict()
      .optional(),
    style: stylePatchSchema.optional(),
    content: z
      .object({
        text: z.string().max(100_000).optional(),
        assetId: idSchema.optional(),
        controlType: z.enum(['button', 'input', 'select', 'checkbox', 'radio', 'form']).optional(),
        placeholder: z.string().max(10_000).optional(),
      })
      .strict()
      .optional(),
    visible: z.boolean().optional(),
  })
  .strict()
  .refine((override) => Object.keys(override).length > 0, 'A responsive override cannot be empty.');
const responsiveOverridesSchema = z
  .record(responsiveOverrideSchema)
  .refine(
    (overrides) => Object.keys(overrides).length <= 100,
    'A node cannot define more than 100 responsive overrides.'
  );

const boundedRecord = <T extends z.ZodTypeAny>(valueSchema: T, limit: number) =>
  z
    .record(valueSchema)
    .refine((record) => Object.keys(record).length <= limit, `A record cannot contain more than ${limit} entries.`);
const vectorHandleSchema = z.object({ x: finiteNumberSchema, y: finiteNumberSchema }).strict();
const vectorPointSchema = z
  .object({
    id: idSchema,
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    handleIn: vectorHandleSchema.optional(),
    handleOut: vectorHandleSchema.optional(),
    pointType: z.enum(['corner', 'smooth', 'symmetric']),
  })
  .strict();
const vectorContourSchema = z
  .object({
    id: idSchema,
    points: z.array(vectorPointSchema).min(2).max(10_000),
    closed: z.boolean(),
  })
  .strict();
const vectorBooleanOperandSchema = z
  .object({
    id: idSchema,
    contourIds: z.array(idSchema).min(1).max(10_000),
  })
  .strict();
const vectorGeometrySchema = z
  .object({
    pathData: z.string().trim().min(1).max(100_000),
    points: z.array(vectorPointSchema).min(2).max(10_000),
    closed: z.boolean(),
    contours: z.array(vectorContourSchema).min(1).max(5_000).optional(),
    booleanOperation: z
      .object({
        kind: z.enum(['union', 'subtract', 'intersect', 'exclude']),
        operands: z.array(vectorBooleanOperandSchema).min(2).max(5_000),
      })
      .strict()
      .optional(),
    maskOperation: z
      .object({
        kind: z.enum(['clip', 'alpha']),
        operands: z.array(vectorBooleanOperandSchema).min(2).max(5_000),
        maskOperandId: idSchema,
      })
      .strict()
      .optional(),
    fillRule: z.enum(['nonzero', 'evenodd']),
    strokeCap: z.enum(['butt', 'round', 'square']),
    strokeJoin: z.enum(['miter', 'round', 'bevel']),
    miterLimit: finiteNumberSchema.min(1).max(1_000),
  })
  .strict()
  .superRefine((vector, context) => {
    const contours = vector.contours ?? [{ id: 'contour-1', points: vector.points, closed: vector.closed }];
    const pointCount = contours.reduce((total, contour) => total + contour.points.length, 0);
    if (pointCount > 10_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector geometry cannot contain more than 10,000 anchors across all contours.',
        path: ['contours'],
      });
      return;
    }
    const contourIds = new Set(contours.map((contour) => contour.id));
    const pointIds = contours.flatMap((contour) => contour.points.map((point) => point.id));
    if (contourIds.size !== contours.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector contour IDs must be unique.',
        path: ['contours'],
      });
    }
    if (new Set(pointIds).size !== pointIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector anchor IDs must be unique.',
        path: ['contours'],
      });
    }
    const geometryError = validateViuVectorGeometry(vector as ViuVectorGeometry);
    if (geometryError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: geometryError,
        path: [],
      });
    }
    const operation = vector.booleanOperation;
    if (!operation) return;
    const operandIds = new Set(operation.operands.map((operand) => operand.id));
    if (operandIds.size !== operation.operands.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector boolean operand IDs must be unique.',
        path: ['booleanOperation', 'operands'],
      });
    }
    const references = operation.operands.flatMap((operand) => operand.contourIds);
    if (references.some((contourId) => !contourIds.has(contourId)) || new Set(references).size !== references.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Vector boolean operands must reference existing contours exactly once.',
        path: ['booleanOperation', 'operands'],
      });
    }
  });
const nodeSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    name: z.string().min(1).max(500),
    type: z.enum([
      'frame',
      'group',
      'text',
      'vector',
      'image',
      'video',
      'audio',
      'control',
      'component-instance',
      'repeater',
      'model-3d',
      'runtime-surface',
      'hotspot',
    ]),
    parentId: idSchema.nullable(),
    childIds: z.array(idSchema).max(10_000),
    localTransform: z.tuple([
      finiteNumberSchema,
      finiteNumberSchema,
      finiteNumberSchema,
      finiteNumberSchema,
      finiteNumberSchema,
      finiteNumberSchema,
    ]),
    size: z.object({ width: finiteNumberSchema.nonnegative(), height: finiteNumberSchema.nonnegative() }).strict(),
    positionMode: z.enum(['flow', 'absolute']),
    sizing: z.record(z.unknown()),
    constraints: z.record(z.unknown()),
    layout: z.record(z.unknown()).optional(),
    style: nodeStyleSchema,
    content: z.record(z.unknown()).optional(),
    imageTransform: imageTransformSchema.optional(),
    vector: vectorGeometrySchema.optional(),
    componentInstance: z
      .object({
        componentId: idSchema,
        variantSelection: boundedRecord(z.string().max(200), 32),
        propertyValues: boundedRecord(z.union([z.string().max(10_000), z.boolean()]), 200),

        styleOverrides: stylePatchSchema.optional(),
      })
      .strict()
      .optional(),
    variableBindings: variableBindingsSchema.optional(),
    responsiveOverrides: responsiveOverridesSchema.optional(),
    semantics: z.record(z.unknown()),
    behaviorBindings: z.array(idSchema).max(10_000),
    visible: z.boolean(),
    locked: z.boolean(),
    provenance: z.record(z.unknown()),
  })
  .strict();

const nodePatchSchema = z
  .object({
    name: nodeSchema.shape.name,
    type: nodeSchema.shape.type,
    localTransform: nodeSchema.shape.localTransform,
    size: nodeSchema.shape.size,
    positionMode: nodeSchema.shape.positionMode,
    sizing: nodeSchema.shape.sizing,
    constraints: nodeSchema.shape.constraints,
    layout: nodeSchema.shape.layout,
    style: stylePatchSchema,
    content: nodeSchema.shape.content,
    imageTransform: nodeSchema.shape.imageTransform,
    vector: nodeSchema.shape.vector,
    componentInstance: nodeSchema.shape.componentInstance,
    variableBindings: nodeSchema.shape.variableBindings,
    responsiveOverrides: nodeSchema.shape.responsiveOverrides,
    semantics: nodeSchema.shape.semantics,
    behaviorBindings: nodeSchema.shape.behaviorBindings,
    visible: nodeSchema.shape.visible,
    locked: nodeSchema.shape.locked,
    provenance: nodeSchema.shape.provenance,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'A node patch cannot be empty.');

const componentPropertySchema = z.discriminatedUnion('type', [
  z
    .object({
      id: idSchema,
      name: z.string().trim().min(1).max(500),
      type: z.literal('text'),
      targetNodeId: idSchema,
      targetProperty: z.literal('content.text'),
      defaultValue: z.string().max(10_000),
    })
    .strict(),
  z
    .object({
      id: idSchema,
      name: z.string().trim().min(1).max(500),
      type: z.literal('boolean'),
      targetNodeId: idSchema,
      targetProperty: z.literal('visible'),
      defaultValue: z.boolean(),
    })
    .strict(),
]);
const variantPropertiesSchema = boundedRecord(z.string().trim().min(1).max(200), 32);
const componentPropertiesSchema = boundedRecord(componentPropertySchema, 200);
const componentSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(500),
    rootNodeId: idSchema,
    componentSetId: idSchema.optional(),
    variantProperties: variantPropertiesSchema,
    propertyDefinitions: componentPropertiesSchema,
  })
  .strict();
const componentPatchSchema = z
  .object({
    name: componentSchema.shape.name,
    componentSetId: componentSchema.shape.componentSetId,
    variantProperties: componentSchema.shape.variantProperties,
    propertyDefinitions: componentSchema.shape.propertyDefinitions,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'A component patch cannot be empty.');
const variantAxesSchema = boundedRecord(z.array(z.string().trim().min(1).max(200)).min(1).max(100), 32);
const componentSetSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(500),
    componentIds: z.array(idSchema).max(500),
    variantAxes: variantAxesSchema,
  })
  .strict();
const componentSetPatchSchema = z
  .object({
    name: componentSetSchema.shape.name,
    componentIds: componentSetSchema.shape.componentIds,
    variantAxes: componentSetSchema.shape.variantAxes,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'A component set patch cannot be empty.');

const interactionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), targetScreenId: idSchema }).strict(),
  z.object({ type: z.literal('openOverlay'), targetNodeId: idSchema }).strict(),
  z.object({ type: z.literal('scrollTo'), targetNodeId: idSchema }).strict(),
  z.object({ type: z.literal('closeOverlay'), targetNodeId: idSchema.optional() }).strict(),
  z.object({ type: z.literal('back') }).strict(),
  z.object({ type: z.literal('setVariable'), variableId: idSchema, value: z.unknown() }).strict(),
  z.object({ type: z.literal('toggleVariable'), variableId: idSchema }).strict(),
  z.object({ type: z.literal('playTimeline'), timelineId: idSchema }).strict(),
  z.object({ type: z.literal('pauseTimeline'), timelineId: idSchema }).strict(),
  z
    .object({
      type: z.literal('seekTimeline'),
      timelineId: idSchema,
      offsetMs: finiteNumberSchema.min(0).max(86_400_000),
    })
    .strict(),
]);
const interactionConditionSchema = z
  .object({
    variableId: idSchema,
    operator: z.enum(['eq', 'neq', 'truthy', 'falsy', 'gt', 'gte', 'lt', 'lte']),
    value: z.unknown().optional(),
  })
  .strict();

const interactionTransitionSchema = z
  .object({
    preset: z.enum([
      'none',
      'fade',
      'rise',
      'scale',
      'slide-left',
      'slide-right',
      'blur-in',
      'reveal',
      'smart-animate',
    ]),
    durationMs: z.number().finite().min(0).max(60_000),
    easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'spring-soft']),
  })
  .strict();

const interactionSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    flowId: idSchema,
    sourceNodeId: idSchema,
    trigger: z.enum(['click', 'hover', 'focus', 'submit', 'scroll', 'load']),
    action: interactionActionSchema,
    actions: z.array(interactionActionSchema).min(1).max(32).optional(),
    condition: interactionConditionSchema.optional(),
    transition: interactionTransitionSchema.optional(),
  })
  .strict();

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('insertNode'),
      node: nodeSchema,
      parentId: idSchema.nullable(),
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal('updateNode'), nodeId: idSchema, patch: nodePatchSchema }).strict(),
  z.object({ type: z.literal('deleteNode'), nodeId: idSchema }).strict(),
  z
    .object({
      type: z.literal('reparentNode'),
      nodeId: idSchema,
      parentId: idSchema.nullable(),
      index: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal('reorderNode'), nodeId: idSchema, index: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('createComponent'), component: componentSchema }).strict(),
  z.object({ type: z.literal('updateComponent'), componentId: idSchema, patch: componentPatchSchema }).strict(),
  z.object({ type: z.literal('deleteComponent'), componentId: idSchema }).strict(),
  z.object({ type: z.literal('createComponentSet'), componentSet: componentSetSchema }).strict(),
  z
    .object({ type: z.literal('updateComponentSet'), componentSetId: idSchema, patch: componentSetPatchSchema })
    .strict(),
  z.object({ type: z.literal('deleteComponentSet'), componentSetId: idSchema }).strict(),
  z.object({ type: z.literal('upsertVariableCollection'), collection: variableCollectionSchema }).strict(),
  z.object({ type: z.literal('deleteVariableCollection'), collectionId: idSchema }).strict(),
  z.object({ type: z.literal('upsertVariable'), variable: variableSchema }).strict(),
  z.object({ type: z.literal('deleteVariable'), variableId: idSchema }).strict(),
  z.object({ type: z.literal('setVariableMode'), collectionId: idSchema, modeId: idSchema.nullable() }).strict(),
  z.object({ type: z.literal('upsertBreakpoint'), breakpoint: breakpointSchema }).strict(),
  z.object({ type: z.literal('deleteBreakpoint'), breakpointId: idSchema }).strict(),
  z.object({ type: z.literal('setGuides'), guides: z.array(guideSchema).max(1_000) }).strict(),
  z.object({ type: z.literal('setSnapSettings'), settings: snapSettingsSchema.nullable() }).strict(),
  z.object({ type: z.literal('createTimeline'), timeline: timelineSchema }).strict(),
  z.object({ type: z.literal('updateTimeline'), timelineId: idSchema, patch: timelinePatchSchema }).strict(),
  z.object({ type: z.literal('deleteTimeline'), timelineId: idSchema }).strict(),
  z.object({ type: z.literal('upsertScrollBinding'), binding: scrollBindingSchema }).strict(),
  z.object({ type: z.literal('deleteScrollBinding'), bindingId: idSchema }).strict(),
  z.object({ type: z.literal('connectInteraction'), interaction: interactionSchema }).strict(),
  z.object({ type: z.literal('disconnectInteraction'), interactionId: idSchema }).strict(),
]);

const transactionSchema = (mode: ViuTransaction['mode']) =>
  z
    .object({
      transactionId: idSchema,
      documentId: idSchema,
      baseRevision: z.number().int().nonnegative(),
      actor: z
        .object({
          id: idSchema,
          kind: z.literal('agent'),
        })
        .strict(),
      origin: z.literal('agent-tool'),
      commands: z.array(commandSchema).min(1).max(500),
      preconditions: z
        .array(
          z
            .object({
              nodeId: idSchema,
              expectedVersion: z.number().int().nonnegative(),
            })
            .strict()
        )
        .max(1_000)
        .optional(),
      mode: z.literal(mode),
      idempotencyKey: z.string().trim().min(1).max(256).optional(),
      summary: z.string().trim().min(1).max(2_000),
    })
    .strict();

/**
 * The Design package ABI shares the exact bounded command schema with the MCP
 * tools, but it accepts only an explicit local-user canvas/inspector edit.
 */
export const parseDesignViuRendererTransaction = (
  value: unknown,
  mode: Extract<ViuTransaction['mode'], 'preview' | 'commit'>
): ViuTransaction | undefined => {
  const parsed = z
    .object({
      transactionId: idSchema,
      documentId: idSchema,
      baseRevision: z.number().int().nonnegative(),
      actor: z.object({ id: idSchema, kind: z.literal('user') }).strict(),
      origin: z.enum(['canvas', 'inspector']),
      commands: z.array(commandSchema).min(1).max(500),
      preconditions: z
        .array(z.object({ nodeId: idSchema, expectedVersion: z.number().int().nonnegative() }).strict())
        .max(1_000)
        .optional(),
      mode: z.literal(mode),
      idempotencyKey: z.string().trim().min(1).max(256).optional(),
      summary: z.string().trim().min(1).max(2_000),
    })
    .strict()
    .safeParse(value);
  return parsed.success ? (parsed.data as ViuTransaction) : undefined;
};
