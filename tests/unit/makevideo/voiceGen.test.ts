/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the fail-closed MakeVideo TTS boundary. Voice generation may
 * persist returned bytes only after a Main-owned authority has performed the
 * governed transport; this module never forwards caller credentials or URLs.
 */

import { describe, expect, it, vi } from 'vitest';
import { generateVoice, type VoiceEgressAuthority } from '@/process/makevideo/voiceGen';
import type { VoiceConfigElevenLabs, VoiceConfigOpenAI } from '@/process/makevideo/makeVideoTypes';

const memFs = () => {
  const writes: Array<{ path: string; size: number }> = [];
  return {
    writes,
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (filePath: string, data: Buffer) => {
      writes.push({ path: filePath, size: data.length });
    }),
  };
};

const authority = (impl: VoiceEgressAuthority['synthesize'] = async () => new Uint8Array([1, 2, 3, 4])) => ({
  synthesize: vi.fn(impl),
});

const OPENAI: VoiceConfigOpenAI = {
  type: 'openai',
  base_url: 'https://api.openai.com',
  api_key: 'sk-test',
  model: 'tts-1',
  voice: 'nova',
  response_format: 'wav',
};

const ELEVEN_LABS: VoiceConfigElevenLabs = {
  type: 'elevenlabs',
  api_key: 'xi-key',
  voice_id: 'VOICE123',
  model_id: 'eleven_multilingual_v2',
};

describe('generateVoice — governed TTS', () => {
  it('fails closed before any artifact write when no Main-owned egress authority exists', async () => {
    const fs = memFs();

    await expect(generateVoice('Hello world', OPENAI, 'p1', 's1', { audioDir: '/aud', fs })).rejects.toMatchObject({
      code: 'VOICE_EGRESS_AUTHORITY_REQUIRED',
    });

    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('passes a secret-free normalized request to the authority and persists only its bytes', async () => {
    const fs = memFs();
    const egressAuthority = authority();

    const out = await generateVoice('Hello world', OPENAI, 'p1', 's1', {
      audioDir: '/aud',
      fs,
      egressAuthority,
    });

    expect(out).toMatch(/voice-p1-s1\.wav$/);
    expect(egressAuthority.synthesize).toHaveBeenCalledWith(
      {
        provider: 'openai',
        text: 'Hello world',
        model: 'tts-1',
        voiceId: 'nova',
        responseFormat: 'wav',
      },
      expect.objectContaining({ timeoutMs: 90_000, signal: expect.any(AbortSignal) })
    );
    expect(JSON.stringify(egressAuthority.synthesize.mock.calls[0])).not.toContain('sk-test');
    expect(JSON.stringify(egressAuthority.synthesize.mock.calls[0])).not.toContain('api.openai.com');
    expect(fs.writes[0]).toMatchObject({ size: 4 });
  });

  it('does not expose ElevenLabs credentials or construct its destination in the authority request', async () => {
    const egressAuthority = authority();

    await generateVoice('Bonjour', ELEVEN_LABS, 'p2', 's2', { audioDir: '/aud', fs: memFs(), egressAuthority });

    expect(egressAuthority.synthesize).toHaveBeenCalledWith(
      {
        provider: 'elevenlabs',
        text: 'Bonjour',
        model: 'eleven_multilingual_v2',
        voiceId: 'VOICE123',
        responseFormat: 'mp3',
      },
      expect.anything()
    );
    expect(JSON.stringify(egressAuthority.synthesize.mock.calls[0])).not.toContain('xi-key');
    expect(JSON.stringify(egressAuthority.synthesize.mock.calls[0])).not.toContain('elevenlabs.io');
  });

  it('cancels before calling the authority', async () => {
    const controller = new AbortController();
    controller.abort();
    const egressAuthority = authority();

    await expect(
      generateVoice('Hello world', OPENAI, 'p1', 's1', { fs: memFs(), egressAuthority, signal: controller.signal })
    ).rejects.toMatchObject({ code: 'VOICE_GENERATION_ABORTED' });

    expect(egressAuthority.synthesize).not.toHaveBeenCalled();
  });

  it('cancels a pending authority call and writes no artifact', async () => {
    const controller = new AbortController();
    const fs = memFs();
    const egressAuthority = authority(
      async (_request, options) =>
        new Promise<Uint8Array>((resolve) => {
          options.signal.addEventListener('abort', () => resolve(new Uint8Array([1, 2, 3, 4])), { once: true });
        })
    );
    const result = generateVoice('Hello world', OPENAI, 'p1', 's1', {
      audioDir: '/aud',
      fs,
      egressAuthority,
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();

    await expect(result).rejects.toMatchObject({ code: 'VOICE_GENERATION_ABORTED' });
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('maps transport errors to a stable error without leaking a supplied credential', async () => {
    const egressAuthority = authority(async () => {
      throw new Error('upstream failed with Authorization: Bearer sk-test');
    });

    await expect(
      generateVoice('Hello world', OPENAI, 'p1', 's1', { fs: memFs(), egressAuthority, audioDir: '/aud' })
    ).rejects.toMatchObject({ code: 'VOICE_GENERATION_FAILED' });
  });
});
