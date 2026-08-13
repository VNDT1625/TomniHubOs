import { afterEach, describe, expect, it, vi } from 'vitest';
import { TomniRemoteEventBroker } from '@process/services/remoteGateway/eventBroker';
import { startTomniRemoteGateway, type TomniRemoteGatewayHost } from '@process/services/remoteGateway/server';
import type { TomniRemoteConversationPort } from '@process/services/remoteGateway/types';

const SECRET = 'a'.repeat(64);
const auth = { authorization: `Bearer ${SECRET}` };
let host: TomniRemoteGatewayHost | undefined;

const port = (): TomniRemoteConversationPort => ({
  list: vi.fn().mockResolvedValue({ items: [{ id: 'conv-1' }], total: 1, has_more: false }),
  history: vi.fn().mockResolvedValue({ items: [{ msg_id: 'msg-1' }], total: 1, has_more: false }),
  send: vi.fn().mockResolvedValue({ request_id: 'req-1' }),
  cancel: vi.fn().mockResolvedValue(true),
});

afterEach(async () => {
  await host?.close();
  host = undefined;
});

describe('Tomny remote gateway contract', () => {
  it('is loopback native, fail-closed, and delegates chat without /api legacy calls', async () => {
    const conversations = port();
    const events = new TomniRemoteEventBroker();
    host = await startTomniRemoteGateway({ secret: SECRET, conversations, events, language: 'vi-VN' });

    const health = await fetch(`${host.localUrl}/health`);
    expect(await health.json()).toMatchObject({
      ok: true,
      runtime: 'tomni-native',
      protocol: 'tomni.remote.v1',
    });
    expect((await fetch(`${host.localUrl}/v1/conversations`)).status).toBe(401);

    const list = await fetch(`${host.localUrl}/v1/conversations?limit=20`, { headers: auth });
    expect(await list.json()).toMatchObject({ total: 1, items: [{ id: 'conv-1' }] });

    const sent = await fetch(`${host.localUrl}/v1/conversations/conv-1/messages`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'hello', files: ['note.txt'] }),
    });
    expect(sent.status).toBe(202);
    expect(await sent.json()).toEqual({ request_id: 'req-1' });
    expect(conversations.send).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      input: 'hello',
      files: ['note.txt'],
    });
  });

  it('replays sequenced native events so multiple clients can reconnect', async () => {
    const events = new TomniRemoteEventBroker();
    events.publish({ kind: 'conversation.list', payload: { conversation_id: 'one' } });
    events.publish({ kind: 'conversation.response', payload: { conversation_id: 'one', text: 'hello' } });
    host = await startTomniRemoteGateway({ secret: SECRET, conversations: port(), events });

    const abort = new AbortController();
    const response = await fetch(`${host.localUrl}/v1/events?after=1`, {
      headers: auth,
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const chunk = await reader?.read();
    const text = new TextDecoder().decode(chunk?.value);
    expect(text).toContain('id: 2');
    expect(text).toContain('event: conversation.response');
    expect(text).not.toContain('conversation.list');
    abort.abort();
  });

  it('updates public URL and language in memory without an HTTP backend round-trip', async () => {
    host = await startTomniRemoteGateway({
      secret: SECRET,
      conversations: port(),
      events: new TomniRemoteEventBroker(),
    });
    host.configure({ language: 'ja-JP', publicUrl: 'https://remote.example' });
    const response = await fetch(`${host.localUrl}/v1/status`, { headers: auth });
    expect(await response.json()).toMatchObject({
      language: 'ja-JP',
      publicUrl: 'https://remote.example',
      sequence: 0,
    });
  });
});
