/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Make Video IPC bridge — the Main-process backend for the AI movie/anime
 * factory. Script completion runs against the user's configured provider;
 * remote image rendering is intentionally disabled until it can use the same
 * governed Main execution contract.
 *
 * Like the Studio chat bridge (`process/studio/studioChatBridge.ts`), the
 * renderer cannot call model providers directly (CORS / `webSecurity`). Script
 * completion is delegated to the shared Main-only ProviderExecutionBroker.
 * Image rendering is fail-closed rather than handing a stored credential to a
 * legacy image core that lacks the required run, final-egress, lease, and
 * durable-receipt authority.
 *
 * Channels:
 * - `makevideo.list` / `makevideo.get` / `makevideo.save` / `makevideo.remove`
 *   proxy CRUD to a singleton {@link createMakeVideoStore}.
 * - `makevideo.generate-script` runs one non-streaming LLM completion and parses
 *   a strict JSON array of scenes out of the reply.
 * - `makevideo.generate-image` returns a stable fail-closed error until a
 *   governed image execution path is available.
 *
 * Every channel resolves a {@link MakeVideoResult} envelope (never rejects) so a
 * failure is observable instead of hanging the renderer (the platform bridge
 * swallows rejected promises).
 *
 * The global bootstrap calls {@link registerMakeVideoBridge} once; this module
 * does not wire itself in (mirrors `studioChatBridge.ts` / `companyBridge.ts`).
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { app } from 'electron';
import * as path from 'node:path';

import { randomUUID } from 'node:crypto';
import { bridge } from '@office-ai/platform';

import { createProviderChat, runAgentChatMessages } from '@process/services/agentChat';
import { createMakeVideoStore, type IMakeVideoStore } from './makeVideoStore';
import { parseScenes } from './scriptParse';
import { isTransientError, withRetry } from './retry';
import type {
  ExportFinalData,
  ExportFinalRequest,
  GenerateVideoClipData,
  GenerateVideoClipRequest,
  GenerateVoiceData,
  GenerateVoiceRequest,
  MakeVideoResult,
  Scene,
  ScriptRequest,
  VideoProject,
} from './makeVideoTypes';
import { generateVoice } from './voiceGen';
import { generateVideoClip } from './videoClipGen';
import { exportFinalVideo } from './finalExport';

/** IPC channel names for the Make Video surface (renderer-safe contract). */
export const MAKE_VIDEO_CHANNELS = {
  listProjects: 'makevideo.list',
  getProject: 'makevideo.get',
  saveProject: 'makevideo.save',
  removeProject: 'makevideo.remove',
  generateScript: 'makevideo.generate-script',
  generateImage: 'makevideo.generate-image',
  generateVoice: 'makevideo.generate-voice',
  generateVideoClip: 'makevideo.generate-video-clip',
  exportFinal: 'makevideo.export-final',
} as const;

/** Request for {@link MAKE_VIDEO_CHANNELS.getProject} / `removeProject`. */
export type ProjectIdRequest = { id: string };

/** Request for {@link MAKE_VIDEO_CHANNELS.generateImage}. */
export type GenerateImageRequest = {
  /** Project that owns the scene. */
  projectId: string;
  /** Scene to render an image for. */
  sceneId: string;
  /** The (English, visually detailed) image-generation prompt. */
  prompt: string;
  /** Image model id the renderer picked from the user's configured models. */
  model: string;
};

/** Result data for {@link MAKE_VIDEO_CHANNELS.generateImage}. */
export type GenerateImageData = {
  /** Absolute path to the saved scene image, or null when none was produced. */
  imagePath: string | null;
  /** Human-readable model response / description. */
  text: string;
};

/** Typed Make Video channels. Exported for bootstrap registration wiring. */
export const makeVideoChannels = {
  listProjects: bridge.buildProvider<MakeVideoResult<VideoProject[]>, void>(MAKE_VIDEO_CHANNELS.listProjects),
  getProject: bridge.buildProvider<MakeVideoResult<VideoProject | null>, ProjectIdRequest>(
    MAKE_VIDEO_CHANNELS.getProject
  ),
  saveProject: bridge.buildProvider<MakeVideoResult<VideoProject>, VideoProject>(MAKE_VIDEO_CHANNELS.saveProject),
  removeProject: bridge.buildProvider<MakeVideoResult<VideoProject[]>, ProjectIdRequest>(
    MAKE_VIDEO_CHANNELS.removeProject
  ),
  generateScript: bridge.buildProvider<MakeVideoResult<Scene[]>, ScriptRequest>(MAKE_VIDEO_CHANNELS.generateScript),
  generateImage: bridge.buildProvider<MakeVideoResult<GenerateImageData>, GenerateImageRequest>(
    MAKE_VIDEO_CHANNELS.generateImage
  ),
  generateVoice: bridge.buildProvider<MakeVideoResult<GenerateVoiceData>, GenerateVoiceRequest>(
    MAKE_VIDEO_CHANNELS.generateVoice
  ),
  generateVideoClip: bridge.buildProvider<MakeVideoResult<GenerateVideoClipData>, GenerateVideoClipRequest>(
    MAKE_VIDEO_CHANNELS.generateVideoClip
  ),
  exportFinal: bridge.buildProvider<MakeVideoResult<ExportFinalData>, ExportFinalRequest>(
    MAKE_VIDEO_CHANNELS.exportFinal
  ),
};

// ---------------------------------------------------------------------------
// Provider helpers for model selection.
// ---------------------------------------------------------------------------

/** Detect the "no usable model" case so the UI can show a targeted hint. */
const classify = (error: unknown): 'no-model' | 'error' => {
  const message = error instanceof Error ? error.message : String(error);
  return /no usable model|no model|requires a generator/i.test(message) ? 'no-model' : 'error';
};

// ---------------------------------------------------------------------------
// Script generation (provider-backed LLM)
// ---------------------------------------------------------------------------

/** Build the system prompt instructing the model to act as a screenwriter. */
const buildScriptSystemPrompt = (req: ScriptRequest): string =>
  [
    'You are a professional film and anime screenwriter.',
    `Write a scene-by-scene shooting script for a short video about: "${req.topic}".`,
    `The visual and narrative style is: "${req.style}".`,
    `Return EXACTLY ${req.sceneCount} scenes.`,
    'Respond with STRICT JSON only — a single JSON array, no prose, no markdown fences.',
    'Each array element MUST be an object with exactly these string fields: "title", "narration", "imagePrompt".',
    `- "title": a short scene title, written in ${req.language}.`,
    `- "narration": the voice-over for the scene, written in ${req.language}.`,
    `- "imagePrompt": a single, visually detailed image-generation prompt written in ENGLISH. Describe camera angle, lighting, composition, mood, and reflect the "${req.style}" style. Do not reference other scenes.`,
    'Do not include any keys other than title, narration, and imagePrompt.',
  ].join('\n');

/**
 * Re-exported from {@link ./scriptParse} so existing imports
 * (`import { parseScenes } from '.../makeVideoBridge'`) keep working. The robust
 * fence-stripping / bracket-balanced / repair-on-failure parser lives there and
 * is unit-tested in isolation (no network/provider needed).
 */
export { parseScenes } from './scriptParse';

/** Provider egress, credentials, actor binding, and destination policy stay in Main's shared broker. */
const brokeredProviderChat = createProviderChat();

/**
 * Issue one non-streaming completion through the shared provider broker.
 * CLI routing still happens in {@link runScript}; this function only handles
 * ordinary provider model IDs. The existing bounded retry remains in place for
 * transient broker network and timeout outcomes.
 */
const runProviderChat = async (
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal
): Promise<string> =>
  withRetry(
    async () => {
      try {
        return await brokeredProviderChat({ model, messages, signal });
      } catch (error) {
        if (error instanceof Error && error.message === 'PROVIDER_EXECUTION_UNAVAILABLE') {
          throw new Error(
            'No usable model is configured. Open Settings → Model and add a provider/model, then try again.'
          );
        }
        throw error;
      }
    },
    {
      isRetriable: (error) =>
        isTransientError(error) ||
        (error instanceof Error && /PROVIDER_EXECUTION_(NETWORK_FAILED|TIMEOUT)/.test(error.message)),
      signal,
    }
  );

/**
 * Generate a script: ask the model (provider OR CLI agent) for a JSON scene
 * array and parse it into {@link Scene}s. Throws on failure; the caller wraps it
 * into a result envelope.
 *
 * Exported so the Automation `action.app.makeVideo` connector can reuse the
 * exact same provider-backed generation without duplicating provider logic.
 */
export const runScript = async (req: ScriptRequest): Promise<Scene[]> => {
  const messages = [
    { role: 'system', content: buildScriptSystemPrompt(req) },
    {
      role: 'user',
      content: `Topic: ${req.topic}\nStyle: ${req.style}\nLanguage: ${req.language}\nScenes: ${req.sceneCount}`,
    },
  ];
  const content = await runAgentChatMessages(
    (model, msgs, signal) =>
      runProviderChat(model, msgs as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, signal),
    req.model,
    messages,
    undefined,
    { surface: 'video', permissionMode: 'read-only' }
  );
  return parseScenes(content, req.sceneCount, randomUUID);
};

// ---------------------------------------------------------------------------
// Image generation containment
// ---------------------------------------------------------------------------

/**
 * Remote image rendering is disabled before provider lookup, credential access,
 * workspace creation, or network transport. A future replacement must bind the
 * exact request to a Main-owned run identity, final egress inspection,
 * destination-bound opaque secret lease, cancellation, and durable receipt.
 *
 * Exported so the Automation `action.app.makeVideo` connector can render scenes
 * through the same future governed image pipeline.
 */
export const runImage = async (_req: GenerateImageRequest): Promise<GenerateImageData> => {
  throw new Error('MAKEVIDEO_IMAGE_REMOTE_TRANSPORT_DISABLED');
};

// ---------------------------------------------------------------------------
// Store singleton + registration
// ---------------------------------------------------------------------------

let storeSingleton: IMakeVideoStore | null = null;
const getStore = (): IMakeVideoStore => {
  if (!storeSingleton) storeSingleton = createMakeVideoStore();
  return storeSingleton;
};

const ok = <T>(data: T): MakeVideoResult<T> => ({ ok: true, data });
const fail = <T>(error: unknown, code: 'no-model' | 'no-image-model' | 'error'): MakeVideoResult<T> => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
  code,
});

/**
 * Register every Make Video IPC handler. Idempotent (re-registration replaces
 * the bound handlers). Intended to be called once during Main-process bootstrap.
 */
export function registerMakeVideoBridge(): void {
  makeVideoChannels.listProjects.provider(async (): Promise<MakeVideoResult<VideoProject[]>> => {
    try {
      return ok(await getStore().list());
    } catch (error) {
      console.error('[MakeVideoBridge] list failed:', error);
      return fail<VideoProject[]>(error, 'error');
    }
  });

  makeVideoChannels.getProject.provider(async (req): Promise<MakeVideoResult<VideoProject | null>> => {
    try {
      return ok(await getStore().get(req.id));
    } catch (error) {
      console.error('[MakeVideoBridge] get failed:', error);
      return fail<VideoProject | null>(error, 'error');
    }
  });

  makeVideoChannels.saveProject.provider(async (req): Promise<MakeVideoResult<VideoProject>> => {
    try {
      return ok(await getStore().save(req));
    } catch (error) {
      console.error('[MakeVideoBridge] save failed:', error);
      return fail<VideoProject>(error, 'error');
    }
  });

  makeVideoChannels.removeProject.provider(async (req): Promise<MakeVideoResult<VideoProject[]>> => {
    try {
      return ok(await getStore().remove(req.id));
    } catch (error) {
      console.error('[MakeVideoBridge] remove failed:', error);
      return fail<VideoProject[]>(error, 'error');
    }
  });

  makeVideoChannels.generateScript.provider(async (req): Promise<MakeVideoResult<Scene[]>> => {
    try {
      return ok(await runScript(req));
    } catch (error) {
      console.error('[MakeVideoBridge] generate-script failed:', error);
      return fail<Scene[]>(error, classify(error));
    }
  });

  makeVideoChannels.generateImage.provider(async (req): Promise<MakeVideoResult<GenerateImageData>> => {
    try {
      return ok(await runImage(req));
    } catch (error) {
      console.error('[MakeVideoBridge] generate-image failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      const code = /no-image-model/i.test(message) ? 'no-image-model' : 'error';
      return fail<GenerateImageData>(error, code);
    }
  });

  makeVideoChannels.generateVoice.provider(async (req): Promise<MakeVideoResult<GenerateVoiceData>> => {
    try {
      const audioDir = path.join(app.getPath('userData'), 'make-video', 'audio');
      const audioPath = await withRetry(
        () => generateVoice(req.text, req.voiceConfig, req.projectId, req.sceneId, { audioDir }),
        { isRetriable: isTransientError }
      );
      // Persist audioPath on the scene.
      await getStore().updateScene(req.projectId, req.sceneId, { audioPath, audioError: null });
      return ok({ audioPath });
    } catch (error) {
      console.error('[MakeVideoBridge] generate-voice failed:', error);
      await getStore()
        .updateScene(req.projectId, req.sceneId, {
          audioError: error instanceof Error ? error.message : String(error),
        })
        .catch((): undefined => undefined);
      return fail<GenerateVoiceData>(error, 'error');
    }
  });

  makeVideoChannels.generateVideoClip.provider(async (req): Promise<MakeVideoResult<GenerateVideoClipData>> => {
    try {
      const clipsDir = path.join(app.getPath('userData'), 'make-video', 'clips');
      const videoClipPath = await generateVideoClip(
        req.frameStartPath,
        req.frameEndPath,
        req.prompt,
        req.videoClipConfig,
        req.projectId,
        req.sceneId,
        { clipsDir }
      );
      await getStore().updateScene(req.projectId, req.sceneId, { videoClipPath, videoClipError: null });
      return ok({ videoClipPath });
    } catch (error) {
      console.error('[MakeVideoBridge] generate-video-clip failed:', error);
      await getStore()
        .updateScene(req.projectId, req.sceneId, {
          videoClipError: error instanceof Error ? error.message : String(error),
        })
        .catch((): undefined => undefined);
      return fail<GenerateVideoClipData>(error, 'error');
    }
  });

  makeVideoChannels.exportFinal.provider(async (req): Promise<MakeVideoResult<ExportFinalData>> => {
    try {
      const defaultOutputPath =
        req.outputPath || path.join(app.getPath('userData'), 'make-video', 'exports', `final-${req.projectId}.mp4`);
      const result = await exportFinalVideo(req.segments, defaultOutputPath);
      return ok(result);
    } catch (error) {
      console.error('[MakeVideoBridge] export-final failed:', error);
      return fail<ExportFinalData>(error, 'error');
    }
  });
}
