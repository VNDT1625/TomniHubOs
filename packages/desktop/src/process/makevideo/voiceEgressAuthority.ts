/**
 * Bounded Main-process adapter contract for MakeVideo text-to-speech egress.
 *
 * ProviderExecutionBroker is intentionally text/JSON-only. Binary narration
 * therefore has its own narrow authority seam rather than widening the chat
 * broker or restoring a direct provider fetch. The admission implementation
 * owns saved-destination resolution and the opaque credential lease; neither
 * caller configuration nor secret/base URL reaches this contract.
 */

import type { VoiceEgressAuthority, VoiceGenerationRequest } from './voiceGen';

const MAKEVIDEO_VOICE_ORIGIN = 'tomny://makevideo-voice';
const MAX_TTS_TEXT_BYTES = 64 * 1024;
const MAX_TTS_RESPONSE_BYTES = 32 * 1024 * 1024;

export type VoiceEgressAuthorityErrorCode =
  | 'VOICE_EGRESS_ABORTED'
  | 'VOICE_EGRESS_DENIED'
  | 'VOICE_EGRESS_INVALID_REQUEST'
  | 'VOICE_EGRESS_RESPONSE_INVALID'
  | 'VOICE_EGRESS_RESPONSE_TOO_LARGE'
  | 'VOICE_EGRESS_UNSUPPORTED_PROVIDER';

/** Stable, redacted authority error for the MakeVideo Main-process boundary. */
export class VoiceEgressAuthorityError extends Error {
  public constructor(public readonly code: VoiceEgressAuthorityErrorCode) {
    super(code);
    this.name = 'VoiceEgressAuthorityError';
  }
}

/**
 * Opaque destination/secret evidence retained by the Main-owned admission
 * implementation. It deliberately carries no URL, API key, or header value.
 */
export type VoiceEgressLease = Readonly<{
  id: string;
  providerId: string;
  destinationKind: 'openai-audio-speech';
  expiresAt: number;
}>;

export type VoiceEgressAdmissionRequest = Readonly<{
  origin: typeof MAKEVIDEO_VOICE_ORIGIN;
  operation: 'text-to-speech';
  provider: 'openai';
  mediaType: 'audio/mpeg';
  request: Readonly<{
    text: string;
    model: string;
    voiceId: string;
    responseFormat: 'mp3';
  }>;
}>;

export type VoiceEgressAdmission = Readonly<{
  decision: 'allow' | 'deny';
  lease?: VoiceEgressLease;
}>;

/**
 * Main-only implementer: binds an account/run grant, exact saved destination,
 * final serialized payload inspection, opaque secret lease, and receipt. The
 * destination URL and credential are resolved internally, never from this API.
 */
export type VoiceEgressAdmissionAuthority = Readonly<{
  admit(request: VoiceEgressAdmissionRequest): Promise<VoiceEgressAdmission>;
}>;

/**
 * Main-only binary transport. Its implementation must use the opaque lease to
 * resolve its already-admitted destination and credential, reject redirects,
 * honor cancellation, and persist a durable transport receipt.
 */
export type VoiceEgressTransport = Readonly<{
  synthesize(
    input: Readonly<{
      lease: VoiceEgressLease;
      request: VoiceEgressAdmissionRequest['request'];
      signal: AbortSignal;
      timeoutMs: number;
    }>
  ): Promise<Uint8Array>;
}>;

export type CreateVoiceEgressAuthorityOptions = Readonly<{
  admissionAuthority: VoiceEgressAdmissionAuthority;
  transport: VoiceEgressTransport;
}>;

const abortIfNeeded = (signal: AbortSignal): void => {
  if (signal.aborted) throw new VoiceEgressAuthorityError('VOICE_EGRESS_ABORTED');
};

const hasExactRequestShape = (request: VoiceGenerationRequest): boolean => {
  const allowedKeys = ['provider', 'text', 'model', 'voiceId', 'responseFormat'];
  const keys = Object.keys(request);
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
};

const normalize = (request: VoiceGenerationRequest): VoiceEgressAdmissionRequest['request'] => {
  if (
    !hasExactRequestShape(request) ||
    request.provider !== 'openai' ||
    request.responseFormat !== 'mp3' ||
    !request.text.trim() ||
    !request.model.trim() ||
    !request.voiceId.trim() ||
    Buffer.byteLength(request.text, 'utf8') > MAX_TTS_TEXT_BYTES
  ) {
    throw new VoiceEgressAuthorityError(
      request.provider === 'openai' ? 'VOICE_EGRESS_INVALID_REQUEST' : 'VOICE_EGRESS_UNSUPPORTED_PROVIDER'
    );
  }
  return {
    text: request.text,
    model: request.model,
    voiceId: request.voiceId,
    responseFormat: 'mp3',
  };
};

const isAdmitted = (
  admission: VoiceEgressAdmission
): admission is Readonly<{ decision: 'allow'; lease: VoiceEgressLease }> =>
  admission.decision === 'allow' &&
  admission.lease !== undefined &&
  admission.lease.destinationKind === 'openai-audio-speech' &&
  Boolean(admission.lease.id.trim()) &&
  Boolean(admission.lease.providerId.trim()) &&
  Number.isFinite(admission.lease.expiresAt);

/**
 * Creates the sole supported MakeVideo TTS transport seam: saved OpenAI-style
 * TTS ending in MP3. ElevenLabs and arbitrary media/destinations stay denied
 * until they receive a separate governed contract and evidence.
 */
export const createVoiceEgressAuthority = (options: CreateVoiceEgressAuthorityOptions): VoiceEgressAuthority => ({
  async synthesize(request, transportOptions): Promise<Uint8Array> {
    abortIfNeeded(transportOptions.signal);
    const normalized = normalize(request);
    const admissionRequest: VoiceEgressAdmissionRequest = {
      origin: MAKEVIDEO_VOICE_ORIGIN,
      operation: 'text-to-speech',
      provider: 'openai',
      mediaType: 'audio/mpeg',
      request: normalized,
    };
    const admission = await options.admissionAuthority.admit(admissionRequest);
    if (!isAdmitted(admission) || admission.lease.expiresAt <= Date.now()) {
      throw new VoiceEgressAuthorityError('VOICE_EGRESS_DENIED');
    }
    abortIfNeeded(transportOptions.signal);
    const audio = await options.transport.synthesize({
      lease: admission.lease,
      request: normalized,
      signal: transportOptions.signal,
      timeoutMs: transportOptions.timeoutMs,
    });
    abortIfNeeded(transportOptions.signal);
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
      throw new VoiceEgressAuthorityError('VOICE_EGRESS_RESPONSE_INVALID');
    }
    if (audio.byteLength > MAX_TTS_RESPONSE_BYTES) {
      throw new VoiceEgressAuthorityError('VOICE_EGRESS_RESPONSE_TOO_LARGE');
    }
    return audio;
  },
});
