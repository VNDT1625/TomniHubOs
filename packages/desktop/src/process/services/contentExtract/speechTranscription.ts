/** Speech-transcription boundary for desktop and gateway callers. */
import { ipcBridge } from '@/common';
import type { SpeechToTextConfig, SpeechToTextRequest, SpeechToTextResult } from '@/common/types/provider/speech';

/**
 * Future Main-only admission contract for remote audio disclosure. It is
 * deliberately secret-free: it receives bounded request metadata, never a
 * provider configuration, endpoint, credential, or audio bytes.
 *
 * This declaration does not enable outbound transcription. A future transport
 * must additionally bind account, run, destination, final-payload inspection,
 * opaque credential lease, cancellation, and durable receipt through Trust.
 */
export type SpeechTranscriptionEgressAuthority = Readonly<{
  authorize(request: SpeechTranscriptionEgressRequest): Promise<SpeechTranscriptionEgressDecision>;
}>;

export type SpeechTranscriptionEgressRequest = Readonly<{
  operation: 'speech-transcription';
  audioByteLength: number;
  fileName: string;
  languageHint?: string;
  maxAudioBytes: number;
  mimeType: string;
}>;

export type SpeechTranscriptionEgressDecision = Readonly<{
  decision: 'allow' | 'deny';
}>;

export type SpeechTranscriptionOptions = Readonly<{
  /** Reserved for the future governed Main-only transport. */
  authority?: SpeechTranscriptionEgressAuthority;
}>;

/**
 * Remote transcription is disabled until a fully governed Main transport
 * exists. This is deliberately before provider configuration, credentials,
 * audio serialization, remote effects, or authority invocation.
 */
export const createSpeechTranscriber =
  (_options: SpeechTranscriptionOptions = {}) =>
  async (_request: SpeechToTextRequest, _config?: SpeechToTextConfig): Promise<SpeechToTextResult> => {
    throw new Error('STT_REMOTE_TRANSPORT_DISABLED');
  };

export const transcribeSpeech = createSpeechTranscriber();

export const registerSpeechTranscriptionBridge = (): void => {
  ipcBridge.speechToText.transcribe.provider((request) => transcribeSpeech(request));
};
