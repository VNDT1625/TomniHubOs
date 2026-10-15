/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Plugin-path cost guard (2026-10-15). A context-mode-like plugin (one MCP server, 13 hooks, a package of skills)
 * must map and connect in bounded time, and the tool-result projection and redaction of the map text must stay
 * within a fixed budget on the main thread. Connect only records an activation; it starts nothing.
 */
import { describe, expect, it } from 'vitest';
import { buildCapabilityMap, packageCandidates, runPluginTool } from '@process/resources/builtinMcp/capabilityFallback';
import type { CapabilityCandidate } from '@process/services/chatPipeline/stages/capabilitySelect';
import { redactSecretText, redactSensitiveText } from '@process/agentRuntime/agentMesh/security';
import { projectHubToolTrace } from '@process/system/hubActivity/hubToolTrace';
import { projectHubOverviewActions } from '@process/system/hubActivity/hubToolOverview';

const SYNC_BUDGET_MS = 100;

const timed = <T>(work: () => T): { value: T; ms: number } => {
  const started = performance.now();
  const value = work();
  return { value, ms: performance.now() - started };
};

const contextModeFixture = (): CapabilityCandidate[] => {
  const longDescription = 'Context mode sandboxes large tool output and indexes it for search. '.repeat(8);
  const skills = Array.from({ length: 13 }, (_unused, index) => ({
    name: `context-mode-skill-${index}`,
    description: `${longDescription} skill ${index}`,
    packageId: 'context-mode',
    enabled: true,
  }));
  const hooks: CapabilityCandidate[] = Array.from({ length: 13 }, (_unused, index) => ({
    id: `hook:ctx-${index}`,
    kind: 'hook',
    name: 'context-mode',
    description: 'PreToolUse hook, matcher *',
    event: 'UserPromptSubmit',
    enabled: true,
    approved: true,
    runsCode: true,
  }));
  return [
    {
      id: 'mcp:ctx',
      kind: 'plugin',
      name: 'context-mode',
      description: longDescription,
      enabled: true,
      approved: true,
      runsCode: true,
    },
    ...packageCandidates(skills),
    ...Array.from({ length: 40 }, (_unused, index) => ({
      id: `skill:other-${index}`,
      kind: 'skill' as const,
      name: `other-${index}`,
      description: 'Ordinary skill description used to pad the catalog.',
      enabled: true,
      approved: true,
      runsCode: false,
    })),
    ...hooks,
  ];
};

describe('plugin path cost', () => {
  it('maps and connects a context-mode-like plugin in bounded time, with a bounded map', () => {
    const candidates = contextModeFixture();
    const map = timed(() => runPluginTool({ action: 'map' }, candidates, 'conv-1'));
    const connect = timed(() => runPluginTool({ action: 'connect', id: 'mcp:ctx' }, candidates, 'conv-1'));
    const pkg = timed(() => runPluginTool({ action: 'connect', id: 'package:context-mode' }, candidates, 'conv-1'));
    expect(map.ms).toBeLessThan(SYNC_BUDGET_MS);
    expect(connect.ms).toBeLessThan(SYNC_BUDGET_MS);
    expect(pkg.ms).toBeLessThan(SYNC_BUDGET_MS);
    expect(connect.value.text).toContain('Connected context-mode');
    expect(Buffer.byteLength(map.value.text)).toBeLessThanOrEqual(4_096);
  });

  it('redacts the map tool result within budget, including a pathological slash-heavy token', () => {
    const text = buildCapabilityMap(contextModeFixture()).text;
    const redacted = timed(() => redactSensitiveText(text.slice(0, 3_000)));
    const secret = timed(() => redactSecretText(text.slice(0, 3_000)));
    const pathological = 'a/b-c+d/e-f/'.repeat(400);
    const worst = timed(() => redactSensitiveText(pathological.slice(0, 3_000)));
    expect(redacted.ms).toBeLessThan(SYNC_BUDGET_MS);
    expect(secret.ms).toBeLessThan(SYNC_BUDGET_MS);
    expect(worst.ms).toBeLessThan(SYNC_BUDGET_MS);
  });

  it('projects a plugin tool trace and the step-bar overview within budget', () => {
    const text = buildCapabilityMap(contextModeFixture()).text;
    const trace = timed(() =>
      projectHubToolTrace({
        call_id: 'c1',
        name: 'plugin',
        status: 'Success',
        input: { action: 'map' },
        result_display: text,
      })
    );
    const overview = timed(() => projectHubOverviewActions(trace.value ? [trace.value] : []));
    expect(trace.ms).toBeLessThan(50);
    expect(overview.ms).toBeLessThan(50);
    expect(overview.value[0]?.label).toBe('Đã dùng plugin');
  });
});
