import { describe, expect, it } from 'vitest';
import { getConversationTypeForBackend, isTomniAgentBackend } from '@/common/utils/buildAgentConversationParams';
import { getAskMode, getFullAutoMode } from '@/common/types/agent/agentModes';

describe('Tomni conversation type mapping', () => {
  it('treats the built-in Tomni backend as the native agent runtime', () => {
    expect(getConversationTypeForBackend('tomny')).toBe('aionrs');
  });

  it('recognizes every persisted Tomni backend alias as native', () => {
    expect(isTomniAgentBackend('aionrs')).toBe(true);
    expect(isTomniAgentBackend('tomny')).toBe(true);
    expect(isTomniAgentBackend('tomni')).toBe(true);
  });

  it('keeps a regular ACP backend outside the native Tomni path', () => {
    expect(isTomniAgentBackend('codex')).toBe(false);
  });

  it('uses the native permission modes for Tomni aliases in Strict IDE Mode', () => {
    expect(getAskMode('tomny')).toBe('default');
    expect(getFullAutoMode('tomny')).toBe('yolo');
  });
});
