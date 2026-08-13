/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { BUILD0_COMMAND_NAME, expandBuild0Command, parseBuild0Command } from '@/common/chat/slash/build0Command';

describe('parseBuild0Command', () => {
  it('recognizes the built-in command without a product brief', () => {
    expect(BUILD0_COMMAND_NAME).toBe('build0');
    expect(parseBuild0Command('  /BUILD0  ')).toEqual({ brief: '' });
  });

  it('preserves a trimmed multi-line product brief', () => {
    expect(parseBuild0Command('/build0   Build a salon app\nwith offline booking   ')).toEqual({
      brief: 'Build a salon app\nwith offline booking',
    });
  });

  it('rejects lookalike commands and ordinary messages', () => {
    expect(['/build00', '/build0-now', 'please /build0 an app', ''].map(parseBuild0Command)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('expands the slash command into a chat-first discovery contract', () => {
    const prompt = expandBuild0Command('/build0 Build a cross-platform booking app');

    expect(prompt).toContain('Build a cross-platform booking app');
    expect(prompt).toContain('Begin in conversation');
    expect(prompt).toContain('interactive structured input');
    expect(prompt).toContain('VIU is the visual prototyping and design-to-code workspace');
    expect(prompt).not.toContain('VIU operator');
  });

  it('starts by asking for the product outcome when no brief is supplied', () => {
    expect(expandBuild0Command('/build0')).toContain('No initial product brief was supplied');
    expect(expandBuild0Command('ordinary message')).toBeNull();
  });
});
