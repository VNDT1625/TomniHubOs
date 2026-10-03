import {
  createSpeechTranscriber,
  type SpeechTranscriptionEgressAuthority,
} from '@process/services/contentExtract/speechTranscription';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const request = {
  audioBuffer: [1, 2, 3],
  file_name: 'voice.webm',
  mimeType: 'audio/webm',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tomny speech transcription', () => {
  it('disables remote transport before authority, credentials, audio, or network effects', async () => {
    const fetchMock = vi.fn();
    const authorize = vi.fn(async () => ({ decision: 'allow' as const }));
    const authority: SpeechTranscriptionEgressAuthority = { authorize };
    const apiKey = vi.fn(() => 'secret');
    const audioBuffer = vi.fn(() => [1, 2, 3]);
    const protectedRequest = Object.defineProperty({ ...request }, 'audioBuffer', { get: audioBuffer });
    const config = {
      enabled: true,
      provider: 'openai' as const,
      openai: Object.defineProperty({ model: 'whisper-1' }, 'api_key', { get: apiKey }),
    };
    vi.stubGlobal('fetch', fetchMock);

    await expect(createSpeechTranscriber({ authority })(protectedRequest, config)).rejects.toThrow(
      'STT_REMOTE_TRANSPORT_DISABLED'
    );

    expect(authorize).not.toHaveBeenCalled();
    expect(apiKey).not.toHaveBeenCalled();
    expect(audioBuffer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the remote boundary free of direct provider transport markers', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'packages/desktop/src/process/services/contentExtract/speechTranscription.ts'),
      'utf8'
    );

    expect(source).not.toContain('await fetch(');
    expect(source).not.toContain('ProcessConfig.get(');
    expect(source).not.toContain('api_key');
    expect(source).toContain('STT_REMOTE_TRANSPORT_DISABLED');
    expect(source).toContain('Future Main-only admission contract');
  });

  it('keeps the desktop bridge free of the legacy STT route', async () => {
    const source = await readFile(path.join(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts'), 'utf8');
    expect(source).not.toContain("'/api/stt'");
    expect(source).toContain("'speech.transcribe'");
  });
});
