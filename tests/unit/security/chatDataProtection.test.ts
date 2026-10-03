import { describe, expect, it } from 'vitest';

import { createChatTemporarySecretStore, protectChatData } from '@/process/services/security/chatDataProtection';

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
};

const createStore = () =>
  createChatTemporarySecretStore(codec, { now: () => 1_700_000_000_000, newHandle: () => 'temp://chat/test' });

describe('chat data protection', () => {
  it('rewrites semantic sensitive text into a session-only handle', async () => {
    const store = createStore();
    const result = await protectChatData(
      { sessionId: 'chat-1', source: 'text', text: 'Thông tin riêng của tôi là mã 7A-91-XY.' },
      {
        store,
        classifier: {
          execution: 'local',
          classify: async () => ({
            findings: [
              { start: 30, end: 38, category: 'unclassified', confidence: 0.95, label: 'Thông tin riêng của tôi' },
            ],
          }),
        },
      }
    );

    expect(result).toMatchObject({
      decision: 'protected',
      rewrittenText: 'Thông tin riêng của tôi là mã [THONG_TIN_RIENG_CUA_TOI_TEMP_01].',
    });
    expect(store.list('chat-1')).toEqual([
      expect.objectContaining({
        handle: 'temp://chat/test',
        category: 'unclassified',
        label: 'Thông tin riêng của tôi',
      }),
    ]);
    expect(JSON.stringify(store.audit('chat-1'))).not.toContain('7A-91-XY');
  });

  it('moves an accepted temporary value out of the session store', async () => {
    const store = createStore();
    const secret = store.create('chat-2', {
      label: 'Địa chỉ giao hàng',
      category: 'personal.address',
      confidence: 1,
      source: 'text',
      value: '12 Nguyễn Huệ, Quận 1',
    });

    expect(store.accept('chat-2', secret.handle)).toMatchObject({ value: '12 Nguyễn Huệ, Quận 1' });
    expect(store.list('chat-2')).toEqual([]);
    expect(JSON.stringify(store.audit('chat-2'))).not.toContain('12 Nguyễn Huệ');
  });

  it('clears all unaccepted values when a chat tab closes', () => {
    const store = createStore();
    store.create('chat-3', {
      label: 'Số điện thoại',
      category: 'personal.contact',
      confidence: 1,
      source: 'text',
      value: '0901234567',
    });

    store.clear('chat-3');

    expect(store.list('chat-3')).toEqual([]);
  });

  it('fails closed when semantic output is malformed', async () => {
    const result = await protectChatData(
      { sessionId: 'chat-4', source: 'text', text: 'Mã riêng: 7A-91-XY' },
      {
        store: createStore(),
        classifier: { execution: 'local', classify: async () => ({ findings: [{ start: 'bad' }] }) },
      }
    );

    expect(result).toEqual({ decision: 'block', reason: 'semantic_classifier_invalid' });
  });

  it('blocks deterministic credentials instead of sending their plaintext to a classifier', async () => {
    const classifier = { execution: 'local' as const, classify: vi.fn() };
    const result = await protectChatData(
      { sessionId: 'chat-5', source: 'text', text: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456' },
      { store: createStore(), classifier }
    );

    expect(result).toEqual({ decision: 'block', reason: 'deterministic_secret_detected' });
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});
