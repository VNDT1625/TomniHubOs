/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the shared workspace-primer builder. Pure string assertions:
 * verify ordering, optional Planning Mode block, empty-rules path, and that
 * the session-memory block is appended idempotently.
 */

import { describe, expect, it } from 'vitest';
import { buildIdeMemorySection, buildWorkspacePrimer, withIdeMemorySection } from '@/process/ide/workspacePrimer';

const baseInput = {
  rootPath: '/repo/AionUi',
  rules: ['First rule', 'Second rule'] as const,
  planningEnabled: false,
  sessionMemoryId: 'sess-42',
};

describe('buildWorkspacePrimer', () => {
  it('emits the workspace guide + project rules + session memory blocks', () => {
    const primer = buildWorkspacePrimer(baseInput);
    expect(primer).toContain('## IDE workspace guide');
    expect(primer).toContain('Workspace root: /repo/AionUi');
    expect(primer).toContain('## Project rules');
    expect(primer).toContain('- First rule');
    expect(primer).toContain('## Session memory (your restart-resilient Save)');
    expect(primer).toContain('Your session memory id is: sess-42');
  });

  it('includes Planning Mode when enabled', () => {
    const primer = buildWorkspacePrimer({ ...baseInput, planningEnabled: true });
    expect(primer).toContain('## Planning Mode: ON');
  });

  it('omits Planning Mode when disabled', () => {
    const primer = buildWorkspacePrimer(baseInput);
    expect(primer).not.toContain('Planning Mode: ON');
  });

  it('omits the Project rules block when rules is empty', () => {
    const primer = buildWorkspacePrimer({ ...baseInput, rules: [] });
    expect(primer).not.toContain('## Project rules');
    // session memory + workspace guide still present
    expect(primer).toContain('## IDE workspace guide');
    expect(primer).toContain('## Session memory');
  });
  it('includes only safe Secret Context metadata and explains guarded environment injection', () => {
    const primer = buildWorkspacePrimer({
      ...baseInput,
      repoSecrets: [
        { alias: 'SEPAY_WEBHOOK_SECRET', description: 'SePay webhook signature', status: 'set' },
        { alias: 'MISSING_VALUE', description: 'Not configured yet', status: 'needs_value' },
      ],
      repoSecretCombos: [
        {
          comboId: 'github-account',
          comboLabel: 'GitHub account',
          description: 'Release credentials',
          keys: [
            { alias: 'GITHUB_USERNAME', status: 'set' },
            { alias: 'GITHUB_TOKEN', status: 'set' },
          ],
        },
      ],
    });

    expect(primer).toContain('## Repository Secret Context (metadata only)');
    expect(primer).toContain('- SEPAY_WEBHOOK_SECRET: set; purpose: SePay webhook signature');
    expect(primer).toContain('- MISSING_VALUE: needs_value; purpose: Not configured yet');
    expect(primer).toContain('never claim that the value or credential is missing');
    expect(primer).toContain('`secretAliases`');
    expect(primer).toContain('github-account');
    expect(primer).toContain('GITHUB_USERNAME: set');
    expect(primer).toContain('secretComboIds');
  });
});

describe('buildIdeMemorySection / withIdeMemorySection', () => {
  it('embeds the sessionId verbatim', () => {
    expect(buildIdeMemorySection('sess-X')).toContain('Your session memory id is: sess-X');
  });

  it('instructs agents to use the local-render marker for an explicit Secret Context reveal', () => {
    const section = buildIdeMemorySection('sess-X');
    expect(section).toContain('ALIAS is {{secret:ALIAS}}');
    expect(section).toContain('TEST is {{secret:TEST}}');
    expect(section).toContain('never receive, print, request, or infer its value');
  });

  it('is idempotent: a second append does not duplicate the block', () => {
    const once = withIdeMemorySection('sess-1', 'existing');
    const twice = withIdeMemorySection('sess-1', once);
    const matches = twice.match(/## Session memory \(your restart-resilient Save\)/g);
    expect(matches?.length).toBe(1);
  });

  it('preserves existing rules when prepending', () => {
    const combined = withIdeMemorySection('sess-1', '## Project rules\n- existing');
    expect(combined.startsWith('## Project rules')).toBe(true);
    expect(combined).toContain('- existing');
    expect(combined).toContain('## Session memory');
  });
});
