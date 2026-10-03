/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Voice generation (TTS) for the Make Video feature.
 *
 * Supports two provider types:
 *  - `openai`: OpenAI-compatible `/v1/audio/speech` endpoint (OpenAI, Azure,
 *    any compatible local server). Returns binary audio directly.
 *  - `elevenlabs`: ElevenLabs `/v1/text-to-speech/{voice_id}` endpoint.
 *    Uses `xi-api-key` header.
 *
 * The generated audio is saved to `userData/make-video/audio/` and the
 * absolute path is returned. Injectable deps for unit testing.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VoiceConfig } from './makeVideoTypes';

/** Minimal fs surface needed (injectable for tests). */
export type VoiceGenFs = {
  mkdir(dirPath: string, options: { recursive: true }): Promise<string | undefined>;
  writeFile(filePath: string, data: Buffer): Promise<void>;
};

const defaultFs: VoiceGenFs = {
  mkdir: (dirPath, options) => fs.promises.mkdir(dirPath, options),
  writeFile: (filePath, data) => fs.promises.writeFile(filePath, data),
};

export type VoiceGenErrorCode =
  | 'VOICE_EGRESS_AUTHORITY_REQUIRED'
  | 'VOICE_GENERATION_ABORTED'
  | 'VOICE_GENERATION_TIMEOUT'
  | 'VOICE_GENERATION_RESPONSE_INVALID'
  | 'VOICE_GENERATION_RESPONSE_TOO_LARGE'
  | 'VOICE_GENERATION_FAILED';

/** Only a stable error code may cross the MakeVideo Main-process boundary. */
export class VoiceGenError extends Error {
  public constructor(public readonly code: VoiceGenErrorCode) {
    super(code);
    this.name = 'VoiceGenError';
  }
}

/** A secret-free request handed to the one Main-owned TTS transport authority. */
export type VoiceGenerationRequest = Readonly<{
  provider: 'openai' | 'elevenlabs';
  text: string;
  model: string;
  voiceId: string;
  responseFormat: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
}>;

/**
 * The authority is responsible for binding actor, MakeVideo origin, run/task,
 * final serialized payload, destination, opaque secret lease, DNS/redirect
 * policy, cancellation and durable egress evidence before opening a socket.
 * It must never accept a caller supplied API key, base URL, or header.
 */
export type VoiceEgressAuthority = Readonly<{
  synthesize(request: VoiceGenerationRequest, options: { signal: AbortSignal; timeoutMs: number }): Promise<Uint8Array>;
}>;

export type VoiceGenDeps = {
  fs?: VoiceGenFs;
  /** Override output directory (defaults to userData/make-video/audio). */
  audioDir?: string;
  /** Main-only governed transport. Its absence deliberately disables remote TTS. */
  egressAuthority?: VoiceEgressAuthority;
  /** Cancels the authority and prevents an audio artifact from being persisted. */
  signal?: AbortSignal;
  /** Bounded lifetime passed to the Main-owned authority. Defaults to 90 seconds. */
  timeoutMs?: number;
};

const DEFAULT_TTS_TIMEOUT_MS = 90_000;
const MAX_TTS_AUDIO_BYTES = 32 * 1024 * 1024;

const makeRequest = (text: string, config: VoiceConfig): VoiceGenerationRequest =>
  config.type === 'openai'
    ? {
        provider: 'openai',
        text,
        model: config.model,
        voiceId: config.voice,
        responseFormat: config.response_format ?? 'mp3',
      }
    : {
        provider: 'elevenlabs',
        text,
        model: config.model_id,
        voiceId: config.voice_id,
        responseFormat: 'mp3',
      };

const isValidTimeout = (timeoutMs: number): boolean => Number.isSafeInteger(timeoutMs) && timeoutMs > 0;

const createBoundedSignal = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    wasTimedOut: (): boolean => timedOut,
    cleanup: (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    },
  };
};

const throwIfAborted = (signal: AbortSignal, wasTimedOut: () => boolean): void => {
  if (signal.aborted) {
    throw new VoiceGenError(wasTimedOut() ? 'VOICE_GENERATION_TIMEOUT' : 'VOICE_GENERATION_ABORTED');
  }
};

const rejectOnAbort = (signal: AbortSignal, wasTimedOut: () => boolean): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new VoiceGenError(wasTimedOut() ? 'VOICE_GENERATION_TIMEOUT' : 'VOICE_GENERATION_ABORTED'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new VoiceGenError(wasTimedOut() ? 'VOICE_GENERATION_TIMEOUT' : 'VOICE_GENERATION_ABORTED')),
      { once: true }
    );
  });

/**
 * Generates one narration artifact only through an injected Main-owned authority.
 * The legacy direct fetch path is intentionally removed: it accepted renderer
 * credentials and arbitrary destinations, neither of which can satisfy Trust.
 */
export const generateVoice = async (
  text: string,
  config: VoiceConfig,
  projectId: string,
  sceneId: string,
  deps?: VoiceGenDeps
): Promise<string> => {
  if (!text.trim()) throw new VoiceGenError('VOICE_GENERATION_FAILED');
  const authority = deps?.egressAuthority;
  if (!authority) throw new VoiceGenError('VOICE_EGRESS_AUTHORITY_REQUIRED');

  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS;
  if (!isValidTimeout(timeoutMs)) throw new VoiceGenError('VOICE_GENERATION_FAILED');
  const bounded = createBoundedSignal(deps?.signal, timeoutMs);
  try {
    throwIfAborted(bounded.signal, bounded.wasTimedOut);
    let audio: Uint8Array;
    try {
      audio = await Promise.race([
        authority.synthesize(makeRequest(text, config), { signal: bounded.signal, timeoutMs }),
        rejectOnAbort(bounded.signal, bounded.wasTimedOut),
      ]);
    } catch (error) {
      if (error instanceof VoiceGenError) throw error;
      throw new VoiceGenError('VOICE_GENERATION_FAILED');
    }
    if (!(audio instanceof Uint8Array)) throw new VoiceGenError('VOICE_GENERATION_RESPONSE_INVALID');
    if (audio.byteLength > MAX_TTS_AUDIO_BYTES) throw new VoiceGenError('VOICE_GENERATION_RESPONSE_TOO_LARGE');
    throwIfAborted(bounded.signal, bounded.wasTimedOut);

    const ext = config.type === 'openai' ? (config.response_format ?? 'mp3') : 'mp3';
    const fileName = `voice-${projectId}-${sceneId}.${ext}`;
    const audioDir =
      deps?.audioDir ?? path.join(process.env['APPDATA'] ?? process.env['HOME'] ?? '', 'make-video', 'audio');
    const fsImpl = deps?.fs ?? defaultFs;
    await fsImpl.mkdir(audioDir, { recursive: true });
    throwIfAborted(bounded.signal, bounded.wasTimedOut);
    const filePath = path.join(audioDir, fileName);
    await fsImpl.writeFile(filePath, Buffer.from(audio));
    return filePath;
  } finally {
    bounded.cleanup();
  }
};
