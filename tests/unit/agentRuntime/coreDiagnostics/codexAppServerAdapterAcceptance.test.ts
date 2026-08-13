/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerAdapter } from '@process/experimentalCore/adapters/codexAppServerAdapter';
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
