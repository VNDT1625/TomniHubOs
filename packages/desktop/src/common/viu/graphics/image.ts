/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ViuImageFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
export type ViuImageCrop = { x: number; y: number; width: number; height: number };
export type ViuImageTransform = {
  fit: ViuImageFit;
  crop: ViuImageCrop;
  focalPoint: { x: number; y: number };
  rotation: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
};

export type ViuCompiledImageStyle = {
  position: 'absolute';
  width: string;
  height: string;
  left: string;
  top: string;
  objectFit: ViuImageFit;
  objectPosition: string;
  transform: string;
  transformOrigin: string;
};

export const DEFAULT_VIU_IMAGE_TRANSFORM: Readonly<ViuImageTransform> = {
  fit: 'cover',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  focalPoint: { x: 0.5, y: 0.5 },
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
};

const finiteInRange = (value: number, minimum: number, maximum: number): boolean =>
  Number.isFinite(value) && value >= minimum && value <= maximum;

const roundPercent = (value: number): string => `${Math.round(value * 10_000) / 100}%`;

/** Returns a transaction-safe error fragment for editable image framing data. */
export const validateViuImageTransform = (transform: ViuImageTransform): string | undefined => {
  if (!['cover', 'contain', 'fill', 'none', 'scale-down'].includes(transform.fit)) return 'has an invalid image fit.';
  const { crop, focalPoint } = transform;
  if (
    !finiteInRange(crop.x, 0, 1) ||
    !finiteInRange(crop.y, 0, 1) ||
    !finiteInRange(crop.width, 0.001, 1) ||
    !finiteInRange(crop.height, 0.001, 1) ||
    crop.x + crop.width > 1.000_001 ||
    crop.y + crop.height > 1.000_001
  ) {
    return 'has invalid normalized crop bounds.';
  }
  if (!finiteInRange(focalPoint.x, 0, 1) || !finiteInRange(focalPoint.y, 0, 1)) {
    return 'has an invalid image focal point.';
  }
  if (!finiteInRange(transform.rotation, -360_000, 360_000)) return 'has an invalid image rotation.';
  if (typeof transform.flipHorizontal !== 'boolean' || typeof transform.flipVertical !== 'boolean') {
    return 'has invalid image flip flags.';
  }
  return undefined;
};

/** Completes sparse persisted or authoring values with deterministic defaults. */
export const normalizeViuImageTransform = (
  transform?: Partial<ViuImageTransform> & {
    crop?: Partial<ViuImageCrop>;
    focalPoint?: Partial<ViuImageTransform['focalPoint']>;
  }
): ViuImageTransform => ({
  ...DEFAULT_VIU_IMAGE_TRANSFORM,
  ...transform,
  crop: { ...DEFAULT_VIU_IMAGE_TRANSFORM.crop, ...transform?.crop },
  focalPoint: { ...DEFAULT_VIU_IMAGE_TRANSFORM.focalPoint, ...transform?.focalPoint },
});

/** Compiles crop, focal point, rotation and flips into renderer-safe CSS values. */
export const compileViuImageStyle = (transform?: ViuImageTransform): ViuCompiledImageStyle => {
  const normalized = normalizeViuImageTransform(transform);
  const { crop, focalPoint } = normalized;
  const scaleX = normalized.flipHorizontal ? -1 : 1;
  const scaleY = normalized.flipVertical ? -1 : 1;
  return {
    position: 'absolute',
    width: roundPercent(1 / crop.width),
    height: roundPercent(1 / crop.height),
    left: roundPercent(-crop.x / crop.width),
    top: roundPercent(-crop.y / crop.height),
    objectFit: normalized.fit,
    objectPosition: `${roundPercent(focalPoint.x)} ${roundPercent(focalPoint.y)}`,
    transform: `rotate(${normalized.rotation}deg) scale(${scaleX}, ${scaleY})`,
    transformOrigin: `${roundPercent(focalPoint.x)} ${roundPercent(focalPoint.y)}`,
  };
};
