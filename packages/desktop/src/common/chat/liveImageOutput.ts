/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export const LIVE_IMAGE_OUTPUT_STATES = [
  'queued',
  'running',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
] as const;

export type LiveImageOutputState = (typeof LIVE_IMAGE_OUTPUT_STATES)[number];
export type LiveImageOutputSource = 'browser-screenshot';
export type LiveImageOutputErrorCode = 'CAPTURE_FAILED' | 'PUBLICATION_FAILED' | 'OUTPUT_UNAVAILABLE';

export type LiveImageOutputImage = Readonly<{
  outputRef: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}>;

/**
 * Renderer-safe lifecycle projection. It deliberately never contains a file
 * path, image bytes, remote URL, provider response, or capture metadata.
 */
export type LiveImageOutputUpdate = Readonly<{
  schemaVersion: 1;
  outputId: string;
  revision: number;
  conversationId: string;
  runId: string;
  source: LiveImageOutputSource;
  state: LiveImageOutputState;
  image?: LiveImageOutputImage;
  receiptId?: string;
  errorCode?: LiveImageOutputErrorCode;
}>;

const MAX_OPAQUE_ID_LENGTH = 200;
const MAX_DIMENSION = 16_384;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const OPAQUE_ID = /^[A-Za-z0-9._:@-]+$/;
const OUTPUT_REF = /^[A-Za-z0-9._:@-]+$/;
const ERROR_CODES = new Set<LiveImageOutputErrorCode>(['CAPTURE_FAILED', 'PUBLICATION_FAILED', 'OUTPUT_UNAVAILABLE']);
const STATES = new Set<LiveImageOutputState>(LIVE_IMAGE_OUTPUT_STATES);
const TERMINAL_STATES = new Set<LiveImageOutputState>(['completed', 'failed', 'cancelled']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const isOpaqueId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_OPAQUE_ID_LENGTH && OPAQUE_ID.test(value);

const isOutputRef = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_OPAQUE_ID_LENGTH && OUTPUT_REF.test(value);

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_REVISION;

const isDimension = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_DIMENSION;

const parseImage = (value: unknown): LiveImageOutputImage | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['outputRef', 'mimeType', 'width', 'height'])) return undefined;
  if (!isOutputRef(value.outputRef) || value.mimeType !== 'image/png') return undefined;
  if (!isDimension(value.width) || !isDimension(value.height)) return undefined;
  return Object.freeze({
    outputRef: value.outputRef,
    mimeType: 'image/png',
    width: value.width,
    height: value.height,
  });
};

/**
 * Parses only a bounded renderer-safe image output update. Any caller-supplied
 * path, URL, binary payload, unrecognised field, or invalid state shape fails
 * closed instead of being passed to the conversation renderer.
 */
export const parseLiveImageOutputUpdate = (value: unknown): LiveImageOutputUpdate | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaVersion',
      'outputId',
      'revision',
      'conversationId',
      'runId',
      'source',
      'state',
      'image',
      'receiptId',
      'errorCode',
    ]) ||
    value.schemaVersion !== 1 ||
    !isOpaqueId(value.outputId) ||
    !isRevision(value.revision) ||
    !isOpaqueId(value.conversationId) ||
    !isOpaqueId(value.runId) ||
    value.source !== 'browser-screenshot' ||
    typeof value.state !== 'string' ||
    !STATES.has(value.state as LiveImageOutputState)
  ) {
    return undefined;
  }

  const state = value.state as LiveImageOutputState;
  const image = value.image === undefined ? undefined : parseImage(value.image);
  const receiptId = typeof value.receiptId === 'string' ? value.receiptId : undefined;
  const errorCode = value.errorCode;

  if (value.image !== undefined && image === undefined) return undefined;
  if (receiptId !== undefined && !isOpaqueId(receiptId)) return undefined;
  if (errorCode !== undefined && (typeof errorCode !== 'string' || !ERROR_CODES.has(errorCode as LiveImageOutputErrorCode))) {
    return undefined;
  }
  if (state === 'completed') {
    if (!image || !receiptId || errorCode !== undefined) return undefined;
  } else if (image !== undefined || receiptId !== undefined) {
    return undefined;
  }
  if (state === 'failed' && errorCode === undefined) return undefined;
  if (state !== 'failed' && errorCode !== undefined) return undefined;

  return Object.freeze({
    schemaVersion: 1,
    outputId: value.outputId,
    revision: value.revision,
    conversationId: value.conversationId,
    runId: value.runId,
    source: 'browser-screenshot',
    state,
    ...(image === undefined ? {} : { image }),
    ...(receiptId === undefined ? {} : { receiptId }),
    ...(errorCode === undefined ? {} : { errorCode: errorCode as LiveImageOutputErrorCode }),
  });
};

/** Returns true only for the single monotonic lifecycle accepted by chat state. */
export const canTransitionLiveImageOutput = (
  previous: LiveImageOutputState,
  next: LiveImageOutputState
): boolean => {
  if (previous === next) return true;
  if (TERMINAL_STATES.has(previous)) return false;
  if (next === 'failed' || next === 'cancelled') return true;
  return (
    (previous === 'queued' && next === 'running') ||
    (previous === 'running' && next === 'finalizing') ||
    (previous === 'finalizing' && next === 'completed')
  );
};

/**
 * Applies a newer update only if it belongs to the same trusted output and
 * preserves the immutable lifecycle. Invalid / stale updates leave the known
 * projection unchanged.
 */
export const mergeLiveImageOutputUpdate = (
  existing: LiveImageOutputUpdate,
  incoming: LiveImageOutputUpdate
): LiveImageOutputUpdate => {
  if (
    existing.outputId !== incoming.outputId ||
    existing.conversationId !== incoming.conversationId ||
    existing.runId !== incoming.runId ||
    existing.source !== incoming.source ||
    incoming.revision <= existing.revision ||
    !canTransitionLiveImageOutput(existing.state, incoming.state)
  ) {
    return existing;
  }
  return incoming;
};
