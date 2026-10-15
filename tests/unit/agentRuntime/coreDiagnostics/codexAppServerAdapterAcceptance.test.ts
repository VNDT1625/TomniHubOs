/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerAdapter } from '@process/experimentalCore/adapters/codexAppServerAdapter';
import { CORE_ADAPTER_DEFINITIONS, detectCoreTargets } from '@process/experimentalCore/coreRegistry';
import type { CoreAdapterEvent, CoreRunInput, DetectedCoreTarget } from '@process/experimentalCore/adapters';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/fake-codex-app-server/index.js');
const target: DetectedCoreTarget = {
  id: 'fake-codex-app-server',
  name: 'Fake Codex app-server',
  protocol: 'codex-app-server',
  candidates: [process.execPath],
  args: [fixturePath],
  detail: 'Deterministic stateless-thread fixture',
  runnable: true,
  detected: true,
  available: true,
  command: process.execPath,
};

const input = (prompt: string, events: CoreAdapterEvent[]): CoreRunInput => ({
  sessionId: 'same-logical-session',
  target,
  prompt,
  workspace: process.cwd(),
  modelKey: 'fake-model::medium',
  permissionMode: 'workspace-write',
  signal: new AbortController().signal,
  emit: (event) => events.push(event),
  requestPermission: vi.fn(async () => true),
});

const responseText = (events: CoreAdapterEvent[]): string =>
  events
    .filter((event) => event.type === 'delta')
    .map((event) => event.text)
    .join('');

describe('CodexAppServerAdapter stateless provider context', () => {
  let adapter: CodexAppServerAdapter | undefined;

  afterEach(async () => {
    await adapter?.dispose();
    adapter = undefined;
  });

    it.runIf(process.env.TOMNY_REAL_CODEX_SMOKE === '1')('discovers installed Codex app-server skills without running a model turn', async () => {
    adapter = new CodexAppServerAdapter();
    const definition = CORE_ADAPTER_DEFINITIONS.find((entry) => entry.id === 'codex')!;
    const targets = await detectCoreTargets(undefined, [definition]);
    const current = targets.find((entry) => entry.id === 'codex');
    expect(current?.available).toBe(true);
    const catalog = await adapter.listCommands(current!, process.cwd());
    console.info('[Real Codex skills discovery]', catalog.status, catalog.commands.length, catalog.commands.slice(0, 8).map((command) => command.name));
    expect(catalog.status).toBe('available');
  }, 60_000);

  it('reuses the process but starts a fresh thread for every run', async () => {
    adapter = new CodexAppServerAdapter();
    const firstEvents: CoreAdapterEvent[] = [];
    const secondEvents: CoreAdapterEvent[] = [];

    await adapter.run(input('SECRET_PRIOR_PROMPT', firstEvents));
    await adapter.run(input('CURRENT_PROMPT_ONLY', secondEvents));

    expect(responseText(firstEvents)).toContain('fake-thread-1: SECRET_PRIOR_PROMPT');
    expect(responseText(secondEvents)).toContain('fake-thread-2: CURRENT_PROMPT_ONLY');
    expect(responseText(secondEvents)).not.toContain('SECRET_PRIOR_PROMPT');
  });

    it('discovers real provider skills and routes the advertised /skill shortcut with a typed skill input', async () => {
    adapter = new CodexAppServerAdapter();
    const discovered = await adapter.listCommands(target, process.cwd());
    expect(discovered).toEqual({
      status: 'available',
      origin: 'codex-app-server',
      commands: [{ name: 'skill:code-review', description: 'Codex skill: Review code' }],
    });
    const events: CoreAdapterEvent[] = [];
    await adapter.run({ ...input('/skill:code-review examine this', events), persistentSession: true });
    const output = responseText(events);
    expect(output).toContain('$code-review examine this [SKILL_ITEM_VALID]');
  });

    it('refreshes Codex skills in response to an app-server skills/changed notification', async () => {
    adapter = new CodexAppServerAdapter();
    const updates: string[] = [];
    await adapter.listCommands(target, process.cwd(), 'chat-one', (value) => {
      updates.push(value.commands.map((command) => command.name).join(','));
    });
    await vi.waitFor(() => expect(updates).toContain('skill:code-review'));
    adapter.releaseCommands('chat-one');
  });

  it('retains only the opted-in Codex conversation thread and isolates another chat', async () => {
    adapter = new CodexAppServerAdapter();
    const first: CoreAdapterEvent[] = [];
    const second: CoreAdapterEvent[] = [];
    const other: CoreAdapterEvent[] = [];
    await adapter.run({ ...input('PRIOR_PRIVATE', first), persistentSession: true, sessionId: 'chat-A' });
    await adapter.run({ ...input('FOLLOW_UP', second), persistentSession: true, sessionId: 'chat-A' });
    await adapter.run({ ...input('OTHER_CONVERSATION', other), persistentSession: true, sessionId: 'chat-B' });
    expect(responseText(second)).toContain('PRIOR_PRIVATE | FOLLOW_UP');
    expect(responseText(other)).not.toContain('PRIOR_PRIVATE');
    adapter.releaseCommands('chat-A');
    const afterReset: CoreAdapterEvent[] = [];
    await adapter.run({ ...input('AFTER_RESET', afterReset), persistentSession: true, sessionId: 'chat-A' });
    expect(responseText(afterReset)).not.toContain('PRIOR_PRIVATE');
  });

  it('keeps the logical turn alive when the gateway temporarily has no active credentials', async () => {
    adapter = new CodexAppServerAdapter();
    const events: CoreAdapterEvent[] = [];

    await adapter.run(input('FAIL_ONCE_NO_ACTIVE_CREDENTIALS', events));

    expect(responseText(events)).toContain('fake-thread-2: FAIL_ONCE_NO_ACTIVE_CREDENTIALS');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'status', text: expect.stringContaining('temporarily unavailable') })
    );
  });
});
