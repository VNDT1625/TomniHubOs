/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpCoreAdapter, parseAcpCommands } from '@process/experimentalCore/adapters/acpCoreAdapter';
import { evaluateAcpCompatibility } from '@process/experimentalCore/adapters/acpCompatibility';
import type { CoreAdapterEvent, CoreRunInput, DetectedCoreTarget } from '@process/experimentalCore/adapters';
import { CORE_ADAPTER_DEFINITIONS, detectCoreTargets } from '@process/experimentalCore/coreRegistry';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/fake-acp-cli/index.js');
const acpDefinitions = CORE_ADAPTER_DEFINITIONS.filter((definition) => definition.protocol === 'acp');
const activeAdapters = new Set<AcpCoreAdapter>();

const fixtureTarget = (definition: (typeof acpDefinitions)[number], scenario = 'happy'): DetectedCoreTarget => ({
  ...definition,
  command: process.execPath,
  args: [fixturePath, scenario],
  detected: true,
  available: true,
});

const runInput = (
  target: DetectedCoreTarget,
  events: CoreAdapterEvent[],
  controller = new AbortController()
): CoreRunInput => ({
  sessionId: `acceptance-${target.id}`,
  target,
  prompt: 'hello fixture',
  workspace: process.cwd(),
  permissionMode: 'workspace-write',
  signal: controller.signal,
  emit: (event) => events.push(event),
  requestPermission: vi.fn(async () => true),
});

const createAdapter = (): AcpCoreAdapter => {
  const adapter = new AcpCoreAdapter();
  activeAdapters.add(adapter);
  return adapter;
};

afterEach(async () => {
  await Promise.all([...activeAdapters].map((adapter) => adapter.dispose()));
  activeAdapters.clear();
});

describe('declared ACP target acceptance', () => {
  it.runIf(process.env.TOMNY_REAL_ACP_SMOKE === '1')('probes installed ACP CLIs without issuing a model prompt', async () => {
    const adapter = createAdapter();
    const definitions = acpDefinitions.filter((item) => ['claude', 'gemini', 'opencode'].includes(item.id));
    const targets = await detectCoreTargets(undefined, definitions);
        const results = await Promise.all(targets.map(async (target) => {
      if (!target.available) return { id: target.id, status: 'not-installed', count: 0, sample: [] as string[], hasCompact: false };
            await adapter.listCommands(target, process.cwd(), `smoke-${target.id}`);
      // Real ACP agents may publish their catalog asynchronously after session/new.
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      const catalog = await adapter.listCommands(target, process.cwd(), `smoke-${target.id}`);
      return {
        id: target.id,
        status: catalog.status,
        count: catalog.commands.length,
        sample: catalog.commands.slice(0, 8).map((c) => c.name),
        hasCompact: catalog.commands.some((c) => c.name === 'compact'),
      };
    }));
    console.info('[Real ACP command discovery]', JSON.stringify(results));
    expect(results.some((item) => item.status === 'available')).toBe(true);
  }, 90_000);

  it.each(acpDefinitions)(
    '$id completes handshake, model discovery and streamed text using the generic contract',
    async (definition) => {
      const adapter = createAdapter();
      const target = fixtureTarget(definition);
      const events: CoreAdapterEvent[] = [];

      await expect(adapter.listModels(target, process.cwd())).resolves.toEqual([
        { key: 'fake-model-1', modelId: 'fake-model-1', label: 'Fake Model', isDefault: true },
      ]);
      await expect(adapter.run(runInput(target, events))).resolves.toBeUndefined();
      expect(
        events
          .filter((event) => event.type === 'delta')
          .map((event) => event.text)
          .join('')
      ).toBe('Fake response to: hello fixture');
    }
  );

    it('discovers provider-declared commands without sending a prompt or inventing compatibility', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0]);
    const discovered = await adapter.listCommands(target, process.cwd());
    expect(discovered).toEqual({
      status: 'available',
      commands: [
        { name: 'compact', description: 'Compact provider context' },
        { name: 'project:review', description: 'Review the current project' },
      ],
    });
    await expect(adapter.listCommands(target, process.cwd())).resolves.toEqual(discovered);
  });

    it('receives idle command updates without prompting and treats [] as a full catalog reset', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'idle-commands');
    const updates: Array<{ status: string; commands: readonly { name: string }[] }> = [];
    const initial = await adapter.listCommands(target, process.cwd(), 'chat-one', (catalog) => updates.push(catalog));
    expect(initial).toEqual({ status: 'unsupported', commands: [] });

    await vi.waitFor(() => {
      expect(updates.some((catalog) => catalog.commands.some((item) => item.name === 'idle-1'))).toBe(true);
    });
    await vi.waitFor(() => {
      expect(updates.at(-1)).toEqual({ status: 'available', commands: [] });
    });
    await expect(adapter.listCommands(target, process.cwd(), 'chat-one')).resolves.toEqual({
      status: 'available',
      commands: [],
    });
  });

  it('keeps command updates scoped to the ACP session that published them', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'idle-commands');
    const first: string[] = [];
    const second: string[] = [];
    await adapter.listCommands(target, process.cwd(), 'conversation-A', (value) => first.push(value.commands.map((c) => c.name).join(',')));
    await adapter.listCommands(target, process.cwd(), 'conversation-B', (value) => second.push(value.commands.map((c) => c.name).join(',')));
    await vi.waitFor(() => {
      expect(first).toContain('idle-1');
      expect(second).toContain('idle-2');
    });
    expect(first).not.toContain('idle-2');
    expect(second).not.toContain('idle-1');
  });

    it('does not confuse equal provider session IDs from different ACP CLI processes', async () => {
    const adapter = createAdapter();
    const targetWithUpdates = fixtureTarget(acpDefinitions[0], 'idle-commands');
    const otherTarget = fixtureTarget(acpDefinitions[1], 'degraded');
    const updates: string[] = [];
    const otherUpdates: string[] = [];
    await adapter.listCommands(targetWithUpdates, process.cwd(), 'first', (catalog) => updates.push(catalog.commands.map((c) => c.name).join(',')));
    await adapter.listCommands(otherTarget, process.cwd(), 'second', (catalog) => otherUpdates.push(catalog.commands.map((c) => c.name).join(',')));
    await vi.waitFor(() => expect(updates).toContain('idle-1'));
    expect(otherUpdates).toEqual(['']);
  });

  it('refreshes the logical chat catalog from notifications during an actual run', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'live-commands');
    const catalogs: Array<{ status: string; commands: readonly { name: string }[] }> = [];
    await adapter.listCommands(target, process.cwd(), 'chat-running', (catalog) => catalogs.push(catalog));
    await adapter.run({ ...runInput(target, []), sessionId: 'chat-running' });
    await vi.waitFor(() => {
      expect(catalogs.at(-1)?.commands.map((c) => c.name)).toEqual(['live-command']);
    });
    await expect(adapter.listCommands(target, process.cwd(), 'chat-running')).resolves.toEqual({
      status: 'available',
      commands: [{ name: 'live-command', description: 'Advertised during a running turn' }],
    });
  });

    it('distinguishes a provider login requirement from an absent slash-command catalog', async () => {
    const adapter = createAdapter();
    await expect(adapter.listCommands(fixtureTarget(acpDefinitions[0], 'auth-required'), process.cwd())).resolves.toEqual({
      status: 'authentication-required', commands: [],
    });
  });

  it('reports unsupported when an ACP session does not advertise commands', async () => {
    const adapter = createAdapter();
    await expect(adapter.listCommands(fixtureTarget(acpDefinitions[0], 'degraded'), process.cwd())).resolves.toEqual({
      status: 'unsupported',
      commands: [],
    });
  });

  it('sanitizes malicious and duplicate command metadata from an untrusted ACP response', () => {
    expect(parseAcpCommands([
      { name: '/compact', description: 'first' },
      { name: 'compact', description: 'duplicate' },
      { name: '../../escape', description: 'unsafe' },
      { name: 'run\nscript', description: 'unsafe' },
      { name: 'project:review', description: 'ok' },
      null,
    ])).toEqual({
      status: 'available',
      commands: [
        { name: 'compact', description: 'first' },
        { name: 'project:review', description: 'ok' },
      ],
    });
    expect(parseAcpCommands(undefined)).toEqual({ status: 'unsupported', commands: [] });
  });

    it('keeps native commands after the first 128 large-catalog entries, with bounded metadata', () => {
    const entries = Array.from({ length: 500 }, (_, index) => ({
      name: `plugin-command-${index}`,
      description: 'x'.repeat(500),
    }));
    entries.push({ name: 'compact', description: 'Provider built-in at the end' });
    const parsed = parseAcpCommands(entries);
    expect(parsed.status).toBe('available');
    expect(parsed.commands).toHaveLength(501);
    expect(parsed.commands.at(-1)?.name).toBe('compact');
    expect(parsed.commands[0].description).toHaveLength(300);
  });

  it('preserves a tool lifecycle without reporting an in-progress update as a result', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'tool');
    const events: CoreAdapterEvent[] = [];

    await adapter.run(runInput(target, events));

    expect(events.filter((event) => event.type === 'tool-call')).toEqual([
      {
        type: 'tool-call',
        tool: 'Read fixture file',
        callId: 'fixture-tool-1',
        text: 'Read fixture file',
        phase: 'requested',
        input: { path: 'fixture.txt' },
      },
      {
        type: 'tool-call',
        tool: 'Read fixture file',
        callId: 'fixture-tool-1',
        text: 'Read fixture file',
        phase: 'running',
      },
    ]);
    expect(events.filter((event) => event.type === 'tool-result')).toEqual([
      {
        type: 'tool-result',
        tool: 'Read fixture file',
        callId: 'fixture-tool-1',
        text: 'Read fixture file',
        outcome: 'success',
      },
    ]);
  });

  it('uses a fresh provider session for every run so earlier prompts never reach the next turn', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'history');
    const firstEvents: CoreAdapterEvent[] = [];
    const secondEvents: CoreAdapterEvent[] = [];

    await adapter.run({ ...runInput(target, firstEvents), prompt: 'SECRET_PRIOR_PROMPT' });
    await adapter.run({ ...runInput(target, secondEvents), prompt: 'CURRENT_PROMPT_ONLY' });

    const firstText = firstEvents
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    const secondText = secondEvents
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    expect(firstText).toContain('fake-session-1: SECRET_PRIOR_PROMPT');
    expect(secondText).toContain('fake-session-2: CURRENT_PROMPT_ONLY');
    expect(secondText).not.toContain('SECRET_PRIOR_PROMPT');
  });

    it('retains conversation history in an opted-in ACP session without sharing it with another chat', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'history');
    const first: CoreAdapterEvent[] = [];
    const second: CoreAdapterEvent[] = [];
    const other: CoreAdapterEvent[] = [];
    await adapter.run({ ...runInput(target, first), persistentSession: true, sessionId: 'chat-A', prompt: 'PREVIOUS_PRIVATE_TURN' });
    await adapter.run({ ...runInput(target, second), persistentSession: true, sessionId: 'chat-A', prompt: '/compact' });
    await adapter.run({ ...runInput(target, other), persistentSession: true, sessionId: 'chat-B', prompt: 'OTHER_CHAT' });
    const delta = (events: CoreAdapterEvent[]) => events.filter((event) => event.type === 'delta').map((event) => event.text).join('');
    expect(delta(second)).toContain('PREVIOUS_PRIVATE_TURN | /compact');
    expect(delta(other)).toContain('OTHER_CHAT');
    expect(delta(other)).not.toContain('PREVIOUS_PRIVATE_TURN');
  });

  it('starts fresh after a conversation reset instead of retaining its old provider state', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'history');
    await adapter.run({ ...runInput(target, []), persistentSession: true, sessionId: 'chat-reset', prompt: 'PRIVATE_OLD' });
    adapter.releaseCommands('chat-reset');
    const output: CoreAdapterEvent[] = [];
    await adapter.run({ ...runInput(target, output), persistentSession: true, sessionId: 'chat-reset', prompt: 'FRESH_TURN' });
    const text = output.filter((event) => event.type === 'delta').map((event) => event.text).join('');
    expect(text).toContain('FRESH_TURN');
    expect(text).not.toContain('PRIVATE_OLD');
  });

  it('cancels a pending ACP prompt when the caller aborts', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'cancel');
    const controller = new AbortController();
    const pending = adapter.run(runInput(target, [], controller));

    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(/cancel/i);
  });

  it('retries a transient prompt failure while keeping one logical turn', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'retry');
    const events: CoreAdapterEvent[] = [];

    await expect(adapter.run(runInput(target, events))).resolves.toBeUndefined();

    expect(events).toContainEqual({ type: 'delta', text: '', mode: 'replace' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', text: expect.stringContaining('Retry') }));
    expect(
      events
        .filter((event) => event.type === 'delta')
        .map((event) => event.text)
        .join('')
    ).toContain('Fake response to: hello fixture');
  });

  it('accepts a capability-degraded ACP agent while exposing no guessed model', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'degraded');
    const events: CoreAdapterEvent[] = [];

    await expect(adapter.listModels(target, process.cwd())).resolves.toEqual([]);
    await expect(adapter.run(runInput(target, events))).resolves.toBeUndefined();
    expect(
      evaluateAcpCompatibility(
        { protocolVersion: 1, agentCapabilities: {} },
        { required: ['text'], preferred: ['image', 'model-selection'] },
        [1]
      ).status
    ).toBe('degraded');
  });

  it('rejects an incompatible handshake before creating a session', async () => {
    const adapter = createAdapter();
    const target = fixtureTarget(acpDefinitions[0], 'incompatible');

    await expect(adapter.run(runInput(target, []))).rejects.toThrow(/protocol version/i);
  });
});
