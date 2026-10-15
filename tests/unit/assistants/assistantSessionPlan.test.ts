/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  countAssistantItems,
  dropAppliedPlugins,
  planAssistantSession,
  type AssistantSessionAvailability,
} from '@/common/types/agent/assistant/assistantSessionSelection';

const HOOK_A = 'a'.repeat(64);
const HOOK_B = 'b'.repeat(64);
const HOOK_OFF = 'c'.repeat(64);

const availability: AssistantSessionAvailability = {
  skillNames: ['web-search', 'summarize'],
  plugins: [
    { id: 'mcp-search', enabled: true },
    { id: 'mcp-off', enabled: false },
  ],
  activeHookIds: [HOOK_A, HOOK_B],
};

describe('planAssistantSession', () => {
  it('applies only items that are installed, enabled and active', () => {
    const plan = planAssistantSession(
      {
        enabled_skills: ['web-search'],
        custom_skill_names: ['summarize'],
        enabled_plugins: ['mcp-search'],
        enabled_hooks: [HOOK_A],
      },
      availability
    );
    expect(plan).toEqual({
      skills: ['web-search', 'summarize'],
      pluginIds: ['mcp-search'],
      hookIds: [HOOK_A],
      toolIds: [],
      notices: [],
    });
  });

  it('turns missing or disabled items into notices instead of enabling them', () => {
    const plan = planAssistantSession(
      {
        enabled_skills: ['ghost-skill'],
        custom_skill_names: [],
        enabled_plugins: ['mcp-off', 'mcp-missing'],
        enabled_hooks: [HOOK_OFF],
      },
      availability
    );
    expect(plan.skills).toEqual([]);
    expect(plan.pluginIds).toEqual([]);
    expect(plan.hookIds).toEqual([]);
    expect(plan.notices).toEqual([
      { kind: 'skill', id: 'ghost-skill', reason: 'not-installed' },
      { kind: 'plugin', id: 'mcp-off', reason: 'not-enabled' },
      { kind: 'plugin', id: 'mcp-missing', reason: 'not-installed' },
      { kind: 'hook', id: HOOK_OFF, reason: 'not-active' },
    ]);
  });

  it('removes duplicates across skill lists and never widens the hook set', () => {
    const plan = planAssistantSession(
      {
        enabled_skills: ['web-search', 'web-search'],
        custom_skill_names: ['web-search'],
        enabled_plugins: ['mcp-search', 'mcp-search'],
        enabled_hooks: [HOOK_B, HOOK_B],
      },
      availability
    );
    expect(plan.skills).toEqual(['web-search']);
    expect(plan.pluginIds).toEqual(['mcp-search']);
    expect(plan.hookIds).toEqual([HOOK_B]);
  });

  it('plans an empty assistant to an empty session', () => {
    const plan = planAssistantSession(
      { enabled_skills: [], custom_skill_names: [], enabled_plugins: [], enabled_hooks: [] },
      availability
    );
    expect(plan).toEqual({ skills: [], pluginIds: [], hookIds: [], toolIds: [], notices: [] });
  });
});

describe('dropAppliedPlugins', () => {
  it('removes only the plugins the assistant applied and keeps the rest', () => {
    expect(dropAppliedPlugins(['super', 'mcp-search', 'mcp-other'], ['mcp-search'])).toEqual(['super', 'mcp-other']);
    expect(dropAppliedPlugins(['super'], [])).toEqual(['super']);
  });
});

describe('countAssistantItems', () => {
  it('counts unique items per kind for picker cards', () => {
    expect(
      countAssistantItems({
        enabled_skills: ['a', 'b'],
        custom_skill_names: ['b'],
        enabled_plugins: ['p1', 'p1', 'p2'],
        enabled_hooks: [HOOK_A],
      })
    ).toEqual({ skills: 2, plugins: 2, hooks: 1, tools: 0 });
  });
});
