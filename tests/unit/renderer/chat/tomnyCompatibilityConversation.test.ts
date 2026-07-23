import { describe, expect, it } from 'vitest';
import { isTomnyCompatibilityConversation } from '@/renderer/pages/conversation/components/ChatConversation';

describe('Tomni compatibility conversation routing', () => {
  it('routes a legacy ACP Tomni conversation to the native chat plane', () => {
    expect(isTomnyCompatibilityConversation({ type: 'acp', extra: { backend: 'tomny' } })).toBe(true);
  });

  it('keeps a non-Tomni ACP conversation on the ACP chat plane', () => {
    expect(isTomnyCompatibilityConversation({ type: 'acp', extra: { backend: 'codex' } })).toBe(false);
  });

  it('keeps an ACP row with no backend metadata on the ACP chat plane', () => {
    expect(isTomnyCompatibilityConversation({ type: 'acp', extra: undefined })).toBe(false);
  });
});
