/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ViuVectorHandle = { x: number; y: number };
export type ViuVectorPoint = {
  id: string;
  x: number;
  y: number;
  handleIn?: ViuVectorHandle;
  handleOut?: ViuVectorHandle;
  pointType: 'corner' | 'smooth' | 'symmetric';
};
export type ViuVectorGeometry = {
  pathData: string;
  points: ViuVectorPoint[];
  closed: boolean;
  contours?: ViuVectorContour[];
  booleanOperation?: ViuVectorBooleanOperation;
  maskOperation?: ViuVectorMaskOperation;
  fillRule: 'nonzero' | 'evenodd';
  strokeCap: 'butt' | 'round' | 'square';
  strokeJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
};

export type ViuVectorContour = {
  id: string;
  points: ViuVectorPoint[];
  closed: boolean;
};

export type ViuVectorBooleanKind = 'union' | 'subtract' | 'intersect' | 'exclude';

export type ViuVectorBooleanOperand = {
  id: string;
  contourIds: string[];
};

export type ViuVectorBooleanOperation = {
  kind: ViuVectorBooleanKind;
  operands: ViuVectorBooleanOperand[];
};

export type ViuVectorBooleanInput = {
  id: string;
  geometry: ViuVectorGeometry;
  transform?: readonly [number, number, number, number, number, number];
};

export type ViuVectorMaskKind = 'clip' | 'alpha';

export type ViuVectorMaskOperation = {
  kind: ViuVectorMaskKind;
  operands: ViuVectorBooleanOperand[];
  maskOperandId: string;
};

const PATH_TOKEN = /([AaCcHhLlMmQqSsTtVvZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
const PATH_ARITY: Readonly<Record<string, number>> = {
  A: 7,
  C: 6,
  H: 1,
  L: 2,
  M: 2,
  Q: 4,
  S: 4,
  T: 2,
  V: 1,
  Z: 0,
};
const VECTOR_POINT_TYPES = new Set<ViuVectorPoint['pointType']>(['corner', 'smooth', 'symmetric']);
const VECTOR_FILL_RULES = new Set<ViuVectorGeometry['fillRule']>(['nonzero', 'evenodd']);
const VECTOR_STROKE_CAPS = new Set<ViuVectorGeometry['strokeCap']>(['butt', 'round', 'square']);
const VECTOR_STROKE_JOINS = new Set<ViuVectorGeometry['strokeJoin']>(['miter', 'round', 'bevel']);

const safeDimension = (value: number): number => (Number.isFinite(value) ? Math.max(1, value) : 1);

const formatCoordinate = (value: number): string => {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

const controlPoint = (
  point: ViuVectorPoint,
  handle: ViuVectorPoint['handleIn'] | ViuVectorPoint['handleOut']
): [number, number] => [point.x + (handle?.x ?? 0), point.y + (handle?.y ?? 0)];

const segmentCommand = (from: ViuVectorPoint, to: ViuVectorPoint): string => {
  if (!from.handleOut && !to.handleIn) return `L ${formatCoordinate(to.x)} ${formatCoordinate(to.y)}`;
  const [c1x, c1y] = controlPoint(from, from.handleOut);
  const [c2x, c2y] = controlPoint(to, to.handleIn);
  return `C ${formatCoordinate(c1x)} ${formatCoordinate(c1y)} ${formatCoordinate(c2x)} ${formatCoordinate(
    c2y
  )} ${formatCoordinate(to.x)} ${formatCoordinate(to.y)}`;
};

/** Builds one standards-compliant SVG contour from editable anchors and relative B?zier handles. */
export function createViuSvgPathData(points: readonly ViuVectorPoint[], closed: boolean): string {
  const first = points[0];
  if (!first) return '';
  const commands = [`M ${formatCoordinate(first.x)} ${formatCoordinate(first.y)}`];
  for (let index = 1; index < points.length; index += 1) {
    commands.push(segmentCommand(points[index - 1]!, points[index]!));
  }
  if (closed && points.length > 1) {
    const last = points.at(-1)!;
    if (last.handleOut || first.handleIn) commands.push(segmentCommand(last, first));
    commands.push('Z');
  }
  return commands.join(' ');
}

/** Builds a deterministic compound SVG path while preserving independent editable contours. */
export function createViuCompoundPathData(contours: readonly ViuVectorContour[]): string {
  return contours
    .map((contour) => createViuSvgPathData(contour.points, contour.closed))
    .filter(Boolean)
    .join(' ');
}

/** Returns the normalized contour model while remaining compatible with legacy single-contour documents. */
export function getViuVectorContours(vector: ViuVectorGeometry): ViuVectorContour[] {
  return vector.contours?.length
    ? vector.contours.map((contour) => ({ ...contour, points: contour.points.map((point) => ({ ...point })) }))
    : [{ id: 'contour-1', points: vector.points.map((point) => ({ ...point })), closed: vector.closed }];
}

/** Replaces contours and keeps the legacy first-contour projection coherent for existing consumers. */
export function replaceViuVectorContours(
  vector: ViuVectorGeometry,
  contours: readonly ViuVectorContour[]
): ViuVectorGeometry {
  const normalized = contours.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => ({
      ...point,
      handleIn: point.handleIn ? { ...point.handleIn } : undefined,
      handleOut: point.handleOut ? { ...point.handleOut } : undefined,
    })),
  }));
  const first = normalized[0];
  return {
    ...vector,
    pathData: createViuCompoundPathData(normalized),
    points: first?.points ?? [],
    closed: first?.closed ?? false,
    contours: normalized,
  };
}

/** Reports whether the final contour is explicitly closed by its final command. */
export function isViuSvgPathClosed(pathData: string): boolean {
  return /[zZ]\s*$/.test(pathData);
}

/** Validates SVG path syntax without DOM parsing so main, renderer, and agent tools agree. */
export function validateViuSvgPathData(pathData: string): string | undefined {
  if (!pathData.trim()) return 'Vector path data cannot be empty.';
  if (pathData.length > 100_000) return 'Vector path data exceeds 100000 characters.';

  const tokens: Array<string | number> = [];
  let cursor = 0;
  PATH_TOKEN.lastIndex = 0;
  for (let match = PATH_TOKEN.exec(pathData); match; match = PATH_TOKEN.exec(pathData)) {
    if (!/^[\s,]*$/.test(pathData.slice(cursor, match.index))) return 'Vector path data contains invalid syntax.';
    tokens.push(match[1] ?? Number(match[2]));
    cursor = PATH_TOKEN.lastIndex;
  }
  if (!/^[\s,]*$/.test(pathData.slice(cursor))) return 'Vector path data contains invalid syntax.';
  if (tokens.length === 0 || typeof tokens[0] !== 'string' || tokens[0].toUpperCase() !== 'M') {
    return 'Vector path data must begin with a move command.';
  }

  let command: string | undefined;
  let index = 0;
  let contourOpen = false;
  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token === 'string') {
      command = token.toUpperCase();
      index += 1;
      if (command === 'Z') {
        if (!contourOpen) return 'Vector close command requires an open contour.';
        contourOpen = false;
        continue;
      }
    }
    if (!command || command === 'Z') return 'Vector path command is missing coordinates.';
    if (!contourOpen && command !== 'M') return 'Every vector contour must begin with a move command.';
    const arity = PATH_ARITY[command];
    if (arity === undefined) return `Unsupported vector path command ${command}.`;

    const values: number[] = [];
    while (index < tokens.length && typeof tokens[index] === 'number') {
      values.push(tokens[index] as number);
      index += 1;
    }
    if (values.length < arity || values.length % arity !== 0) {
      return `Vector path command ${command} has an invalid coordinate count.`;
    }
    if (values.some((value) => !Number.isFinite(value))) return 'Vector path coordinates must be finite.';
    if (command === 'M') contourOpen = true;
    if (command === 'A') {
      for (let offset = 0; offset < values.length; offset += arity) {
        if (values[offset]! < 0 || values[offset + 1]! < 0) return 'Vector arc radii cannot be negative.';
        if (![0, 1].includes(values[offset + 3]!) || ![0, 1].includes(values[offset + 4]!)) {
          return 'Vector arc flags must be 0 or 1.';
        }
      }
    }
  }
  return undefined;
}

/** Validates the structured editing model and its rendered SVG contour together. */
export function validateViuVectorGeometry(vector: ViuVectorGeometry): string | undefined {
  const pathError = validateViuSvgPathData(vector.pathData);
  if (pathError) return pathError;
  const contours = getViuVectorContours(vector);
  const firstContour = contours[0];
  if (vector.closed !== Boolean(firstContour?.closed)) {
    return 'Vector closed state must match its first contour.';
  }
  if (contours.length === 1 && vector.closed !== isViuSvgPathClosed(vector.pathData)) {
    return 'Vector closed state must match the final SVG close command.';
  }
  const totalPoints = contours.reduce((sum, contour) => sum + contour.points.length, 0);
  if (totalPoints < 2 || totalPoints > 10_000) {
    return 'Vector geometry requires between 2 and 10000 anchor points.';
  }
  if (!VECTOR_FILL_RULES.has(vector.fillRule)) return 'Vector fill rule is invalid.';
  if (!VECTOR_STROKE_CAPS.has(vector.strokeCap)) return 'Vector stroke cap is invalid.';
  if (!VECTOR_STROKE_JOINS.has(vector.strokeJoin)) return 'Vector stroke join is invalid.';
  const contourIds = new Set<string>();
  const pointIds = new Set<string>();
  for (const contour of contours) {
    if (!contour.id || contourIds.has(contour.id)) return 'Vector contour IDs must be non-empty and unique.';
    contourIds.add(contour.id);
    if (contour.points.length < 2) return `Vector contour ${contour.id} requires at least two anchor points.`;
    for (const point of contour.points) {
      if (!point.id || pointIds.has(point.id)) return 'Vector anchor IDs must be non-empty and unique.';
      pointIds.add(point.id);
      if (!VECTOR_POINT_TYPES.has(point.pointType)) return `Vector anchor ${point.id} has an invalid point type.`;
      const coordinates = [
        point.x,
        point.y,
        point.handleIn?.x,
        point.handleIn?.y,
        point.handleOut?.x,
        point.handleOut?.y,
      ].filter((value): value is number => value !== undefined);
      if (coordinates.some((value) => !Number.isFinite(value))) return `Vector anchor ${point.id} must be finite.`;
    }
  }
  if (vector.booleanOperation) {
    if (vector.booleanOperation.operands.length < 2)
      return 'A vector boolean operation requires at least two operands.';
    const operandIds = new Set<string>();
    const referencedContours = new Set<string>();
    for (const operand of vector.booleanOperation.operands) {
      if (!operand.id || operandIds.has(operand.id)) return 'Vector boolean operand IDs must be non-empty and unique.';
      operandIds.add(operand.id);
      if (operand.contourIds.length === 0) return `Vector boolean operand ${operand.id} requires a contour.`;
      for (const contourId of operand.contourIds) {
        if (!contourIds.has(contourId)) return `Vector boolean operand ${operand.id} references a missing contour.`;
        if (referencedContours.has(contourId))
          return `Vector contour ${contourId} belongs to multiple boolean operands.`;
        referencedContours.add(contourId);
      }
    }
  }
  if (vector.booleanOperation && vector.maskOperation) {
    return 'A vector geometry cannot be both a boolean group and a mask group.';
  }
  if (vector.maskOperation) {
    if (vector.maskOperation.operands.length < 2) return 'A vector mask requires at least two operands.';
    const operandIds = new Set<string>();
    const referencedContours = new Set<string>();
    for (const operand of vector.maskOperation.operands) {
      if (!operand.id || operandIds.has(operand.id)) return 'Vector mask operand IDs must be non-empty and unique.';
      operandIds.add(operand.id);
      if (operand.contourIds.length === 0) return `Vector mask operand ${operand.id} requires a contour.`;
      for (const contourId of operand.contourIds) {
        if (!contourIds.has(contourId)) return `Vector mask operand ${operand.id} references a missing contour.`;
        if (referencedContours.has(contourId)) return `Vector contour ${contourId} belongs to multiple mask operands.`;
        referencedContours.add(contourId);
      }
    }
    if (!operandIds.has(vector.maskOperation.maskOperandId)) return 'Vector mask operand must reference an operand.';
    if (referencedContours.size !== contourIds.size) return 'Every vector mask contour must belong to one operand.';
    const maskOperand = vector.maskOperation.operands.find(
      (operand) => operand.id === vector.maskOperation?.maskOperandId
    );
    if (maskOperand?.contourIds.some((contourId) => !contours.find((contour) => contour.id === contourId)?.closed)) {
      return 'Vector masks require closed mask contours.';
    }
  }

  if (!Number.isFinite(vector.miterLimit) || vector.miterLimit < 1 || vector.miterLimit > 1_000) {
    return 'Vector miter limit must be between 1 and 1000.';
  }
  return undefined;
}

const transformVectorPoint = (
  point: ViuVectorPoint,
  transform: readonly [number, number, number, number, number, number]
): ViuVectorPoint => {
  const [a, b, c, d, e, f] = transform;
  const transformHandle = (handle: ViuVectorHandle | undefined): ViuVectorHandle | undefined =>
    handle ? { x: a * handle.x + c * handle.y, y: b * handle.x + d * handle.y } : undefined;
  return {
    ...point,
    x: a * point.x + c * point.y + e,
    y: b * point.x + d * point.y + f,
    handleIn: transformHandle(point.handleIn),
    handleOut: transformHandle(point.handleOut),
  };
};

/**
 * Creates a geometry-level, non-destructive boolean group. Ordered operand-to-contour references are retained so
 * Canvas, Present, and agents can render or revise the exact same operation without flattening its inputs.
 */
export function createViuBooleanGeometry(
  inputs: readonly ViuVectorBooleanInput[],
  kind: ViuVectorBooleanKind
): ViuVectorGeometry {
  if (inputs.length < 2) throw new Error('A vector boolean operation requires at least two operands.');
  const contours: ViuVectorContour[] = [];
  const operands: ViuVectorBooleanOperand[] = [];
  const inputIds = new Set<string>();
  for (const input of inputs) {
    if (!input.id || inputIds.has(input.id))
      throw new Error('Vector boolean operand IDs must be non-empty and unique.');
    inputIds.add(input.id);
    const error = validateViuVectorGeometry(input.geometry);
    if (error) throw new Error(error);
    if (input.geometry.maskOperation) throw new Error('Release a vector mask before applying a boolean operation.');
    const transform = input.transform ?? [1, 0, 0, 1, 0, 0];
    if (transform.some((value) => !Number.isFinite(value)))
      throw new Error('Vector boolean transforms must be finite.');
    const operandContourIds: string[] = [];
    for (const [index, sourceContour] of getViuVectorContours(input.geometry).entries()) {
      if (!sourceContour.closed) throw new Error('Vector boolean operations require closed contours.');
      const contourId = `${input.id}:contour-${index + 1}`;
      operandContourIds.push(contourId);
      contours.push({
        id: contourId,
        closed: true,
        points: sourceContour.points.map((point) => ({
          ...transformVectorPoint(point, transform),
          id: `${input.id}:${point.id}`,
        })),
      });
    }
    operands.push({ id: input.id, contourIds: operandContourIds });
  }
  const firstGeometry = inputs[0]!.geometry;
  const result = replaceViuVectorContours({ ...firstGeometry, booleanOperation: { kind, operands } }, contours);
  const error = validateViuVectorGeometry(result);
  if (error) throw new Error(error);
  return result;
}

/** Creates an ordered, editable clipping or alpha mask without flattening its source contours. */
export function createViuMaskGeometry(
  inputs: readonly ViuVectorBooleanInput[],
  kind: ViuVectorMaskKind,
  maskOperandId = inputs.at(-1)?.id
): ViuVectorGeometry {
  if (inputs.length < 2) throw new Error('A vector mask requires at least two operands.');
  if (!maskOperandId) throw new Error('A vector mask requires a mask operand.');
  const contours: ViuVectorContour[] = [];
  const operands: ViuVectorBooleanOperand[] = [];
  const inputIds = new Set<string>();
  for (const input of inputs) {
    if (!input.id || inputIds.has(input.id)) throw new Error('Vector mask operand IDs must be non-empty and unique.');
    inputIds.add(input.id);
    const error = validateViuVectorGeometry(input.geometry);
    if (error) throw new Error(error);
    if (input.geometry.booleanOperation || input.geometry.maskOperation) {
      throw new Error('Release nested vector operations before creating a mask.');
    }
    const transform = input.transform ?? [1, 0, 0, 1, 0, 0];
    if (transform.some((value) => !Number.isFinite(value))) throw new Error('Vector mask transforms must be finite.');
    const operandContourIds: string[] = [];
    for (const [index, sourceContour] of getViuVectorContours(input.geometry).entries()) {
      if (input.id === maskOperandId && !sourceContour.closed) {
        throw new Error('Vector masks require closed mask contours.');
      }
      const contourId = `${input.id}:contour-${index + 1}`;
      operandContourIds.push(contourId);
      contours.push({
        id: contourId,
        closed: sourceContour.closed,
        points: sourceContour.points.map((point) => ({
          ...transformVectorPoint(point, transform),
          id: `${input.id}:${point.id}`,
        })),
      });
    }
    operands.push({ id: input.id, contourIds: operandContourIds });
  }
  if (!inputIds.has(maskOperandId)) throw new Error('Vector mask operand must reference an input.');
  const firstGeometry = inputs[0]!.geometry;
  const result = replaceViuVectorContours(
    {
      ...firstGeometry,
      booleanOperation: undefined,
      maskOperation: { kind, operands, maskOperandId },
    },
    contours
  );
  const error = validateViuVectorGeometry(result);
  if (error) throw new Error(error);
  return result;
}

/** Reorders mask operands and treats the top-most (last) operand as the active mask source. */
export function reorderViuMaskOperands(
  vector: ViuVectorGeometry,
  orderedOperandIds: readonly string[]
): ViuVectorGeometry {
  const operation = vector.maskOperation;
  if (!operation) throw new Error('Vector geometry is not a mask group.');
  if (
    orderedOperandIds.length !== operation.operands.length ||
    new Set(orderedOperandIds).size !== orderedOperandIds.length ||
    orderedOperandIds.some((id) => !operation.operands.some((operand) => operand.id === id))
  ) {
    throw new Error('Mask operand order must contain every operand exactly once.');
  }
  const operands = orderedOperandIds.map((id) => operation.operands.find((operand) => operand.id === id)!);
  return {
    ...vector,
    maskOperation: { ...operation, operands, maskOperandId: orderedOperandIds.at(-1)! },
  };
}

/** Releases a mask group while preserving every editable source contour. */
export function releaseViuMaskGeometry(vector: ViuVectorGeometry): ViuVectorGeometry {
  if (!vector.maskOperation) return vector;
  return { ...vector, maskOperation: undefined };
}

/** Creates an immediately editable rectangle or B?zier pen preset in local node coordinates. */
export function createDefaultViuVectorGeometry(
  width: number,
  height: number,
  preset: 'rectangle' | 'pen' = 'rectangle'
): ViuVectorGeometry {
  const safeWidth = safeDimension(width);
  const safeHeight = safeDimension(height);
  const points: ViuVectorPoint[] =
    preset === 'pen'
      ? [
          {
            id: 'point-1',
            x: safeWidth * 0.08,
            y: safeHeight * 0.62,
            handleOut: { x: safeWidth * 0.2, y: -safeHeight * 0.52 },
            pointType: 'smooth',
          },
          {
            id: 'point-2',
            x: safeWidth * 0.5,
            y: safeHeight * 0.18,
            handleIn: { x: -safeWidth * 0.18, y: 0 },
            handleOut: { x: safeWidth * 0.18, y: 0 },
            pointType: 'smooth',
          },
          {
            id: 'point-3',
            x: safeWidth * 0.92,
            y: safeHeight * 0.62,
            handleIn: { x: -safeWidth * 0.2, y: -safeHeight * 0.52 },
            pointType: 'smooth',
          },
        ]
      : [
          { id: 'point-1', x: 0, y: 0, pointType: 'corner' },
          { id: 'point-2', x: safeWidth, y: 0, pointType: 'corner' },
          { id: 'point-3', x: safeWidth, y: safeHeight, pointType: 'corner' },
          { id: 'point-4', x: 0, y: safeHeight, pointType: 'corner' },
        ];
  const closed = preset === 'rectangle';
  return {
    pathData: createViuSvgPathData(points, closed),
    points,
    closed,
    contours: [{ id: 'contour-1', points, closed }],
    fillRule: 'nonzero',
    strokeCap: 'round',
    strokeJoin: 'round',
    miterLimit: 4,
  };
}
