/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_DEFAULT_TOOL_LIMITS,
  defaultToolId,
  estimateToolSchemaBytes,
  isDefaultToolId,
  planDefaultTools,
  sanitizeDefaultToolIds,
  type DefaultToolCandidate,
} from '@/common/types/agent/assistant/assistantDefaultTools';
import { buildDefaultToolCandidates } from '@/common/types/agent/assistant/defaultToolCandidates';
import { parseCreateAssistantRequest } from '@/common/types/agent/assistant/assistantSchema';
import { planAssistantSession } from '@/common/types/agent/assistant/assistantSessionSelection';
import type { IMcpServer } from '@/common/config/storage';

const candidate = (overrides: Partial<DefaultToolCandidate> & { id: string }): DefaultToolCandidate => ({
  name: overrides.id.split('::')[1] ?? 'tool',
  serverId: overrides.id.split('::')[0] ?? 'server',
  serverName: 'Server',
  schemaBytes: 100,
  serverEnabled: true,
  approved: true,
  ...overrides,
});

describe('default tool ids', () => {
  it('builds and validates <serverId>::<toolName> ids', () => {
    expect(defaultToolId('srv-1', 'search_web')).toBe('srv-1::search_web');
    expect(isDefaultToolId('srv-1::search_web')).toBe(true);
    expect(isDefaultToolId('no separator')).toBe(false);
    expect(isDefaultToolId('srv::bad name')).toBe(false);
  });

  it('drops malformed and duplicate ids on sanitize, keeping first-seen order', () => {
    expect(sanitizeDefaultToolIds(['b::x', 'a::y', 'b::x', 42, 'bad id'])).toEqual(['b::x', 'a::y']);
    expect(sanitizeDefaultToolIds(undefined)).toEqual([]);
  });

  it('estimates schema size from name, description and input schema', () => {
    const bytes = estimateToolSchemaBytes({ name: 't', description: 'd', input_schema: { type: 'object' } });
    expect(bytes).toBe(JSON.stringify({ name: 't', description: 'd', input_schema: { type: 'object' } }).length);
  });
});

describe('planDefaultTools', () => {
  it('attaches only tools whose server is enabled and approved', () => {
    const plan = planDefaultTools(
      ['on::a', 'off::b', 'unapproved::c', 'missing::d'],
      [
        candidate({ id: 'on::a' }),
        candidate({ id: 'off::b', serverEnabled: false }),
        candidate({ id: 'unapproved::c', approved: false }),
      ]
    );
    expect(plan.toolIds).toEqual(['on::a']);
    expect(plan.notices).toEqual([
      { kind: 'tool', id: 'off::b', reason: 'not-enabled' },
      { kind: 'tool', id: 'unapproved::c', reason: 'not-approved' },
      { kind: 'tool', id: 'missing::d', reason: 'not-installed' },
    ]);
  });

  it('never enables anything: a disabled server stays out even when it is the only tool', () => {
    const plan = planDefaultTools(['srv::x'], [candidate({ id: 'srv::x', serverEnabled: false })]);
    expect(plan.toolIds).toEqual([]);
    expect(plan.notices[0]?.reason).toBe('not-enabled');
  });

  it('caps the count at the tool limit and reports the rest as over-limit', () => {
    const many = Array.from({ length: ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools + 3 }, (_, i) =>
      candidate({ id: `srv::t${i}`, schemaBytes: 10 })
    );
    const plan = planDefaultTools(
      many.map((item) => item.id),
      many
    );
    expect(plan.toolIds).toHaveLength(ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools);
    expect(plan.notices.filter((notice) => notice.reason === 'over-limit')).toHaveLength(3);
  });

  it('caps the schema bytes at the byte limit', () => {
    const half = Math.floor(ASSISTANT_DEFAULT_TOOL_LIMITS.maxSchemaBytes / 2) + 1;
    const plan = planDefaultTools(
      ['srv::a', 'srv::b'],
      [candidate({ id: 'srv::a', schemaBytes: half }), candidate({ id: 'srv::b', schemaBytes: half })]
    );
    expect(plan.toolIds).toEqual(['srv::a']);
    expect(plan.notices).toEqual([{ kind: 'tool', id: 'srv::b', reason: 'over-limit' }]);
    expect(plan.schemaBytes).toBe(half);
  });
});

describe('buildDefaultToolCandidates', () => {
  const server = (overrides: Partial<IMcpServer>): IMcpServer =>
    ({
      id: 'srv',
      name: 'Search',
      enabled: true,
      transport: { type: 'stdio', command: 'x' },
      created_at: 0,
      updated_at: 0,
      original_json: '{}',
      tools: [{ name: 'find', description: 'Find things', input_schema: { type: 'object' } }],
      ...overrides,
    }) as IMcpServer;

  it('marks built-in and connected servers as approved and reports the schema size', () => {
    const [connected] = buildDefaultToolCandidates([server({ last_test_status: 'connected' })]);
    expect(connected).toMatchObject({ id: 'srv::find', serverEnabled: true, approved: true });
    expect(connected?.schemaBytes).toBeGreaterThan(0);
    const [untested] = buildDefaultToolCandidates([server({ last_test_status: 'error' })]);
    expect(untested?.approved).toBe(false);
    const [builtin] = buildDefaultToolCandidates([server({ builtin: true, enabled: false })]);
    expect(builtin).toMatchObject({ approved: true, serverEnabled: false });
  });
});

describe('assistant schema and session plan with default_tools', () => {
  it('accepts a list of valid ids and rejects malformed ids and oversize lists', () => {
    expect(parseCreateAssistantRequest({ name: 'A', default_tools: ['srv::find'] }).default_tools).toEqual([
      'srv::find',
    ]);
    expect(() => parseCreateAssistantRequest({ name: 'A', default_tools: ['not an id'] })).toThrow();
    const tooMany = Array.from({ length: ASSISTANT_DEFAULT_TOOL_LIMITS.maxTools + 1 }, (_, i) => `s::t${i}`);
    expect(() => parseCreateAssistantRequest({ name: 'A', default_tools: tooMany })).toThrow();
  });

  it('plans the default tools next to skills and plugins and reports them as notices', () => {
    const plan = planAssistantSession(
      {
        enabled_skills: [],
        custom_skill_names: [],
        enabled_plugins: [],
        enabled_hooks: [],
        default_tools: ['srv::find', 'srv::off'],
      },
      {
        skillNames: [],
        plugins: [],
        activeHookIds: [],
        tools: [candidate({ id: 'srv::find' }), candidate({ id: 'srv::off', serverEnabled: false })],
      }
    );
    expect(plan.toolIds).toEqual(['srv::find']);
    expect(plan.notices).toContainEqual({ kind: 'tool', id: 'srv::off', reason: 'not-enabled' });
  });
});
