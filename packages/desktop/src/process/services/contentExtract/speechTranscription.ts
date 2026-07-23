/** Tomni-owned speech transcription transport for desktop and gateway callers. */
import { ipcBridge } from '@/common';
import type {
  SpeechToTextAudioBuffer,
  SpeechToTextConfig,
  SpeechToTextRequest,
  SpeechToTextResult,
} from '@/common/types/provider/speech';
import { ProcessConfig } from '@process/utils/initStorage';

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

const toBytes = (input: SpeechToTextAudioBuffer): Uint8Array => {
  if (input instanceof Uint8Array) return input;
  if (Array.isArray(input)) return Uint8Array.from(input);
  return Uint8Array.from(
    Object.entries(input)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => value)
  );
};

const joinEndpoint = (baseUrl: string, suffix: string): string => baseUrl.replace(/\/+$/u, '') + suffix;

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!response.ok) {
    throw new Error('STT_REQUEST_FAILED:' + response.status + (text ? ' ' + text.slice(0, 300) : ''));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('STT_INVALID_RESPONSE');
  }
};

const transcribeOpenAi = async (
  request: SpeechToTextRequest,
  config: NonNullable<SpeechToTextConfig['openai']>,
  bytes: Uint8Array
): Promise<SpeechToTextResult> => {
  if (!config.api_key || !config.model) throw new Error('STT_NOT_CONFIGURED');
  const form = new FormData();
  form.append('file', new Blob([Uint8Array.from(bytes).buffer], { type: request.mimeType }), request.file_name);
  form.append('model', config.model);
  const language = request.languageHint || config.language;
  if (language) form.append('language', language);
  if (config.prompt) form.append('prompt', config.prompt);
  if (config.temperature !== undefined) form.append('temperature', String(config.temperature));

  const baseUrl = config.base_url || 'https://api.openai.com/v1';
  const payload = (await readJson(
    await fetch(joinEndpoint(baseUrl, '/audio/transcriptions'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.api_key },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  )) as { language?: string; text?: string };
  if (typeof payload.text !== 'string') throw new Error('STT_INVALID_RESPONSE');
  return { text: payload.text, language: payload.language || language, model: config.model, provider: 'openai' };
};

const transcribeDeepgram = async (
  request: SpeechToTextRequest,
  config: NonNullable<SpeechToTextConfig['deepgram']>,
  bytes: Uint8Array
): Promise<SpeechToTextResult> => {
  if (!config.api_key || !config.model) throw new Error('STT_NOT_CONFIGURED');
  const query = new URLSearchParams({ model: config.model });
  const language = request.languageHint || config.language;
  if (language) query.set('language', language);
  if (config.detectLanguage) query.set('detect_language', 'true');
  if (config.punctuate !== undefined) query.set('punctuate', String(config.punctuate));
  if (config.smartFormat !== undefined) query.set('smart_format', String(config.smartFormat));

  const baseUrl = config.base_url || 'https://api.deepgram.com';
  const payload = (await readJson(
    await fetch(joinEndpoint(baseUrl, '/v1/listen') + '?' + query.toString(), {
      method: 'POST',
      headers: { Authorization: 'Token ' + config.api_key, 'Content-Type': request.mimeType },
      body: Uint8Array.from(bytes).buffer,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  )) as {
    metadata?: { model_info?: Record<string, { name?: string }> };
    results?: { channels?: Array<{ detected_language?: string; alternatives?: Array<{ transcript?: string }> }> };
  };
  const channel = payload.results?.channels?.[0];
  const text = channel?.alternatives?.[0]?.transcript;
  if (typeof text !== 'string') throw new Error('STT_INVALID_RESPONSE');
  return {
    text,
    language: channel?.detected_language || language,
    model: config.model,
    provider: 'deepgram',
  };
};

export const transcribeSpeech = async (
  request: SpeechToTextRequest,
  config?: SpeechToTextConfig
): Promise<SpeechToTextResult> => {
  const resolved = config || (await ProcessConfig.get('tools.speechToText'));
  if (!resolved?.enabled) throw new Error('STT_NOT_CONFIGURED');
  const bytes = toBytes(request.audioBuffer);
  if (bytes.byteLength === 0) throw new Error('STT_EMPTY_AUDIO');
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new Error('STT_FILE_TOO_LARGE');
  return resolved.provider === 'deepgram'
    ? transcribeDeepgram(request, resolved.deepgram || ({} as NonNullable<SpeechToTextConfig['deepgram']>), bytes)
    : transcribeOpenAi(request, resolved.openai || ({} as NonNullable<SpeechToTextConfig['openai']>), bytes);
};

export const registerSpeechTranscriptionBridge = (): void => {
  ipcBridge.speechToText.transcribe.provider((request) => transcribeSpeech(request));
};
