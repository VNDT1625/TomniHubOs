/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuEffect, ViuFill, ViuGradientStop, ViuNodeStyle, ViuStroke } from '../types';

export type ViuCompiledPaintStyle = {
  background?: string;
  boxShadow?: string;
  filter?: string;
  backdropFilter?: string;
  borderColor?: string;
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted' | 'double';
  borderWidth?: number;
  outline?: string;
  outlineOffset?: number;
};

const finiteInRange = (value: number, minimum: number, maximum: number): boolean =>
  Number.isFinite(value) && value >= minimum && value <= maximum;

const colorWithOpacity = (color: string, opacity: number): string =>
  opacity >= 1 ? color : `color-mix(in srgb, ${color} ${Math.round(opacity * 10_000) / 100}%, transparent)`;

const compileStops = (stops: readonly ViuGradientStop[], opacity: number): string =>
  stops
    .map((stop) => `${colorWithOpacity(stop.color, opacity)} ${Math.round(stop.position * 10_000) / 100}%`)
    .join(', ');

const compileFill = (fill: ViuFill): string => {
  if (fill.type === 'solid') {
    const color = colorWithOpacity(fill.color, fill.opacity);
    return `linear-gradient(${color}, ${color})`;
  }
  const stops = compileStops(fill.stops, fill.opacity);
  return fill.type === 'linear'
    ? `linear-gradient(${fill.angle}deg, ${stops})`
    : `radial-gradient(ellipse ${fill.radius}% ${fill.radius}% at ${fill.centerX}% ${fill.centerY}%, ${stops})`;
};

const strokeBorderStyle = (stroke: ViuStroke): ViuCompiledPaintStyle['borderStyle'] => {
  if (stroke.width === 0) return 'none';
  if (stroke.dashPattern.length === 0) return 'solid';
  return stroke.dashPattern.length === 2 && stroke.dashPattern[0] === stroke.dashPattern[1] ? 'dotted' : 'dashed';
};

/** Compiles the top stroke and lossless multi-stroke approximations for DOM surfaces. */
export const compileViuStrokeStyle = (style: ViuNodeStyle): ViuCompiledPaintStyle => {
  const visible = style.strokes?.filter((stroke) => stroke.visible && stroke.width > 0) ?? [];
  if (style.strokes === undefined) {
    return {
      borderColor: style.borderColor,
      borderStyle: style.borderStyle ?? (style.borderWidth ? 'solid' : undefined),
      borderWidth: style.borderWidth,
    };
  }
  const primary = visible.at(-1);
  if (!primary) return { borderStyle: 'none', borderWidth: 0 };
  const color = colorWithOpacity(primary.color, primary.opacity);
  const extraShadows = visible.slice(0, -1).map((stroke) => {
    const inset = stroke.alignment === 'inside' ? 'inset ' : '';
    const spread = stroke.alignment === 'center' ? stroke.width / 2 : stroke.width;
    return `${inset}0 0 0 ${spread}px ${colorWithOpacity(stroke.color, stroke.opacity)}`;
  });
  return {
    borderColor: primary.alignment === 'outside' ? 'transparent' : color,
    borderStyle: primary.alignment === 'outside' ? 'none' : strokeBorderStyle(primary),
    borderWidth: primary.alignment === 'outside' ? 0 : primary.width,
    outline:
      primary.alignment === 'outside'
        ? `${primary.width}px ${strokeBorderStyle(primary) ?? 'solid'} ${color}`
        : undefined,
    outlineOffset: primary.alignment === 'outside' ? 0 : undefined,
    boxShadow: extraShadows.join(', ') || undefined,
  };
};

/** Compiles structured paints while retaining legacy raw CSS as a lossless fallback. */
export const compileViuPaintStyle = (style: ViuNodeStyle): ViuCompiledPaintStyle => {
  const visibleFills = style.fills?.filter((fill) => fill.visible);
  const visibleEffects = style.effects?.filter((effect) => effect.visible);
  const shadows = visibleEffects
    ?.filter((effect): effect is Extract<ViuEffect, { type: 'drop-shadow' | 'inner-shadow' }> =>
      ['drop-shadow', 'inner-shadow'].includes(effect.type)
    )
    .map(
      (effect) =>
        `${effect.type === 'inner-shadow' ? 'inset ' : ''}${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${effect.color}`
    );
  const layerBlur = visibleEffects
    ?.filter((effect): effect is Extract<ViuEffect, { type: 'layer-blur' }> => effect.type === 'layer-blur')
    .map((effect) => `blur(${effect.radius}px)`);
  const backdropBlur = visibleEffects
    ?.filter((effect): effect is Extract<ViuEffect, { type: 'backdrop-blur' }> => effect.type === 'backdrop-blur')
    .map((effect) => `blur(${effect.radius}px)`);
  const strokeStyle = compileViuStrokeStyle(style);
  const compiledShadows = [
    style.effects === undefined ? style.shadow : shadows?.join(', ') || undefined,
    strokeStyle.boxShadow,
  ].filter((value): value is string => Boolean(value));
  return {
    background:
      style.fills === undefined ? style.background : visibleFills?.map(compileFill).join(', ') || 'transparent',
    ...strokeStyle,
    boxShadow: compiledShadows.join(', ') || undefined,
    filter:
      style.effects === undefined
        ? style.blur === undefined
          ? undefined
          : `blur(${style.blur}px)`
        : layerBlur?.join(' ') || undefined,
    backdropFilter:
      style.effects === undefined
        ? style.backdropBlur === undefined
          ? undefined
          : `blur(${style.backdropBlur}px)`
        : backdropBlur?.join(' ') || undefined,
  };
};

const validateStops = (stops: readonly ViuGradientStop[]): string | undefined => {
  if (stops.length < 2 || stops.length > 32) return 'gradient must contain between 2 and 32 stops.';
  for (const stop of stops) {
    if (!stop.color.trim() || stop.color.length > 1_000) return 'gradient contains an invalid color.';
    if (!finiteInRange(stop.position, 0, 1)) return 'gradient contains an invalid stop position.';
  }
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index]!.position < stops[index - 1]!.position) return 'gradient stops must be ordered by position.';
  }
  return undefined;
};

/** Returns a transaction-safe error fragment for structured paint/effect data. */
export const validateViuNodeStyle = (style: Partial<ViuNodeStyle>, partial = false): string | undefined => {
  if (!partial && !finiteInRange(style.opacity ?? Number.NaN, 0, 1)) return 'has invalid opacity.';
  if (
    style.borderRadii &&
    (!Array.isArray(style.borderRadii) ||
      style.borderRadii.length !== 4 ||
      !style.borderRadii.every((value) => finiteInRange(value, 0, 1_000_000)))
  ) {
    return 'has invalid corner radii.';
  }
  if (style.fills) {
    if (style.fills.length > 32) return 'has more than 32 fills.';
    if (new Set(style.fills.map((fill) => fill.id)).size !== style.fills.length) return 'has duplicate fill ids.';
    for (const fill of style.fills) {
      if (!fill.id.trim()) return 'has a fill without an id.';
      if (!finiteInRange(fill.opacity, 0, 1)) return `fill ${fill.id} has invalid opacity.`;
      if (fill.type === 'solid') {
        if (!fill.color.trim() || fill.color.length > 1_000) return `fill ${fill.id} has invalid color.`;
      } else {
        const stopError = validateStops(fill.stops);
        if (stopError) return `fill ${fill.id} ${stopError}`;
        if (fill.type === 'linear' && !finiteInRange(fill.angle, -3_600, 3_600)) {
          return `fill ${fill.id} has invalid angle.`;
        }
        if (
          fill.type === 'radial' &&
          (![fill.centerX, fill.centerY].every((value) => finiteInRange(value, -1_000, 1_000)) ||
            !finiteInRange(fill.radius, 0.01, 10_000))
        ) {
          return `fill ${fill.id} has invalid radial geometry.`;
        }
      }
    }
  }
  if (style.strokes) {
    if (style.strokes.length > 32) return 'has more than 32 strokes.';
    if (new Set(style.strokes.map((stroke) => stroke.id)).size !== style.strokes.length) {
      return 'has duplicate stroke ids.';
    }
    const alignments = new Set(['inside', 'center', 'outside']);
    const caps = new Set(['butt', 'round', 'square']);
    const joins = new Set(['miter', 'round', 'bevel']);
    for (const stroke of style.strokes) {
      if (!stroke.id.trim()) return 'has a stroke without an id.';
      if (!finiteInRange(stroke.opacity, 0, 1)) return `stroke ${stroke.id} has invalid opacity.`;
      if (!stroke.color.trim() || stroke.color.length > 1_000) return `stroke ${stroke.id} has invalid color.`;
      if (!finiteInRange(stroke.width, 0, 10_000)) return `stroke ${stroke.id} has invalid width.`;
      if (!alignments.has(stroke.alignment) || !caps.has(stroke.cap) || !joins.has(stroke.join)) {
        return `stroke ${stroke.id} has invalid alignment, cap, or join.`;
      }
      if (!finiteInRange(stroke.miterLimit, 1, 1_000)) return `stroke ${stroke.id} has invalid miter limit.`;
      if (stroke.dashPattern.length > 32 || stroke.dashPattern.some((value) => !finiteInRange(value, 0, 100_000))) {
        return `stroke ${stroke.id} has an invalid dash pattern.`;
      }
      if (stroke.dashPattern.length > 0 && stroke.dashPattern.every((value) => value === 0)) {
        return `stroke ${stroke.id} dash pattern cannot contain only zeroes.`;
      }
      if (!finiteInRange(stroke.dashOffset, -100_000, 100_000)) return `stroke ${stroke.id} has invalid dash offset.`;
    }
  }
  if (style.effects) {
    if (style.effects.length > 32) return 'has more than 32 effects.';
    if (new Set(style.effects.map((effect) => effect.id)).size !== style.effects.length) {
      return 'has duplicate effect ids.';
    }
    for (const effect of style.effects) {
      if (!effect.id.trim()) return 'has an effect without an id.';
      if (effect.type === 'layer-blur' || effect.type === 'backdrop-blur') {
        if (!finiteInRange(effect.radius, 0, 200)) return `effect ${effect.id} has invalid blur radius.`;
      } else if (
        ![effect.x, effect.y, effect.spread].every((value) => finiteInRange(value, -10_000, 10_000)) ||
        !finiteInRange(effect.blur, 0, 10_000) ||
        !effect.color.trim() ||
        effect.color.length > 1_000
      ) {
        return `effect ${effect.id} has invalid shadow data.`;
      }
    }
  }
  return undefined;
};
