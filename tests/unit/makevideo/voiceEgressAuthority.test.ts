import { describe, expect, it, vi } from 'vitest';

import {
  createVoiceEgressAuthority,
  type VoiceEgressAdmissionAuthority,
  type VoiceEgressTransport,
} from '@/process/makevideo/voiceEgressAuthority';
import type { VoiceGenerationRequest } from '@/process/makevideo/voiceGen';

const MP3_REQUEST: VoiceGenerationRequest = {
  provider: 'openai',
  text: 'A governed narration.',
  model: 'tts-1',
  voiceId: 'nova',
  responseFormat: 'mp3',
};

const createAdmitted = () =>
  ({
    admit: vi.fn(async () => ({
      decision: 'allow' as const,
      lease: {
        id: 'opaque-lease',
        providerId: 'saved-openai',
        destinationKind: 'openai-audio-speech' as const,
        expiresAt: Date.now() + 60_000,
      },
    })),
  }) satisfies VoiceEgressAdmissionAuthority;

const createTransport = () =>
  ({
    synthesize: vi.fn(async () => new Uint8Array([1, 2, 3])),
  }) satisfies VoiceEgressTransport;

describe('MakeVideo VoiceEgressAuthority', () => {
  it('admits only the saved OpenAI MP3 route and exposes no API key or base URL to either adapter', async () => {
    const admissionAuthority = createAdmitted();
    const transport = createTransport();
    const authority = createVoiceEgressAuthority({ admissionAuthority, transport });

    await expect(
      authority.synthesize(MP3_REQUEST, { signal: new AbortController().signal, timeoutMs: 30_000 })
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));

    expect(admissionAuthority.admit).toHaveBeenCalledWith({
      origin: 'tomny://makevideo-voice',
      operation: 'text-to-speech',
      provider: 'openai',
      mediaType: 'audio/mpeg',
      request: {
        text: 'A governed narration.',
        model: 'tts-1',
        voiceId: 'nova',
        responseFormat: 'mp3',
      },
    });
    const serialized = JSON.stringify([admissionAuthority.admit.mock.calls, transport.synthesize.mock.calls]);
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('base_url');
    expect(serialized).not.toContain('sk-test');
    expect(serialized).not.toContain('https://api.openai.com');
  });

  it('rejects an unsupported provider before admission or transport', async () => {
    const admissionAuthority = createAdmitted();
    const transport = createTransport();
    const authority = createVoiceEgressAuthority({ admissionAuthority, transport });
    const elevenLabs = { ...MP3_REQUEST, provider: 'elevenlabs' as const };

    await expect(
      authority.synthesize(elevenLabs, { signal: new AbortController().signal, timeoutMs: 30_000 })
    ).rejects.toMatchObject({
      code: 'VOICE_EGRESS_UNSUPPORTED_PROVIDER',
    });

    expect(admissionAuthority.admit).not.toHaveBeenCalled();
    expect(transport.synthesize).not.toHaveBeenCalled();
  });

  it('rejects a malformed request carrying raw provider configuration before admission', async () => {
    const admissionAuthority = createAdmitted();
    const transport = createTransport();
    const authority = createVoiceEgressAuthority({ admissionAuthority, transport });
    const malformed = {
      ...MP3_REQUEST,
      api_key: 'sk-test',
      base_url: 'https://api.openai.com',
    } as VoiceGenerationRequest;

    await expect(
      authority.synthesize(malformed, { signal: new AbortController().signal, timeoutMs: 30_000 })
    ).rejects.toMatchObject({
      code: 'VOICE_EGRESS_INVALID_REQUEST',
    });

    expect(admissionAuthority.admit).not.toHaveBeenCalled();
    expect(transport.synthesize).not.toHaveBeenCalled();
  });

  it('rejects an admitted lease for a different media destination before transport', async () => {
    const wrongDestination = {
      admit: vi.fn(async () => ({
        decision: 'allow' as const,
        lease: {
          id: 'opaque-lease',
          providerId: 'saved-openai',
          destinationKind: 'openai-chat-completions',
          expiresAt: Date.now() + 60_000,
        },
      })),
    } as VoiceEgressAdmissionAuthority;
    const transport = createTransport();
    const authority = createVoiceEgressAuthority({ admissionAuthority: wrongDestination, transport });

    await expect(
      authority.synthesize(MP3_REQUEST, { signal: new AbortController().signal, timeoutMs: 30_000 })
    ).rejects.toMatchObject({
      code: 'VOICE_EGRESS_DENIED',
    });
    expect(transport.synthesize).not.toHaveBeenCalled();
  });
});
