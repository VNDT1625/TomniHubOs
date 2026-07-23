import { transcribeSpeech } from '@process/services/contentExtract/speechTranscription';
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

describe('Tomni speech transcription', () => {
  it('calls an OpenAI-compatible transcription endpoint without legacy core', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ text: 'hello', language: 'en' }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      transcribeSpeech(request, {
        enabled: true,
        provider: 'openai',
        openai: { api_key: 'secret', base_url: 'https://speech.example/v1/', model: 'whisper-1' },
      })
    ).resolves.toEqual({ text: 'hello', language: 'en', model: 'whisper-1', provider: 'openai' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://speech.example/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer secret' },
        body: expect.any(FormData),
      })
    );
  });

  it('normalizes a Deepgram transcript and language', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: { channels: [{ detected_language: 'vi', alternatives: [{ transcript: 'xin chào' }] }] },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      transcribeSpeech(request, {
        enabled: true,
        provider: 'deepgram',
        deepgram: { api_key: 'secret', model: 'nova-3', detectLanguage: true },
      })
    ).resolves.toEqual({ text: 'xin chào', language: 'vi', model: 'nova-3', provider: 'deepgram' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('https://api.deepgram.com/v1/listen?');
  });

  it('rejects empty audio before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      transcribeSpeech(
        { ...request, audioBuffer: [] },
        { enabled: true, provider: 'openai', openai: { api_key: 'secret', model: 'whisper-1' } }
      )
    ).rejects.toThrow('STT_EMPTY_AUDIO');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the desktop bridge free of the legacy STT route', async () => {
    const source = await readFile(path.join(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts'), 'utf8');
    expect(source).not.toContain("'/api/stt'");
    expect(source).toContain("'speech.transcribe'");
  });
});
