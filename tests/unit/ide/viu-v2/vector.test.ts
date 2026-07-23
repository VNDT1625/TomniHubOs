/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createDefaultViuVectorGeometry,
  createViuBooleanGeometry,
  createViuCompoundPathData,
  createViuMaskGeometry,
  getViuVectorContours,
  releaseViuMaskGeometry,
  reorderViuMaskOperands,
  replaceViuVectorContours,
  createViuSvgPathData,
  validateViuSvgPathData,
  validateViuVectorGeometry,
  type ViuVectorGeometry,
  type ViuVectorPoint,
} from '@/common/viu/graphics/vector';

describe('VIU vector geometry', () => {
  it('builds a closed cubic contour from relative anchor handles', () => {
    const points: ViuVectorPoint[] = [
      { id: 'a', x: 0, y: 0, handleOut: { x: 20, y: 0 }, pointType: 'smooth' },
      { id: 'b', x: 100, y: 50, handleIn: { x: -20, y: 0 }, pointType: 'smooth' },
      { id: 'c', x: 0, y: 100, pointType: 'corner' },
    ];

    const pathData = createViuSvgPathData(points, true);

    expect(pathData).toContain('C 20 0 80 50 100 50');
    expect(pathData.endsWith('Z')).toBe(true);
    expect(validateViuSvgPathData(pathData)).toBeUndefined();
  });

  it('accepts standard relative commands and arc flags', () => {
    expect(validateViuSvgPathData('M 10 10 h 80 v 80 h -80 Z')).toBeUndefined();
    expect(validateViuSvgPathData('M 10 50 A 40 40 0 1 0 90 50')).toBeUndefined();
  });

  it('rejects unsafe syntax, missing coordinates, and invalid arc flags', () => {
    expect(validateViuSvgPathData('M 0 0 L 10 10 onload=alert(1)')).toContain('invalid syntax');
    expect(validateViuSvgPathData('M 0 0 C 10 10')).toContain('coordinate count');
    expect(validateViuSvgPathData('M 0 0 A 10 10 0 2 0 20 20')).toContain('flags');
  });

  it('rejects duplicate anchors and a closed-state mismatch', () => {
    const geometry = createDefaultViuVectorGeometry(200, 120);
    geometry.points[1]!.id = geometry.points[0]!.id;
    expect(validateViuVectorGeometry(geometry)).toContain('unique');

    const openGeometry = createDefaultViuVectorGeometry(200, 120, 'pen');
    openGeometry.closed = true;
    expect(validateViuVectorGeometry(openGeometry)).toContain('closed state');
  });

  it('rejects unsupported geometry enum values before rendering', () => {
    const geometry = createDefaultViuVectorGeometry(200, 120);
    geometry.fillRule = 'winding' as ViuVectorGeometry['fillRule'];
    expect(validateViuVectorGeometry(geometry)).toContain('fill rule');

    geometry.fillRule = 'nonzero';
    geometry.points[0]!.pointType = 'curve' as ViuVectorPoint['pointType'];
    expect(validateViuVectorGeometry(geometry)).toContain('point type');
  });

  it('normalizes non-finite preset dimensions into editable finite anchors', () => {
    const geometry = createDefaultViuVectorGeometry(Number.NaN, Number.POSITIVE_INFINITY);

    expect(validateViuVectorGeometry(geometry)).toBeUndefined();
    expect(geometry.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('creates editable rectangle and pen presets with valid geometry', () => {
    const rectangle = createDefaultViuVectorGeometry(200, 120, 'rectangle');
    const pen = createDefaultViuVectorGeometry(200, 120, 'pen');

    expect(validateViuVectorGeometry(rectangle)).toBeUndefined();
    expect(validateViuVectorGeometry(pen)).toBeUndefined();
    expect(pen.points.some((point) => point.handleIn || point.handleOut)).toBe(true);
  });

  it('round-trips independent contours into one valid compound SVG path', () => {
    const first = createDefaultViuVectorGeometry(100, 100);
    const second = createDefaultViuVectorGeometry(40, 40);
    const contours = [
      ...getViuVectorContours(first),
      {
        ...getViuVectorContours(second)[0]!,
        id: 'contour-2',
        points: second.points.map((point) => ({
          ...point,
          id: `second-${point.id}`,
          x: point.x + 30,
          y: point.y + 30,
        })),
      },
    ];
    const geometry = replaceViuVectorContours(first, contours);

    expect(createViuCompoundPathData(contours).match(/M /g)).toHaveLength(2);
    expect(validateViuSvgPathData(geometry.pathData)).toBeUndefined();
    expect(validateViuVectorGeometry(geometry)).toBeUndefined();
  });

  it.each(['union', 'subtract', 'intersect', 'exclude'] as const)(
    'preserves ordered operands for a non-destructive %s boolean',
    (kind) => {
      const geometry = createViuBooleanGeometry(
        [
          { id: 'back', geometry: createDefaultViuVectorGeometry(100, 100) },
          {
            id: 'front',
            geometry: createDefaultViuVectorGeometry(60, 60),
            transform: [1, 0, 0, 1, 20, 20],
          },
        ],
        kind
      );

      expect(geometry.booleanOperation?.kind).toBe(kind);
      expect(geometry.booleanOperation?.operands.map((operand) => operand.id)).toEqual(['back', 'front']);
      expect(getViuVectorContours(geometry)).toHaveLength(2);
      expect(validateViuVectorGeometry(geometry)).toBeUndefined();
    }
  );

  it('rejects open or duplicate boolean operands without returning partial geometry', () => {
    expect(() =>
      createViuBooleanGeometry(
        [
          { id: 'shape', geometry: createDefaultViuVectorGeometry(100, 100) },
          { id: 'shape', geometry: createDefaultViuVectorGeometry(80, 80) },
        ],
        'union'
      )
    ).toThrow('unique');

    expect(() =>
      createViuBooleanGeometry(
        [
          { id: 'closed', geometry: createDefaultViuVectorGeometry(100, 100) },
          { id: 'open', geometry: createDefaultViuVectorGeometry(80, 80, 'pen') },
        ],
        'subtract'
      )
    ).toThrow('closed');
  });

  it('rejects boolean contour references that are missing or shared by operands', () => {
    const geometry = createViuBooleanGeometry(
      [
        { id: 'a', geometry: createDefaultViuVectorGeometry(100, 100) },
        { id: 'b', geometry: createDefaultViuVectorGeometry(80, 80) },
      ],
      'union'
    );
    geometry.booleanOperation!.operands[1]!.contourIds = geometry.booleanOperation!.operands[0]!.contourIds;

    expect(validateViuVectorGeometry(geometry)).toMatch(/multiple|missing/);
  });

  it.each(['clip', 'alpha'] as const)('creates and releases an ordered editable %s mask', (kind) => {
    const geometry = createViuMaskGeometry(
      [
        { id: 'content', geometry: createDefaultViuVectorGeometry(120, 100) },
        {
          id: 'mask',
          geometry: createDefaultViuVectorGeometry(60, 60),
          transform: [1, 0, 0, 1, 30, 20],
        },
      ],
      kind
    );

    expect(geometry.maskOperation).toMatchObject({ kind, maskOperandId: 'mask' });
    expect(geometry.maskOperation?.operands.map((operand) => operand.id)).toEqual(['content', 'mask']);
    expect(validateViuVectorGeometry(geometry)).toBeUndefined();

    const released = releaseViuMaskGeometry(geometry);
    expect(released.maskOperation).toBeUndefined();
    expect(getViuVectorContours(released)).toHaveLength(2);
  });

  it('reorders the mask stack and rejects invalid or open mask operands', () => {
    const geometry = createViuMaskGeometry(
      [
        { id: 'content', geometry: createDefaultViuVectorGeometry(120, 100) },
        { id: 'mask', geometry: createDefaultViuVectorGeometry(60, 60) },
      ],
      'clip'
    );
    const reordered = reorderViuMaskOperands(geometry, ['mask', 'content']);

    expect(reordered.maskOperation?.maskOperandId).toBe('content');
    expect(() => reorderViuMaskOperands(geometry, ['content', 'missing'])).toThrow('every operand');
    expect(() =>
      createViuMaskGeometry(
        [
          { id: 'content', geometry: createDefaultViuVectorGeometry(120, 100) },
          { id: 'mask', geometry: createDefaultViuVectorGeometry(60, 60, 'pen') },
        ],
        'alpha'
      )
    ).toThrow('closed');
  });

  it('rejects a mask whose contour ownership or mask operand reference is invalid', () => {
    const geometry = createViuMaskGeometry(
      [
        { id: 'content', geometry: createDefaultViuVectorGeometry(120, 100) },
        { id: 'mask', geometry: createDefaultViuVectorGeometry(60, 60) },
      ],
      'clip'
    );
    geometry.maskOperation!.maskOperandId = 'missing';
    expect(validateViuVectorGeometry(geometry)).toContain('reference');

    geometry.maskOperation!.maskOperandId = 'mask';
    geometry.maskOperation!.operands[1]!.contourIds = geometry.maskOperation!.operands[0]!.contourIds;
    expect(validateViuVectorGeometry(geometry)).toContain('multiple');
  });
});
