/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Image-to-video clip generation for the Make Video feature.
 *
 * Clip generation is disabled unless a Main-only authority is supplied. The
 * prior direct fal.ai queue transport accepted a renderer-provided API key and
 * bypassed the shared Trust/secret/egress seam, so it must not be enabled.
 *
 * A future authority owns saved credentials, provider destination admission,
 * final serialized-payload inspection, no-redirect/DNS-bounded transport,
 * cancellation, timeout, output-size enforcement, and the durable receipt.
 * This module receives no secret value or provider URL from that authority.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VideoClipConfig, VideoClipConfigFal } from './makeVideoTypes';

/** Minimal fs surface needed (injectable for tests). */
export type VideoClipGenFs = {
  mkdir(dirPath: string, options: { recursive: true }): Promise<string | undefined>;
  writeFile(filePath: string, data: Buffer): Promise<void>;
};

const defaultFs: VideoClipGenFs = {
  mkdir: (dirPath, options) => fs.promises.mkdir(dirPath, options),
  writeFile: (filePath, data) => fs.promises.writeFile(filePath, data),
};

export type VideoClipGenDeps = {
  fs?: VideoClipGenFs;
  /** Override output directory (defaults to userData/make-video/clips). */
  clipsDir?: string;
  /**
   * Main-only transport authority. It is deliberately secret-free: callers
   * cannot pass an API key or arbitrary provider URL through this contract.
   */
  egressAuthority?: VideoClipEgressAuthority;
  /** Requested authority deadline, bounded to five minutes. */
  timeoutMs?: number;
  /** Requested maximum returned artifact bytes, bounded to 100 MiB. */
  maxOutputBytes?: number;
};

export type VideoClipEgressRequest = Readonly<{
  modelId: string;
  imageDataUri: string;
  endImageDataUri?: string;
  prompt: string;
  duration?: 5 | 10;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}>;

export type VideoClipEgressResult = Readonly<{
  videoBytes: Uint8Array;
  contentType?: string;
}>;

/**
 * Main-process authority contract for image-to-video egress. Its implementation
 * must bind the request to a run/origin/capability, resolve an opaque secret
 * lease itself, validate the stored provider destination and final payload, and
 * record cancellation plus a terminal transport receipt. It must never be
 * constructed from renderer-provided credentials or endpoint strings.
 */
export type VideoClipEgressAuthority = Readonly<{
  generateVideoClip(request: VideoClipEgressRequest): Promise<VideoClipEgressResult>;
}>;

const CLIP_EGRESS_AUTHORITY_REQUIRED = 'MAKEVIDEO_VIDEO_CLIP_EGRESS_AUTHORITY_REQUIRED';
const CLIP_ABORTED = 'MAKEVIDEO_VIDEO_CLIP_ABORTED';
const CLIP_TIMED_OUT = 'MAKEVIDEO_VIDEO_CLIP_TIMED_OUT';
const CLIP_EGRESS_FAILED = 'MAKEVIDEO_VIDEO_CLIP_EGRESS_FAILED';
const CLIP_INVALID_RESPONSE = 'MAKEVIDEO_VIDEO_CLIP_INVALID_RESPONSE';
const CLIP_OUTPUT_TOO_LARGE = 'MAKEVIDEO_VIDEO_CLIP_OUTPUT_TOO_LARGE';
const CLIP_INPUT_TOO_LARGE = 'MAKEVIDEO_VIDEO_CLIP_INPUT_TOO_LARGE';
const CLIP_MODEL_INVALID = 'MAKEVIDEO_VIDEO_CLIP_MODEL_INVALID';

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;
const MAX_PROMPT_CHARS = 4_000;

/** Generate a video clip from a start-frame image (and optional end-frame). */
export const generateVideoClip = async (
  frameStartPath: string,
  frameEndPath: string | null | undefined,
  prompt: string,
  config: VideoClipConfig,
  projectId: string,
  sceneId: string,
  deps?: VideoClipGenDeps,
  signal?: AbortSignal
): Promise<string> => {
  if (config.type === 'fal') {
    if (!deps?.egressAuthority) throw new Error(CLIP_EGRESS_AUTHORITY_REQUIRED);
    throwIfAborted(signal);
    return generateVideoClipFal(frameStartPath, frameEndPath, prompt, config, projectId, sceneId, deps, signal);
  }
  throw new Error(`Unsupported video clip provider type: ${(config as { type: string }).type}`);
};

/** Convert a bounded local image file to a data URI for the authority. */
const imageToDataUri = async (imagePath: string): Promise<string> => {
  const stat = await fs.promises.stat(imagePath);
  if (!stat.isFile() || stat.size > MAX_FRAME_BYTES) throw new Error(CLIP_INPUT_TOO_LARGE);
  const data = await fs.promises.readFile(imagePath);
  if (data.byteLength > MAX_FRAME_BYTES) throw new Error(CLIP_INPUT_TOO_LARGE);
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp';
  return `data:${mime};base64,${data.toString('base64')}`;
};

const generateVideoClipFal = async (
  frameStartPath: string,
  frameEndPath: string | null | undefined,
  prompt: string,
  config: VideoClipConfigFal,
  projectId: string,
  sceneId: string,
  deps?: VideoClipGenDeps,
  signal?: AbortSignal
): Promise<string> => {
  const fsImpl = deps?.fs ?? defaultFs;
  const authority = deps?.egressAuthority;
  if (!authority) throw new Error(CLIP_EGRESS_AUTHORITY_REQUIRED);
  if (!isValidModelId(config.model_id)) throw new Error(CLIP_MODEL_INVALID);
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error(CLIP_INVALID_RESPONSE);

  const timeoutMs = boundedLimit(deps?.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxOutputBytes = boundedLimit(deps?.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES);
  const imageDataUri = await imageToDataUri(frameStartPath);
  const endImageDataUri = frameEndPath ? await imageToDataUri(frameEndPath) : undefined;
  const result = await executeThroughAuthority(
    authority,
    {
      modelId: config.model_id,
      imageDataUri,
      ...(endImageDataUri ? { endImageDataUri } : {}),
      prompt: prompt || 'Cinematic motion, smooth camera movement.',
      ...(config.duration ? { duration: config.duration } : {}),
      timeoutMs,
      maxOutputBytes,
    },
    signal
  );

  if (!(result.videoBytes instanceof Uint8Array) || result.videoBytes.byteLength === 0) {
    throw new Error(CLIP_INVALID_RESPONSE);
  }
  if (result.videoBytes.byteLength > maxOutputBytes) throw new Error(CLIP_OUTPUT_TOO_LARGE);
  if (result.contentType && !/^video\/[a-z0-9.+-]+$/i.test(result.contentType)) {
    throw new Error(CLIP_INVALID_RESPONSE);
  }

  const clipsDir =
    deps?.clipsDir ?? path.join(process.env['APPDATA'] ?? process.env['HOME'] ?? '', 'make-video', 'clips');
  await fsImpl.mkdir(clipsDir, { recursive: true });
  const fileName = `clip-${projectId}-${sceneId}.mp4`;
  const filePath = path.join(clipsDir, fileName);
  await fsImpl.writeFile(filePath, Buffer.from(result.videoBytes));
  return filePath;
};

const boundedLimit = (value: number | undefined, fallback: number, maximum: number): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;

const isValidModelId = (modelId: string): boolean => /^[a-z0-9][a-z0-9._/-]{0,191}$/i.test(modelId);

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new Error(CLIP_ABORTED);
};

const executeThroughAuthority = (
  authority: VideoClipEgressAuthority,
  request: Omit<VideoClipEgressRequest, 'signal'>,
  signal: AbortSignal | undefined
): Promise<VideoClipEgressResult> =>
  new Promise((resolve, reject) => {
    const authorityAbort = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abortFromCaller = (): void => {
      authorityAbort.abort();
      settle(() => reject(new Error(CLIP_ABORTED)));
    };

    if (signal?.aborted) {
      abortFromCaller();
      return;
    }
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    timer = setTimeout(() => {
      authorityAbort.abort();
      settle(() => reject(new Error(CLIP_TIMED_OUT)));
    }, request.timeoutMs);

    void Promise.resolve()
      .then(() => authority.generateVideoClip({ ...request, signal: authorityAbort.signal }))
      .then(
        (result) => {
          if (signal?.aborted) {
            abortFromCaller();
            return;
          }
          settle(() => resolve(result));
        },
        () => settle(() => reject(new Error(CLIP_EGRESS_FAILED)))
      );
  });
