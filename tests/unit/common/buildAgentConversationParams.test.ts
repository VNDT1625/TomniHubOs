import { describe, expect, it } from 'vitest';
import { getConversationTypeForBackend, isTomnyAgentBackend } from '@/common/utils/buildAgentConversationParams';
import { getAskMode, getFullAutoMode } from '@/common/types/agent/agentModes';

describe('Tomny conversation type mapping', () => {
  it('treats the built-in Tomny backend as the native agent runtime', () => {
    expect(getConversationTypeForBackend('tomny')).toBe('tomnyagentic');
  });

  it('recognizes every persisted Tomny backend alias as native', () => {
    expect(isTomnyAgentBackend('tomnyagentic')).toBe(true);
    expect(isTomnyAgentBackend('tomny')).toBe(true);
    expect(isTomnyAgentBackend('tomni')).toBe(true);
  });

  it('keeps a regular ACP backend outside the native Tomny path', () => {
    expect(isTomnyAgentBackend('codex')).toBe(false);
  });

  it('uses the native permission modes for Tomny aliases in Strict IDE Mode', () => {
    expect(getAskMode('tomny')).toBe('default');
    expect(getFullAutoMode('tomny')).toBe('yolo');
  });
});
