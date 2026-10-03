import { describe, expect, it, vi } from 'vitest';

import {
  createVoiceEgressAuthority,
  type VoiceEgressAdmissionAuthority,
  type VoiceEgressTransport,
} from '@/process/makevideo/voiceEgressAuthority';
import { generateVoice } from '@/process/makevideo/voiceGen';
import type { VoiceConfigOpenAI } from '@/process/makevideo/makeVideoTypes';

const RAW_CONFIG: VoiceConfigOpenAI = {
  type: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: 'sk-integration-secret',
  model: 'tts-1',
  voice: 'nova',
  response_format: 'mp3',
};

describe('MakeVideo governed TTS authority contract', () => {
  it('persists binary output only after the secret-free Main authority admission and transport', async () => {
    const writes: Array<{ path: string; bytes: number }> = [];
    const admissionAuthority = {
      admit: vi.fn(async () => ({
        decision: 'allow' as const,
        lease: {
          id: 'opaque-lease',
          providerId: 'saved-openai',
          destinationKind: 'openai-audio-speech' as const,
          expiresAt: Date.now() + 60_000,
        },
      })),
    } satisfies VoiceEgressAdmissionAuthority;
    const transport = {
      synthesize: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    } satisfies VoiceEgressTransport;
    const authority = createVoiceEgressAuthority({ admissionAuthority, transport });

    const output = await generateVoice('Narrate this safely.', RAW_CONFIG, 'project-1', 'scene-1', {
      audioDir: '/audio',
      egressAuthority: authority,
      fs: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async (filePath: string, bytes: Buffer) => {
          writes.push({ path: filePath, bytes: bytes.length });
        }),
      },
    });

    expect(output).toMatch(/voice-project-1-scene-1\.mp3$/);
    expect(writes).toEqual([{ path: output, bytes: 4 }]);
    expect(admissionAuthority.admit).toHaveBeenCalledOnce();
    expect(transport.synthesize).toHaveBeenCalledOnce();
    const outboundAdapters = JSON.stringify([admissionAuthority.admit.mock.calls, transport.synthesize.mock.calls]);
    expect(outboundAdapters).not.toContain(RAW_CONFIG.api_key);
    expect(outboundAdapters).not.toContain(RAW_CONFIG.base_url);
    expect(outboundAdapters).not.toContain('api_key');
    expect(outboundAdapters).not.toContain('base_url');
  });
});
