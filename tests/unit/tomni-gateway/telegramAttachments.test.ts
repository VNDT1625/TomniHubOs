/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import {
  MAX_ATTACHMENT_BYTES,
  TELEGRAM_UPLOAD_DIRECTORY,
  pickAttachment,
  safeAttachmentName,
  splitTelegramText,
  storedAttachmentName,
} from '@process/services/telegram/attachments';
import { TelegramChannelService } from '@process/services/telegram/service';

describe('choosing what to take from a Telegram message', () => {
  it('takes the largest photo size that fits', () => {
    const pick = pickAttachment({
      photo: [
        { file_id: 'small', width: 90, height: 90, file_size: 1_000 },
        { file_id: 'big', width: 1280, height: 960, file_size: 200_000 },
        { file_id: 'huge', width: 4000, height: 3000, file_size: MAX_ATTACHMENT_BYTES + 1 },
      ],
    });
    expect(pick).toEqual({ kind: 'file', attachment: { fileId: 'big', name: 'photo.jpg', size: 200_000 } });
  });

  it('accepts documents an agent reads and refuses programs, archives, large files and video', () => {
    expect(pickAttachment({ document: { file_id: 'd', file_name: 'Báo cáo Q3.pdf' } })).toMatchObject({
      kind: 'file',
      attachment: { name: 'Báo cáo Q3.pdf' },
    });
    for (const file_name of ['setup.exe', 'tools.zip', 'run.ps1', 'noextension']) {
      expect(pickAttachment({ document: { file_id: 'd', file_name } }).kind).toBe('rejected');
    }
    expect(
      pickAttachment({ document: { file_id: 'd', file_name: 'a.pdf', file_size: MAX_ATTACHMENT_BYTES + 1 } }).kind
    ).toBe('rejected');
    expect(pickAttachment({ video: { file_id: 'v' } })).toMatchObject({ kind: 'rejected' });
    expect(pickAttachment({ sticker: { file_id: 's' } })).toMatchObject({ kind: 'rejected' });
    expect(pickAttachment({})).toEqual({ kind: 'none' });
  });

  it('turns any received name into one safe file name', () => {
    expect(safeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(safeAttachmentName('a<b>:c?.txt')).toBe('a_b__c_.txt');
    expect(safeAttachmentName('...')).toBe('file');
    expect(storedAttachmentName('photo.jpg', new Date(2026, 9, 5, 9, 3, 7), 'abc123')).toBe(
      '20261005-090307-abc123-photo.jpg'
    );
  });

  it('splits a long reply on line breaks and says when it stopped early', () => {
    expect(splitTelegramText('short')).toEqual(['short']);
    const lines = Array.from({ length: 30 }, (_, index) => `${index}`.padEnd(300, 'x')).join(String.fromCharCode(10));
    const parts = splitTelegramText(lines, 1000, 20);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 1000)).toBe(true);
    expect(parts.join('').replaceAll(String.fromCharCode(10), '')).toBe(lines.replaceAll(String.fromCharCode(10), ''));
    const capped = splitTelegramText('y'.repeat(50), 10, 2);
    expect(capped).toHaveLength(2);
    expect(capped[1].length).toBeLessThanOrEqual(10 + 40);
    expect(capped[1]).toContain('còn tiếp');
  });
});

describe('files sent to the Telegram channel', () => {
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

  const harness = async (message: Record<string, unknown>, options: { download?: () => Response } = {}) => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomni-telegram-files-'));
    const workspace = path.join(directory, 'work');
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
    const vault = { resolve: vi.fn(async () => ({ token: '1:tok' })) } as unknown as SecretVault;
    const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
    const downloads: string[] = [];
    let delivered = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.includes('/file/bot')) {
        downloads.push(value);
        return options.download?.() ?? new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }
      const method = value.split('/').at(-1) ?? '';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (method === 'getUpdates') {
        if (!delivered) {
          delivered = true;
          return ok([{ update_id: 1, message: { chat: { id: 99 }, from: { id: 42, first_name: 'Ada' }, ...message } }]);
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      sent.push({ method, body });
      if (method === 'getFile') return ok({ file_path: 'photos/file_7.jpg', file_size: 4 });
      return ok({ message_id: 1 });
    });
    const send = vi.fn(async (_params: { conversation_id: string; input: string; files?: string[] }) => ({}));
    const service = new TelegramChannelService({
      statePath,
      vault,
      conversations: {
        list: vi.fn(async () => ({ items: [{ extra: { workspace } }], total: 1, has_more: false })),
        create: vi.fn(async () => ({ id: 'conv-1' })),
        update: vi.fn(async () => ({})),
        send,
      } as never,
      events: { pairingRequested: vi.fn(), userAuthorized: vi.fn(), statusChanged: vi.fn() },
      fetchImpl: fetchImpl as typeof fetch,
      readSettings: vi.fn(async () => ({ model: { use_model: 'gpt' } as never })),
      isExternalAuthorityGranted: () => true,
    });
    await service.resume();
    return { service, sent, downloads, send, workspace };
  };

  it('saves a photo in the workspace and gives it to the agent with the caption', async () => {
    const { service, send, downloads, workspace } = await harness({
      photo: [{ file_id: 'P', width: 800, height: 600, file_size: 4 }],
      caption: 'What is wrong in this screenshot?',
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(downloads[0]).toContain('/file/bot1:tok/photos/file_7.jpg');
    const params = send.mock.calls[0][0];
    expect(params.input).toBe('What is wrong in this screenshot?');
    expect(params.files).toHaveLength(1);
    const stored = params.files?.[0] ?? '';
    expect(path.dirname(stored)).toBe(path.join(workspace, TELEGRAM_UPLOAD_DIRECTORY));
    expect(stored).toMatch(/photo\.jpg$/u);
    expect([...(await readFile(stored))]).toEqual([1, 2, 3, 4]);
    await service.disable();
  });

  it('names the request after the file when there is no caption', async () => {
    const { service, send } = await harness({ document: { file_id: 'D', file_name: 'notes.md', file_size: 4 } });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].input).toMatch(/^📎 .*notes\.md$/u);
    await service.disable();
  });

  it('refuses a program without downloading it, and explains video is not supported', async () => {
    const program = await harness({ document: { file_id: 'D', file_name: 'setup.exe', file_size: 4 } });
    await vi.waitFor(() => expect(program.sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(program.downloads).toHaveLength(0);
    expect(program.send).not.toHaveBeenCalled();
    await program.service.disable();

    const video = await harness({ video: { file_id: 'V' } });
    await vi.waitFor(() => expect(video.sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(String(video.sent.find((entry) => entry.method === 'sendMessage')?.body.text)).toContain('video');
    expect(video.send).not.toHaveBeenCalled();
    await video.service.disable();
  });

  it('tells the user when the download fails and stores nothing', async () => {
    const { service, sent, send, workspace } = await harness(
      { photo: [{ file_id: 'P', width: 10, height: 10 }] },
      { download: () => new Response('gone', { status: 404 }) }
    );
    await vi.waitFor(() => expect(sent.some((entry) => entry.method === 'sendMessage')).toBe(true));
    expect(String(sent.find((entry) => entry.method === 'sendMessage')?.body.text)).toContain('Không nhận được tệp');
    expect(send).not.toHaveBeenCalled();
    const uploads = await readdir(path.join(workspace, TELEGRAM_UPLOAD_DIRECTORY)).catch((): string[] => []);
    expect(uploads).toHaveLength(0);
    await service.disable();
  });
});
