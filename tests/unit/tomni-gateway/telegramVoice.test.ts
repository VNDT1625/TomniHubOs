import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { TelegramChannelService } from '@process/services/telegram/service';
import {
  MAX_TRANSCRIPT_CHARS,
  MAX_VOICE_BYTES,
  MAX_VOICE_SECONDS,
  checkVoice,
  cleanTranscript,
  createOpenAiCompatibleTranscriber,
  filenameFor,
  parseVoiceCallback,
  voiceCallbackData,
} from '@process/services/telegram/voice';

describe('checking a voice message before downloading it', () => {
  it('accepts a normal short voice note', () => {
    expect(checkVoice({ file_id: 'abc', duration: 12, mime_type: 'audio/ogg', file_size: 40_000 })).toEqual({
      ok: true,
    });
    expect(checkVoice({ file_id: 'abc' })).toEqual({ ok: true });
  });

  it.each([
    ['too long', { file_id: 'a', duration: MAX_VOICE_SECONDS + 1 }],
    ['too large', { file_id: 'a', file_size: MAX_VOICE_BYTES + 1 }],
    ['a video file', { file_id: 'a', mime_type: 'video/mp4' }],
    ['an executable', { file_id: 'a', mime_type: 'application/x-msdownload' }],
    ['without an id', { file_id: '' }],
    ['with an enormous id', { file_id: 'x'.repeat(300) }],
  ])('refuses audio that is %s', (_label, voice) => {
    const result = checkVoice(voice);
    expect(result.ok).toBe(false);
  });

  it('names the upload after what Telegram sent and falls back by type', () => {
    expect(filenameFor('voice/file_12.oga', 'audio/ogg')).toBe('voice.oga');
    expect(filenameFor('voice/file', 'audio/mpeg')).toBe('voice.mp3');
    expect(filenameFor('voice/file', 'audio/x-m4a')).toBe('voice.m4a');
    expect(filenameFor('voice/file', 'audio/wav')).toBe('voice.wav');
    expect(filenameFor('', 'audio/ogg')).toBe('voice.ogg');
  });
});

describe('the transcript and its buttons', () => {
  it('becomes one clean bounded line', () => {
    expect(cleanTranscript('  Mở\u0000 Chrome\n\n kiểm tra   email  ')).toBe('Mở Chrome kiểm tra email');
    expect(cleanTranscript('x'.repeat(MAX_TRANSCRIPT_CHARS + 50))).toHaveLength(MAX_TRANSCRIPT_CHARS);
    expect(cleanTranscript('   ')).toBe('');
  });

  it('round-trips the button data and refuses anything else', () => {
    const data = voiceCallbackData('ok', 'abc123def456');
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseVoiceCallback(data)).toEqual({ action: 'ok', id: 'abc123def456' });
    expect(parseVoiceCallback(voiceCallbackData('no', 'abcd'))).toEqual({ action: 'no', id: 'abcd' });
    for (const bad of [undefined, '', 'v:maybe:abcd', 'v:ok:', 'v:ok:../../x', 'x:ok:abcd', 'v:ok:ab']) {
      expect(parseVoiceCallback(bad)).toBeUndefined();
    }
  });
});

describe('an OpenAI-compatible transcriber', () => {
  it('posts the audio with the key in a header and returns the text', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transcribe = createOpenAiCompatibleTranscriber({
      baseUrl: 'https://api.example.com/v1/',
      model: 'whisper-large-v3',
      language: 'vi',
      getApiKey: async () => 'KEY',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ text: 'mở chrome' }), { status: 200 });
      }) as typeof fetch,
    });
    await expect(
      transcribe({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/ogg', filename: 'voice.ogg' })
    ).resolves.toBe('mở chrome');
    expect(calls[0].url).toBe('https://api.example.com/v1/audio/transcriptions');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer KEY');
    const form = calls[0].init?.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('language')).toBe('vi');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('fails clearly without a key or when the service answers with an error', async () => {
    const noKey = createOpenAiCompatibleTranscriber({
      baseUrl: 'https://x',
      model: 'm',
      getApiKey: async () => undefined,
    });
    await expect(noKey({ bytes: new Uint8Array(1), mimeType: 'audio/ogg', filename: 'v.ogg' })).rejects.toThrow(
      'STT_API_KEY_MISSING'
    );
    const failing = createOpenAiCompatibleTranscriber({
      baseUrl: 'https://x',
      model: 'm',
      getApiKey: async () => 'k',
      fetchImpl: (async () => new Response('no', { status: 429 })) as typeof fetch,
    });
    await expect(failing({ bytes: new Uint8Array(1), mimeType: 'audio/ogg', filename: 'v.ogg' })).rejects.toThrow(
      'STT_HTTP_429'
    );
  });
});

describe('voice messages in the Telegram channel', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const ok = (result: unknown): Response =>
    new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const harness = async (options: {
    updates: Array<unknown[] | ((sent: Array<{ method: string; body: Record<string, unknown> }>) => unknown[])>;
    transcribe?: (audio: unknown) => Promise<string>;
    withTranscriber?: boolean;
    fileSize?: number;
  }) => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-telegram-voice-'));
    const statePath = path.join(directory, 'telegram.json');
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        enabled: true,
        secretHandle: 'secret://telegram',
        offset: 0,
        pairings: [],
        users: [{ id: 'u1', platformUserId: '42', platformType: 'telegram', display_name: 'Ada', authorizedAt: 1 }],
        sessions: [],
      })
    );
    const vault = {
      put: vi.fn(),
      list: vi.fn(async () => []),
      resolve: vi.fn(async () => ({ token: '1:tok' })),
      remove: vi.fn(),
    } as unknown as SecretVault;
    const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
    const downloads: string[] = [];
    let batch = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/file/bot')) {
        downloads.push(value);
        return new Response(new Uint8Array([9, 9, 9, 9]), { status: 200 });
      }
      const method = value.split('/').at(-1) ?? '';
      const body =
        init?.body && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (method === 'getUpdates') {
        const next = options.updates[batch++];
        if (next) return ok(typeof next === 'function' ? next(sent) : next);
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      sent.push({ method, body });
      if (method === 'getFile') return ok({ file_path: 'voice/file_1.oga', file_size: options.fileSize ?? 4 });
      return ok({ message_id: 1 });
    });
    const send = vi.fn(async () => ({}));
    const transcribe = vi.fn(options.transcribe ?? (async () => 'Mở Chrome kiểm tra email'));
    const service = new TelegramChannelService({
      statePath,
      vault,
      conversations: {
        list: vi.fn(async () => ({ items: [{ extra: { workspace: 'C:/work' } }], total: 1, has_more: false })),
        create: vi.fn(async () => ({ id: 'conv-1' })),
        update: vi.fn(async () => ({})),
        send,
      } as never,
      events: { pairingRequested: vi.fn(), userAuthorized: vi.fn(), statusChanged: vi.fn() },
      fetchImpl: fetchImpl as typeof fetch,
      readSettings: vi.fn(async () => ({ model: { use_model: 'gpt' } as never })),
      isExternalAuthorityGranted: () => true,
      ...(options.withTranscriber === false ? {} : { transcribeVoice: transcribe as never }),
    });
    await service.resume();
    return { service, sent, downloads, send, transcribe };
  };

  const voiceUpdate = (id: number, voice: Record<string, unknown> = {}, from = 42) => ({
    update_id: id,
    message: {
      chat: { id: 99 },
      from: { id: from, first_name: 'Ada' },
      voice: { file_id: 'F', duration: 5, mime_type: 'audio/ogg', file_size: 4, ...voice },
    },
  });
  const press = (id: number, data: string, from = 42) => ({
    update_id: id,
    callback_query: { id: `cb${id}`, from: { id: from }, data, message: { chat: { id: 99 } } },
  });

  it('transcribes, shows the text with buttons, and sends nothing to the agent yet', async () => {
    const { service, sent, downloads, send, transcribe } = await harness({ updates: [[voiceUpdate(1)]] });
    await vi.waitFor(() => expect(sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(downloads[0]).toContain('/file/bot1:tok/voice/file_1.oga');
    expect(transcribe).toHaveBeenCalledTimes(1);
    const prompt = sent.find((entry) => entry.method === 'sendMessage');
    expect(String(prompt?.body.text)).toContain('Mở Chrome kiểm tra email');
    const buttons = (prompt?.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
      .inline_keyboard[0];
    expect(buttons.map((button) => button.callback_data)).toEqual([
      expect.stringMatching(/^v:ok:/u),
      expect.stringMatching(/^v:no:/u),
    ]);
    expect(send).not.toHaveBeenCalled();
    await service.disable();
  });

  const promptButtons = (sent: Array<{ method: string; body: Record<string, unknown> }>): string[] => {
    const prompt = sent.find((entry) => entry.method === 'sendMessage');
    const markup = prompt?.body.reply_markup as
      | { inline_keyboard: Array<Array<{ callback_data: string }>> }
      | undefined;
    return markup?.inline_keyboard[0].map((button) => button.callback_data) ?? [];
  };

  it('runs the text only after the speaker presses confirm', async () => {
    const { service, send } = await harness({
      updates: [[voiceUpdate(1)], (sent) => [press(2, promptButtons(sent)[0])]],
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith({ conversation_id: 'conv-1', input: 'Mở Chrome kiểm tra email' });
    await service.disable();
  });

  it('drops the text when the speaker cancels', async () => {
    const { service, sent, send } = await harness({
      updates: [[voiceUpdate(1)], (done) => [press(2, promptButtons(done)[1])]],
    });
    await vi.waitFor(() => expect(sent.some((entry) => entry.method === 'answerCallbackQuery')).toBe(true));
    expect(send).not.toHaveBeenCalled();
    expect(String(sent.find((entry) => entry.method === 'answerCallbackQuery')?.body.text)).toContain('hủy');
    await service.disable();
  });

  it('ignores a button pressed by someone else, and a button pressed twice', async () => {
    const stranger = await harness({
      updates: [[voiceUpdate(1)], (done) => [press(2, promptButtons(done)[0], 777)]],
    });
    await vi.waitFor(() => expect(stranger.sent.some((entry) => entry.method === 'answerCallbackQuery')).toBe(true));
    expect(stranger.send).not.toHaveBeenCalled();
    expect(String(stranger.sent.find((entry) => entry.method === 'answerCallbackQuery')?.body.text)).toContain(
      'hết hạn'
    );
    await stranger.service.disable();

    const twice = await harness({
      updates: [[voiceUpdate(1)], (done) => [press(2, promptButtons(done)[0]), press(3, promptButtons(done)[0])]],
    });
    await vi.waitFor(() => expect(twice.send).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(twice.sent.filter((entry) => entry.method === 'answerCallbackQuery')).toHaveLength(2)
    );
    expect(twice.send).toHaveBeenCalledTimes(1);
    await twice.service.disable();
  });

  it('is told that voice is not set up when there is no transcriber', async () => {
    const { service, sent, downloads } = await harness({ updates: [[voiceUpdate(1)]], withTranscriber: false });
    await vi.waitFor(() => expect(sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(String(sent.find((entry) => entry.method === 'sendMessage')?.body.text)).toContain('chưa được bật');
    expect(downloads).toHaveLength(0);
    await service.disable();
  });

  it('refuses a long voice note without downloading it', async () => {
    const { service, sent, downloads, transcribe } = await harness({
      updates: [[voiceUpdate(1, { duration: 300 })]],
    });
    await vi.waitFor(() => expect(sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(String(sent.find((entry) => entry.method === 'sendMessage')?.body.text)).toContain('60 giây');
    expect(downloads).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
    await service.disable();
  });

  it('reports a recognition failure and an empty transcript without starting any work', async () => {
    const failing = await harness({
      updates: [[voiceUpdate(1)]],
      transcribe: async () => {
        throw new Error('STT_HTTP_500');
      },
    });
    await vi.waitFor(() => expect(failing.sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(String(failing.sent.find((entry) => entry.method === 'sendMessage')?.body.text)).toContain(
      'Không xử lý được'
    );
    expect(failing.send).not.toHaveBeenCalled();
    await failing.service.disable();

    const empty = await harness({ updates: [[voiceUpdate(1)]], transcribe: async () => '   ' });
    await vi.waitFor(() => expect(empty.sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(String(empty.sent.find((entry) => entry.method === 'sendMessage')?.body.text)).toContain('Không nghe rõ');
    await empty.service.disable();
  });

  it('refuses a file that Telegram reports as too large before downloading it', async () => {
    const { service, sent, downloads } = await harness({
      updates: [[voiceUpdate(1, { file_size: undefined })]],
      fileSize: MAX_VOICE_BYTES + 10,
    });
    await vi.waitFor(() => expect(sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(downloads).toHaveLength(0);
    await service.disable();
  });
});
