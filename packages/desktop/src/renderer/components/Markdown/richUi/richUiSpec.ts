/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSafePublicImageUrl } from './gallerySource';

/** Versioned, display-only assistant UI contract. No HTML, code or privileged actions. */
export type RichUiTone = 'neutral' | 'info' | 'success' | 'warning';
export type RichUiMetric = Readonly<{ label: string; value: string; detail?: string; tone?: RichUiTone }>;
export type RichUiStep = Readonly<{ title: string; description?: string; parallel?: readonly string[] }>;
export type RichUiCard = Readonly<{ title: string; description: string; tag?: string; tone?: RichUiTone }>;
export type RichUiImage = Readonly<{
  src: string;
  alt: string;
  caption?: string;
  source?: string;
  sourceLabel?: string;
}>;
/** Optional quiz controls: 2–4 choices with a known correct index, or text entry.
 * No options / allowTextAnswer means a purely explanatory slide. */
export type RichUiLessonSlide = Readonly<{
  title: string;
  body: string;
  reveal?: string;
  question?: string;
  options?: readonly string[];
  correctIndex?: number;
  allowTextAnswer?: boolean;
}>;

export type RichUiPart =
  | Readonly<{ type: 'metrics'; items: readonly RichUiMetric[] }>
  | Readonly<{ type: 'flow'; steps: readonly RichUiStep[] }>
  | Readonly<{ type: 'cards'; items: readonly RichUiCard[] }>
  | Readonly<{ type: 'table'; columns: readonly string[]; rows: readonly (readonly string[])[] }>
  | Readonly<{ type: 'lesson'; slides: readonly RichUiLessonSlide[] }>
  | Readonly<{ type: 'gallery'; images: readonly RichUiImage[]; targetCount?: number }>;

export type RichUiSpec = Readonly<{
  version: 1;
  title: string;
  description?: string;
  fallbackText: string;
  blocks: readonly RichUiPart[];
}>;

export type RichUiParseResult =
  Readonly<{ ok: true; spec: RichUiSpec }> | Readonly<{ ok: false; fallbackText: string }>;

const MAX_SOURCE_LENGTH = 24_000;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const label = (value: unknown, max = 160): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : undefined;

const optionalLabel = (value: unknown, max = 500): string | undefined => (value === undefined ? '' : label(value, max));

const strings = (value: unknown, min: number, max: number, width = 160): string[] | null => {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const items = value.map((item: unknown) => label(item, width));
  return items.every((item): item is string => item !== undefined) ? items : null;
};

const toneValue = (value: unknown): RichUiTone | undefined =>
  value === 'neutral' || value === 'info' || value === 'success' || value === 'warning' ? value : undefined;

const parsePart = (value: unknown): RichUiPart | null => {
  const part = record(value);
  if (!part) return null;
  if (part.type === 'metrics') {
    if (!Array.isArray(part.items) || part.items.length < 1 || part.items.length > 8) return null;
    const items: RichUiMetric[] = [];
    for (const item of part.items) {
      const entry = record(item);
      const name = label(entry?.label, 80);
      const valueText = label(entry?.value, 80);
      const detail = optionalLabel(entry?.detail);
      if (!name || !valueText || detail === undefined) return null;
      const tone = toneValue(entry?.tone);
      items.push({ label: name, value: valueText, ...(detail ? { detail } : {}), ...(tone ? { tone } : {}) });
    }
    return { type: 'metrics', items };
  }
  if (part.type === 'flow') {
    if (!Array.isArray(part.steps) || part.steps.length < 2 || part.steps.length > 8) return null;
    const steps: RichUiStep[] = [];
    for (const item of part.steps) {
      const entry = record(item);
      const title = label(entry?.title, 100);
      const description = optionalLabel(entry?.description);
      const parallel = entry?.parallel === undefined ? [] : strings(entry.parallel, 2, 5, 80);
      if (!title || description === undefined || parallel === null) return null;
      steps.push({ title, ...(description ? { description } : {}), ...(parallel.length ? { parallel } : {}) });
    }
    return { type: 'flow', steps };
  }
  if (part.type === 'cards') {
    if (!Array.isArray(part.items) || part.items.length < 1 || part.items.length > 8) return null;
    const items: RichUiCard[] = [];
    for (const item of part.items) {
      const entry = record(item);
      const title = label(entry?.title, 100);
      const description = label(entry?.description, 500);
      const tag = optionalLabel(entry?.tag, 50);
      if (!title || !description || tag === undefined) return null;
      const tone = toneValue(entry?.tone);
      items.push({ title, description, ...(tag ? { tag } : {}), ...(tone ? { tone } : {}) });
    }
    return { type: 'cards', items };
  }
  if (part.type === 'gallery') {
    if (!Array.isArray(part.images) || part.images.length < 1 || part.images.length > 32) return null;
    const targetCount = part.targetCount === undefined ? undefined : part.targetCount;
    if (
      targetCount !== undefined &&
      (!Number.isInteger(targetCount) ||
        (targetCount as number) < 1 ||
        (targetCount as number) > 16 ||
        (targetCount as number) > part.images.length)
    )
      return null;
    const images: RichUiImage[] = [];
    for (const image of part.images) {
      const entry = record(image);
      const src = label(entry?.src, 2048);
      const alt = label(entry?.alt, 220);
      const caption = optionalLabel(entry?.caption, 350);
      const source = entry?.source === undefined ? undefined : label(entry.source, 2048);
      const sourceLabel = optionalLabel(entry?.sourceLabel, 100);
      if (!src || !alt || !isSafePublicImageUrl(src) || caption === undefined || sourceLabel === undefined) return null;
      if (entry?.source !== undefined && (!source || !isSafePublicImageUrl(source))) return null;
      images.push({
        src,
        alt,
        ...(caption ? { caption } : {}),
        ...(source ? { source } : {}),
        ...(sourceLabel ? { sourceLabel } : {}),
      });
    }
    return { type: 'gallery', images, ...(targetCount !== undefined ? { targetCount: targetCount as number } : {}) };
  }
  if (part.type === 'lesson') {
    if (!Array.isArray(part.slides) || part.slides.length < 2 || part.slides.length > 10) return null;
    const slides: RichUiLessonSlide[] = [];
    for (const item of part.slides) {
      const entry = record(item);
      const title = label(entry?.title, 120);
      const body = label(entry?.body, 1800);
      const reveal = optionalLabel(entry?.reveal, 1200);
      const question = optionalLabel(entry?.question, 500);
      const options = entry?.options === undefined ? undefined : strings(entry.options, 2, 4, 220);
      const allowTextAnswer = entry?.allowTextAnswer === true;
      const correctIndex = entry?.correctIndex;
      if (!title || !body || reveal === undefined || question === undefined || options === null) return null;
      if (entry?.allowTextAnswer !== undefined && typeof entry.allowTextAnswer !== 'boolean') return null;
      if (
        options &&
        (allowTextAnswer ||
          !question ||
          !Number.isInteger(correctIndex) ||
          (correctIndex as number) < 0 ||
          (correctIndex as number) >= options.length)
      )
        return null;
      if (!options && correctIndex !== undefined) return null;
      if (allowTextAnswer && !question) return null;
      slides.push({
        title,
        body,
        ...(reveal ? { reveal } : {}),
        ...(question ? { question } : {}),
        ...(options ? { options, correctIndex: correctIndex as number } : {}),
        ...(allowTextAnswer ? { allowTextAnswer: true } : {}),
      });
    }
    return { type: 'lesson', slides };
  }
  if (part.type === 'table') {
    const columns = strings(part.columns, 2, 6, 80);
    if (!columns || !Array.isArray(part.rows) || part.rows.length < 1 || part.rows.length > 16) return null;
    const rows: string[][] = [];
    for (const row of part.rows) {
      const cells = strings(row, columns.length, columns.length, 160);
      if (!cells) return null;
      rows.push(cells);
    }
    return { type: 'table', columns, rows };
  }
  return null;
};

/**
 * Validate untrusted model output before rendering. Reject unknown components, oversized
 * payloads and extra executable fields by projecting only allowlisted display values.
 */
export const parseRichUiSpec = (source: string): RichUiParseResult => {
  const rawFallback = source.slice(0, 1_200);
  if (source.length > MAX_SOURCE_LENGTH) return { ok: false, fallbackText: rawFallback };
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return { ok: false, fallbackText: rawFallback };
  }
  const candidate = record(value);
  const plainFallback = label(candidate?.fallbackText, 2_000);
  const fallbackText = plainFallback ?? rawFallback;
  if (candidate?.version !== 1 || !plainFallback) return { ok: false, fallbackText };
  const title = label(candidate.title, 120);
  const description = optionalLabel(candidate.description);
  if (!title || description === undefined || !Array.isArray(candidate.blocks)) return { ok: false, fallbackText };
  if (candidate.blocks.length < 1 || candidate.blocks.length > 8) return { ok: false, fallbackText };
  const blocks: RichUiPart[] = [];
  for (const part of candidate.blocks) {
    const validated = parsePart(part);
    if (!validated) return { ok: false, fallbackText };
    blocks.push(validated);
  }
  return { ok: true, spec: { version: 1, title, ...(description ? { description } : {}), fallbackText, blocks } };
};
