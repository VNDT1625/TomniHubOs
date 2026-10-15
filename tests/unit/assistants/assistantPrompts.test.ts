/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  addPromptLine,
  canAddPrompt,
  normalizePrompts,
  removePromptLine,
  updatePromptLine,
} from '@/common/types/agent/assistant/assistantPrompts';
import { ASSISTANT_LIMITS, parseCreateAssistantRequest } from '@/common/types/agent/assistant/assistantSchema';

describe('example prompt rules', () => {
  it('adds, edits and removes lines without touching the original list', () => {
    const start = ['first'];
    const added = addPromptLine(start);
    expect(added).toEqual(['first', '']);
    expect(start).toEqual(['first']);
    expect(updatePromptLine(added, 1, 'second')).toEqual(['first', 'second']);
    expect(removePromptLine(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(updatePromptLine(['a'], 5, 'x')).toEqual(['a']);
  });

  it('stops adding at the cap and cuts overlong lines', () => {
    const full = Array.from({ length: ASSISTANT_LIMITS.promptMax }, (_, i) => `p${i}`);
    expect(canAddPrompt(full)).toBe(false);
    expect(addPromptLine(full)).toHaveLength(ASSISTANT_LIMITS.promptMax);
    expect(updatePromptLine(['a'], 0, 'x'.repeat(ASSISTANT_LIMITS.promptLength + 50))).toEqual([
      'x'.repeat(ASSISTANT_LIMITS.promptLength),
    ]);
  });

  it('normalizes on save: trims, drops empty lines and keeps at most the cap', () => {
    expect(normalizePrompts(['  hi  ', '', '   ', 'there'])).toEqual(['hi', 'there']);
    const many = Array.from({ length: ASSISTANT_LIMITS.promptMax + 5 }, (_, i) => `p${i}`);
    expect(normalizePrompts(many)).toHaveLength(ASSISTANT_LIMITS.promptMax);
  });

  it('the IPC schema refuses more prompts than the cap', () => {
    const tooMany = Array.from({ length: ASSISTANT_LIMITS.promptMax + 1 }, (_, i) => `p${i}`);
    expect(() => parseCreateAssistantRequest({ name: 'x', prompts: tooMany })).toThrow();
    expect(parseCreateAssistantRequest({ name: 'x', prompts: ['ok'] }).prompts).toEqual(['ok']);
  });
});
