/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Voice messages sent to the Telegram bot: what is accepted, how the audio is fetched, and how it becomes
 * text. A transcript is never run as a command by itself; the service shows it and waits for a button.
 */

export type TelegramVoiceInfo = Readonly<{
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}>;

export const MAX_VOICE_SECONDS = 60;
export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_TRANSCRIPT_CHARS = 2_000;

/** Containers a speech-to-text service takes. Anything else is refused before it is downloaded. */
const ACCEPTED_MIME = /^audio\/(?:ogg|opus|mpeg|mp3|mp4|m4a|x-m4a|wav|x-wav|webm|aac|flac)(?:;.*)?$/iu;

export type VoiceCheck = { ok: true } | { ok: false; reason: string };

/** Checks what Telegram says about the file before anything is downloaded. */
export const checkVoice = (voice: TelegramVoiceInfo): VoiceCheck => {
  if (!voice.file_id || voice.file_id.length > 256) return { ok: false, reason: 'Tệp âm thanh không hợp lệ.' };
  if (voice.duration !== undefined && voice.duration > MAX_VOICE_SECONDS) {
    return { ok: false, reason: `Tin nhắn thoại dài quá ${MAX_VOICE_SECONDS} giây. Hãy nói ngắn hơn.` };
  }
  if (voice.file_size !== undefined && voice.file_size > MAX_VOICE_BYTES) {
    return { ok: false, reason: 'Tệp âm thanh quá lớn (tối đa 5 MB).' };
  }
  if (voice.mime_type !== undefined && !ACCEPTED_MIME.test(voice.mime_type)) {
    return { ok: false, reason: 'Định dạng âm thanh này chưa được hỗ trợ.' };
  }
  return { ok: true };
};

/** A problem the user can fix by setting something up; `userMessage` is safe to show in the chat. */
export class VoiceSetupError extends Error {
  public constructor(
    public readonly code: string,
    public readonly userMessage: string
  ) {
    super(code);
    this.name = 'VoiceSetupError';
  }
}

export type VoiceAudio = Readonly<{ bytes: Uint8Array; mimeType: string; filename: string }>;

export type VoiceTranscriber = (audio: VoiceAudio, signal?: AbortSignal) => Promise<string>;

/** The extension Telegram gives its voice notes, to name the upload; unknown paths fall back to ogg. */
export const filenameFor = (filePath: string, mimeType: string): string => {
  const base = filePath.split('/').at(-1) ?? '';
  const match = /\.([a-z0-9]{2,5})$/iu.exec(base);
  if (match) return `voice.${match[1].toLowerCase()}`;
  if (/mpeg|mp3/iu.test(mimeType)) return 'voice.mp3';
  if (/mp4|m4a|aac/iu.test(mimeType)) return 'voice.m4a';
  if (/wav/iu.test(mimeType)) return 'voice.wav';
  return 'voice.ogg';
};

/**
 * Reads the answer of an OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI, Groq and others). The key
 * is read when the request is made, so it is not kept in memory with the transcriber.
 */
export const createOpenAiCompatibleTranscriber = (options: {
  baseUrl: string;
  model: string;
  /** Called per request; a missing key makes the request fail with a clear message. */
  getApiKey: () => Promise<string | undefined>;
  language?: string;
  fetchImpl?: typeof fetch;
}): VoiceTranscriber => {
  const endpoint = `${options.baseUrl.replace(/\/+$/u, '')}/audio/transcriptions`;
  return async (audio, signal) => {
    const apiKey = await options.getApiKey();
    if (!apiKey) throw new Error('STT_API_KEY_MISSING');
    const form = new FormData();
    form.set('model', options.model);
    form.set('response_format', 'json');
    if (options.language) form.set('language', options.language);
    form.set('file', new Blob([audio.bytes as BlobPart], { type: audio.mimeType }), audio.filename);
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
    if (!response.ok) throw new Error(`STT_HTTP_${response.status}`);
    const body = (await response.json()) as { text?: unknown };
    return typeof body.text === 'string' ? body.text : '';
  };
};

/** The transcript as it is shown and sent on: one line of text, bounded, without control characters. */
export const cleanTranscript = (raw: string): string =>
  raw
    .replaceAll(/\p{Cc}+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TRANSCRIPT_CHARS);

/** Encodes a pending voice command in a button's `callback_data` (Telegram allows 64 bytes). */
export const voiceCallbackData = (action: 'ok' | 'no', id: string): string => `v:${action}:${id}`;

export const parseVoiceCallback = (data: string | undefined): { action: 'ok' | 'no'; id: string } | undefined => {
  const match = /^v:(ok|no):([A-Za-z0-9-]{4,40})$/u.exec(data ?? '');
  return match ? { action: match[1] as 'ok' | 'no', id: match[2] } : undefined;
};
