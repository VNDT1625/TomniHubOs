/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Attached capabilities are pre-bound (2026-10-15). An attached plugin (chat (+) menu, assistant, or enabled registry
 * server) and an attached skill are chosen on the first turn, without a keyword match and without any search call.
 * With nothing attached, the auto-select behaviour is unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHED_LIMITS,
  CAPABILITY_BUDGET,
  renderCapabilityHint,
  resolveCapabilityTurn,
  selectCapabilities,
  type CapabilityCandidate,
} from '@process/services/chatPipeline/stages/capabilitySelect';

const plugin = (name: string, overrides: Partial<CapabilityCandidate> = {}): CapabilityCandidate => ({
  id: `mcp:${name}`,
  kind: 'plugin',
  name,
  description: `${name} server with many tools`,
  enabled: true,
  approved: true,
  runsCode: true,
  ...overrides,
});

const skill = (
  name: string,
  description: string,
  overrides: Partial<CapabilityCandidate> = {}
): CapabilityCandidate => ({
  id: `skill:${name}`,
  kind: 'skill',
  name,
  description,
  enabled: true,
  approved: true,
  runsCode: false,
  ...overrides,
});

describe('attached capabilities are pre-bound', () => {
  it('chooses an attached plugin on turn 1 even when the request does not mention it', async () => {
    const selection = await selectCapabilities({
      request: 'draft a weekly status note',
      candidates: [plugin('context-mode', { attached: true }), plugin('github')],
    });
    expect(selection.selectedIds).toContain('mcp:context-mode');
    expect(selection.selectedIds).not.toContain('mcp:github');
  });

  it('keeps the old keyword-only behaviour when nothing is attached', async () => {
    const selection = await selectCapabilities({
      request: 'draft a weekly status note',
      candidates: [plugin('context-mode'), plugin('github')],
    });
    expect(selection.selectedIds).toEqual([]);
  });

  it('never pins an attached entry that is disabled or unapproved', async () => {
    const selection = await selectCapabilities({
      request: 'anything',
      candidates: [
        plugin('off', { attached: true, enabled: false }),
        plugin('unapproved', { attached: true, approved: false }),
        plugin('ok', { attached: true }),
      ],
    });
    expect(selection.selectedIds).toEqual(['mcp:ok']);
    expect(selection.unusable).toBe(2);
  });

  it('caps attached plugins and skills; the rest stay ordinary keyword candidates', async () => {
    const plugins = Array.from({ length: ATTACHED_LIMITS.maxPlugins + 2 }, (_unused, index) =>
      plugin(`attached-${index}`, { attached: true })
    );
    const skills = Array.from({ length: ATTACHED_LIMITS.maxSkills + 1 }, (_unused, index) =>
      skill(`skill-${index}`, 'ordinary description', { attached: true })
    );
    const selection = await selectCapabilities({ request: 'unrelated', candidates: [...plugins, ...skills] });
    const pluginPicks = selection.selectedIds.filter((id) => id.startsWith('mcp:'));
    const skillPicks = selection.selectedIds.filter((id) => id.startsWith('skill:'));
    expect(pluginPicks).toHaveLength(ATTACHED_LIMITS.maxPlugins);
    expect(skillPicks).toHaveLength(ATTACHED_LIMITS.maxSkills);
  });

  it('keeps keyword picks within their own budget on top of the attached set', async () => {
    const attached = [plugin('pinned', { attached: true })];
    const matching = Array.from({ length: CAPABILITY_BUDGET.maxPlugins + 2 }, (_unused, index) =>
      plugin(`pdf-${index}`, { description: 'pdf reports', name: `pdf-${index}` })
    );
    const selection = await selectCapabilities({
      request: 'make a pdf report',
      candidates: [...attached, ...matching],
    });
    expect(selection.selectedIds[0]).toBe('mcp:pinned');
    expect(selection.selectedIds.length).toBeLessThanOrEqual(1 + CAPABILITY_BUDGET.maxTotal);
  });
});

describe('the auto-select turn carries attached servers and skill descriptions', () => {
  it('restores an enabled registry server that the conversation snapshot does not hold', async () => {
    const turn = await resolveCapabilityTurn({
      mode: 'auto',
      request: 'what is my budget this month',
      candidates: [plugin('context-mode', { attached: true })],
      servers: [
        {
          id: 'context-mode',
          name: 'context-mode',
          transport: { type: 'stdio', command: 'npx', args: ['context-mode'] },
        },
      ],
    });
    expect(turn?.mcpServerIds).toEqual(['context-mode']);
    expect(turn?.mcpServers.map((server) => server.name)).toEqual(['context-mode']);
    expect(turn?.hint).toContain('attached, already loaded');
    expect(turn?.hint).toContain('context-mode');
  });

  it('lists each chosen skill with its one-line description and says how to read the body', async () => {
    const turn = await resolveCapabilityTurn({
      mode: 'auto',
      request: 'make a PowerPoint presentation',
      candidates: [skill('pptx', 'Create and edit PowerPoint slides.', { attached: true })],
    });
    expect(turn?.skillNames).toEqual(['pptx']);
    expect(turn?.hint).toContain('  - pptx: Create and edit PowerPoint slides.');
    expect(turn?.hint).toContain('skills_read');
  });

  it('keeps the protocol line and the mode switch: manual conversations get no turn', async () => {
    const manual = await resolveCapabilityTurn({
      mode: 'manual',
      request: 'anything',
      candidates: [plugin('context-mode', { attached: true })],
    });
    expect(manual).toBeUndefined();
    const hint = renderCapabilityHint({ skills: [], plugins: [], hooks: 0 });
    expect(hint.split('\n').find((line) => line.startsWith('Protocol'))).toContain('tools_search');
  });
});
