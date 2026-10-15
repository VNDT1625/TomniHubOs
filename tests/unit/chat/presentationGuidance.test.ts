import { describe, expect, it } from 'vitest';
import { addPresentationGuidance } from '@/common/chat/presentationGuidance';

describe('shared automatic presentation guidance', () => {
  it('injects visual affordances for explanatory turns without requiring /visual', () => {
    expect(addPresentationGuidance('Giải thích kiến trúc MCP Gateway')).toContain('[TomniPresentation]');
    expect(addPresentationGuidance('compare sequential and parallel', 'existing directives')).toContain(
      'existing directives'
    );
  });
  it('leaves simple chat, explicit slash modes, and package commands alone', () => {
    expect(addPresentationGuidance('xin chào')).toBeUndefined();
    expect(addPresentationGuidance('/visual giải thích')).toBeUndefined();
    expect(addPresentationGuidance('/build0 thiết kế trang web')).toBeUndefined();
    expect(addPresentationGuidance('')).toBeUndefined();
  });
});
