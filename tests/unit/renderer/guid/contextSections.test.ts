import { describe, expect, it } from 'vitest';
import type { SessionContextSnapshot, TomnyAgenticContextSnapshot } from '@/common';
import { buildContextOverview, estimateTokens } from '@/renderer/pages/guid/HubHome/memory/contextSections';

const tool = (name: string) => ({
  name,
  description: `${name} tool`,
  input_schema: { type: 'object' },
  deferred: false,
});

const native = (overrides: Partial<TomnyAgenticContextSnapshot> = {}): TomnyAgenticContextSnapshot => ({
  model: 'tomny-test',
  system: 'SYSTEM PROMPT '.repeat(10),
  messages: [],
  tools: [tool('ide_read')],
  core_context: {
    agent: 'Name: Tomny\nIdentity: project agent',
    personal: 'Preferred language: Vietnamese',
    control_tools: [tool('StartAction')],
    history: [],
    saved_memory: '## Save\nPINNED-FACT',
  },
  max_tokens: 0,
  thinking: null,
  custom_context: 'Answer briefly',
  context_branches: [{ id: 'b1', title: 'Release', summary: 'Release notes', content: 'Keep the shared send seam.' }],
  active_context_branch_ids: ['b1'],
  working_memory: { goal: 'Inspect the project' },
  full_message_count: 4,
  tool_cache: {},
  session_experience: { capability_summary: 'Project read and search.' },
  token_estimate: { system: 0, messages: 0, tools: 0, core: 0, total: 0 },
  ...overrides,
});

const snapshot = (inspection: SessionContextSnapshot['inspection']): SessionContextSnapshot => ({
  conversation_id: 'c1',
  model: 'tomny-test',
  target: 'tomny',
  app: {
    custom_context: 'Answer briefly',
    context_branches: [{ id: 'b1', title: 'Release', summary: 'Release notes', content: 'Keep the shared send seam.' }],
    rendered_conversation_context: 'x',
    saved_memory_context: '## Save\nPINNED-FACT',
    token_estimate: { conversation_context: 0, saved_memory: 0, total: 0 },
    minimum_next_turn_tokens: 0,
  },
  archive: { message_count: 4, token_estimate: 120 },
  inspection,
});

describe('buildContextOverview', () => {
  it('lists every block of a native run with its own token estimate and an exact total', () => {
    const data = native();
    const overview = buildContextOverview(snapshot({ kind: 'native', snapshot: data }));

    expect(overview.native).toBe(true);
    expect(overview.sections.map((section) => section.id)).toEqual([
      'system',
      'agent',
      'personal',
      'notes',
      'custom',
      'branches',
      'controlTools',
      'tools',
      'workingMemory',
      'capabilities',
    ]);
    const byId = Object.fromEntries(overview.sections.map((section) => [section.id, section]));
    expect(byId.system.tokens).toBe(estimateTokens(data.system));
    expect(byId.agent.text).toBe('Name: Tomny\nIdentity: project agent');
    expect(byId.personal.tokens).toBe(estimateTokens('Preferred language: Vietnamese'));
    expect(byId.notes.text).toContain('PINNED-FACT');
    expect(byId.custom.text).toBe('Answer briefly');
    expect(byId.capabilities.text).toBe('Project read and search.');
    expect(overview.totalTokens).toBe(overview.sections.reduce((sum, section) => sum + section.tokens, 0));
    expect(overview.archive).toEqual({ messages: 4, tokens: 120 });
  });

  it('renders branches with their title and summary and counts them', () => {
    const overview = buildContextOverview(snapshot({ kind: 'native', snapshot: native() }));
    const branches = overview.sections.find((section) => section.id === 'branches');
    expect(branches?.count).toBe(1);
    expect(branches?.text).toContain('### Release');
    expect(branches?.text).toContain('Summary: Release notes');
    expect(branches?.text).toContain('Keep the shared send seam.');
  });

  it('shows tool schemas as readable JSON and counts them', () => {
    const overview = buildContextOverview(snapshot({ kind: 'native', snapshot: native() }));
    const tools = overview.sections.find((section) => section.id === 'tools');
    const control = overview.sections.find((section) => section.id === 'controlTools');
    expect(tools?.count).toBe(1);
    expect(JSON.parse(tools?.text ?? '[]')).toEqual([tool('ide_read')]);
    expect(control?.count).toBe(1);
    expect(control?.tokens).toBe(estimateTokens(JSON.stringify([tool('StartAction')])));
  });

  it('keeps empty blocks visible with zero tokens instead of hiding them', () => {
    const data = native({
      core_context: { agent: '', personal: '', control_tools: [], history: [] },
      working_memory: {},
      session_experience: {},
      tools: [],
      custom_context: '',
      context_branches: [],
    });
    const overview = buildContextOverview(snapshot({ kind: 'native', snapshot: data }));
    for (const id of ['agent', 'personal', 'workingMemory', 'capabilities', 'tools', 'controlTools', 'branches']) {
      const section = overview.sections.find((item) => item.id === id);
      expect(section, id).toBeDefined();
      expect(section?.tokens, id).toBe(0);
      expect(section?.text, id).toBe('');
    }
  });

  it('describes only the app-owned blocks for another agent and passes on the runtime disclosure', () => {
    const overview = buildContextOverview(
      snapshot({ kind: 'app-only', disclosure: 'The selected runtime may add private history.' })
    );
    expect(overview.native).toBe(false);
    expect(overview.sections.map((section) => section.id)).toEqual(['notes', 'custom', 'branches']);
    expect(overview.runtimeDisclosure).toBe('The selected runtime may add private history.');
    expect(overview.totalTokens).toBe(overview.sections.reduce((sum, section) => sum + section.tokens, 0));
  });
});
