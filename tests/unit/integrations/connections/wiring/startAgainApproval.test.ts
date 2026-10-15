/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one-time start-again question at app start (wiring/startAgainApproval.ts). A legacy start-again connection stays off
 * until the person answers: one question per package and app run, Allow enables with the approval shown, Cancel or no answer
 * changes nothing, and "do not ask again" clears the start-again choice. The registry and the question are fakes here.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument, type AdapterConnection, type AdapterConnectionKind } from '@/common/packages/adapter';
import type { InstallApprovalRequest } from '@/common/types/platform/packageConnections';
import {
  createConnectionRegistry,
  NEEDS_APPROVAL_REASON,
  type ConnectionView,
} from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore, type InstalledConnectionState } from '@process/integrations/connections/core/state';
import { defineConnectionHost } from '@process/integrations/connections/core/types';
import { createInstallApprovalBroker } from '@process/integrations/connections/ipc/installApprovalBroker';
import { setPackageEnabled } from '@process/integrations/connections/wiring/packageSwitch';
import type {
  InstallActivationAnswer,
  InstallActivationRequest,
} from '@process/integrations/connections/wiring/installActivation';
import {
  createStartAgainRunner,
  scheduleStartAgainApprovals,
  setStartAgainRunner,
  type StartAgainDeps,
} from '@process/integrations/connections/wiring/startAgainApproval';

const PACKAGE = 'com.community.context-mode';
const OTHER = 'com.community.other';

afterEach(() => setStartAgainRunner(undefined));

const stateOf = (
  packageId: string,
  key: string,
  extra: Partial<InstalledConnectionState> = {}
): InstalledConnectionState => ({
  packageId,
  packageVersion: '1.0.169',
  connectionKey: key,
  enabled: false,
  status: 'off',
  ...extra,
});

const viewOf = (packageId: string, key: string, extra: Partial<InstalledConnectionState> = {}): ConnectionView => {
  const kind = key.split(':')[0] ?? '';
  return {
    key,
    connection: { kind, id: key.slice(kind.length + 1), title: key } as unknown as AdapterConnection,
    state: stateOf(packageId, key, extra),
  };
};

/** A code connection that a legacy record left behind: start-again on, no approval, marked by the sync. */
const waitingView = (packageId: string, key: string): ConnectionView =>
  viewOf(packageId, key, { autoStart: true, reason: NEEDS_APPROVAL_REASON });

type Calls = {
  asked: Array<{ request: InstallActivationRequest; packageName: string; prompt: string }>;
  enables: Array<{ packageId: string; key: string; approvalHash: string }>;
  autoStarts: Array<{ packageId: string; key: string; value: boolean }>;
};

/** Fake registry and fake question. `answer` is what the person gives; undefined means no answer (no window or timeout). */
const harness = (options: {
  views: Record<string, readonly ConnectionView[]>;
  answer?: InstallActivationAnswer;
  names?: Record<string, string>;
}) => {
  const calls: Calls = { asked: [], enables: [], autoStarts: [] };
  const registry: StartAgainDeps['registry'] = {
    view: async (packageId) => [...(options.views[packageId] ?? [])],
    describe: async (_packageId, key) => ({
      subject: { kind: 'mcp', title: key, lines: [{ label: 'Command', value: 'npx tool' }], files: [] },
      approvalHash: `sha256-${key}`,
    }),
    enable: async (packageId, key, approvalHash) => {
      calls.enables.push({ packageId, key, approvalHash });
      return stateOf(packageId, key, { enabled: true, status: 'on', approvalHash });
    },
    setAutoStart: async (packageId, key, value) => {
      calls.autoStarts.push({ packageId, key, value });
      return stateOf(packageId, key, { autoStart: value });
    },
  };
  const ask: StartAgainDeps['ask'] = async (request, packageName, prompt) => {
    calls.asked.push({ request, packageName, prompt });
    return options.answer;
  };
  const runner = createStartAgainRunner({
    registry,
    ask,
    packageName: async (packageId) => options.names?.[packageId],
  });
  return { calls, runner };
};

describe('the one-time start-again question', () => {
  it('asks once for a legacy start-again connection, with its name, and runs nothing before Allow', async () => {
    const h = harness({
      views: { [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs')] },
      answer: { approved: false, autoStart: false },
      names: { [PACKAGE]: 'Context Mode' },
    });

    await h.runner([PACKAGE]);

    expect(h.calls.asked).toHaveLength(1);
    expect(h.calls.asked[0]).toMatchObject({ packageName: 'Context Mode', prompt: 'start-again' });
    expect(h.calls.asked[0]?.request.packageId).toBe(PACKAGE);
    expect(h.calls.asked[0]?.request.items.map((item) => item.key)).toEqual(['mcp:docs']);
    expect(h.calls.enables).toEqual([]);
  });

  it('asks each package at most once per app run, however often startup asks', async () => {
    const h = harness({
      views: { [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs')] },
      answer: { approved: false, autoStart: false },
    });

    await h.runner([PACKAGE]);
    await h.runner([PACKAGE]);

    expect(h.calls.asked).toHaveLength(1);
  });

  it('Allow enables each waiting connection with the approval it was shown and keeps the start-again choice', async () => {
    const h = harness({
      views: { [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs'), waitingView(PACKAGE, 'hook:save')] },
      answer: { approved: true, autoStart: false },
    });

    await h.runner([PACKAGE]);

    expect(h.calls.enables).toEqual([
      { packageId: PACKAGE, key: 'mcp:docs', approvalHash: 'sha256-mcp:docs' },
      { packageId: PACKAGE, key: 'hook:save', approvalHash: 'sha256-hook:save' },
    ]);
    expect(h.calls.autoStarts).toEqual([]);
  });

  it.each([
    ['Cancel', { approved: false, autoStart: false } as InstallActivationAnswer],
    ['no answer in time or no window', undefined],
  ])('%s leaves every connection off and changes nothing', async (_label, answer) => {
    const h = harness({ views: { [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs')] }, answer });

    await h.runner([PACKAGE]);

    expect(h.calls.asked).toHaveLength(1);
    expect(h.calls.enables).toEqual([]);
    expect(h.calls.autoStarts).toEqual([]);
  });

  it('"do not ask again" clears the start-again choice of each waiting connection and enables nothing', async () => {
    const h = harness({
      views: { [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs'), waitingView(PACKAGE, 'hook:save')] },
      answer: { approved: false, autoStart: false, dismissed: true },
    });

    await h.runner([PACKAGE]);

    expect(h.calls.autoStarts).toEqual([
      { packageId: PACKAGE, key: 'mcp:docs', value: false },
      { packageId: PACKAGE, key: 'hook:save', value: false },
    ]);
    expect(h.calls.enables).toEqual([]);
  });

  it('asks nothing when no connection waits for the approval', async () => {
    const h = harness({
      views: {
        [PACKAGE]: [
          // On already: start-again with its approval.
          viewOf(PACKAGE, 'mcp:on', { enabled: true, status: 'on', autoStart: true, approvalHash: 'sha256-on' }),
          // Start-again with a kept approval: the registry starts it, nothing to ask.
          viewOf(PACKAGE, 'mcp:kept', { autoStart: true, approvalHash: 'sha256-kept' }),
          // A failing check: its own reason, not the approval question.
          viewOf(PACKAGE, 'hook:check', {
            autoStart: true,
            status: 'needs-input',
            reason: 'MCP runtime is not ready yet',
          }),
          // Data connections never wait for a start-again approval.
          waitingView(PACKAGE, 'skill:guide'),
        ],
      },
      answer: { approved: true, autoStart: false },
    });

    await h.runner([PACKAGE]);

    expect(h.calls.asked).toEqual([]);
    expect(h.calls.enables).toEqual([]);
  });

  it('asks one question per package, one after another', async () => {
    const h = harness({
      views: {
        [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs')],
        [OTHER]: [waitingView(OTHER, 'cli:tool')],
      },
      answer: { approved: false, autoStart: false },
    });

    await h.runner([PACKAGE, OTHER]);

    expect(h.calls.asked.map((item) => item.request.packageId)).toEqual([PACKAGE, OTHER]);
  });

  it('a package found before the runner is set is asked once the runner exists, and never twice', async () => {
    const h = harness({
      views: { [PACKAGE]: [waitingView(PACKAGE, 'mcp:docs')] },
      answer: { approved: false, autoStart: false },
    });

    scheduleStartAgainApprovals([PACKAGE]);
    expect(h.calls.asked).toHaveLength(0);
    setStartAgainRunner(h.runner);
    await vi.waitFor(() => expect(h.calls.asked).toHaveLength(1));

    // A repeated startup for the same package is not a second question, even after the first one settled.
    scheduleStartAgainApprovals([PACKAGE]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(h.calls.asked).toHaveLength(1);
  });
});

/**
 * A cancelled startup question must not lock the plugin: the whole-plugin switch in Settings (setPackageEnabled) still
 * enables it through the normal approval, with the real registry and broker.
 */
describe('a declined startup question keeps the plugin enable-able from Settings', () => {
  it.each(['cancel', 'dismiss', 'timeout'] as const)(
    'after %s at startup, setPackageEnabled(true) through the approval still enables it',
    async (outcome) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-start-again-'));
      try {
        const store = createJsonConnectionStateStore(path.join(dir, 'connections.json'));
        await store.initialize();
        await store.save({
          packageId: PACKAGE,
          packageVersion: '1.0.169',
          connectionKey: 'mcp:docs',
          enabled: false,
          status: 'off',
          autoStart: true,
          reason: NEEDS_APPROVAL_REASON,
        });
        const loaded = {
          packageId: PACKAGE,
          packageVersion: '1.0.169',
          packageDirectory: dir,
          adapter: parseAdapterDocument({
            schemaVersion: 1,
            generatedBy: 'classifier',
            connections: [
              { kind: 'mcp', id: 'docs', title: 'docs', transport: 'http', url: 'https://docs.example.com/mcp' },
            ],
          }),
        };
        const host = defineConnectionHost<AdapterConnectionKind>({
          kind: 'mcp',
          check: async () => ({ ok: true }),
          describe: async () => ({ kind: 'mcp', title: 'docs', lines: [{ label: 'Command', value: 'npx docs' }], files: [] }),
          enable: async () => ({ installed: ['docs'] }),
          disable: async () => undefined,
        });
        const registry = createConnectionRegistry({
          store,
          hosts: [host],
          loadPackage: async (id) => (id === PACKAGE ? loaded : undefined),
          listInstalledPackageIds: async () => [PACKAGE],
          now: () => 1_000,
        });

        // Both questions go to the same log. The startup one may time out at once; the Settings one keeps the default wait.
        const sent: InstallApprovalRequest[] = [];
        const send = (payload: InstallApprovalRequest): boolean => {
          sent.push(payload);
          return true;
        };
        const broker = createInstallApprovalBroker({
          send,
          ...(outcome === 'timeout' ? { timeoutMs: 5 } : {}),
        });
        const settings = createInstallApprovalBroker({ send });

        // 1. Startup: the one-time question, declined in the given way.
        const runner = createStartAgainRunner({
          registry,
          ask: (request, name, prompt) => broker.ask(request, name, prompt),
          packageName: async () => 'Context Mode',
        });
        const startup = runner([PACKAGE]);
        if (outcome !== 'timeout') {
          await vi.waitFor(() => expect(sent).toHaveLength(1));
          const decision = outcome === 'dismiss' ? 'dismiss' : 'cancel';
          expect(
            broker.respond({ requestId: sent[0]?.requestId ?? '', decision, autoStart: false, keys: sent[0]?.keys ?? [] })
          ).toBe(true);
        }
        await startup;
        expect(sent[0]).toMatchObject({ prompt: 'start-again' });

        // Nothing is locked: the connection is off, with no error, and not marked as blocked.
        const afterStartup = (await registry.view(PACKAGE)).find((view) => view.key === 'mcp:docs')?.state;
        expect(afterStartup).toMatchObject({ enabled: false, status: 'off' });
        expect(afterStartup?.lastError).toBeUndefined();

        // 2. Settings: the whole-plugin switch (same path as PluginsSettingsTab -> setPackageEnabled) asks normally.
        const enabling = setPackageEnabled(
          {
            registry,
            confirm: (request) =>
              settings.ask(request, 'Context Mode').then((answer) => answer ?? { approved: false, autoStart: false }),
          },
          PACKAGE,
          true
        );
        await vi.waitFor(() => expect(sent).toHaveLength(2));
        expect(sent[1]).toMatchObject({ prompt: 'install' });
        expect(
          settings.respond({
            requestId: sent[1]?.requestId ?? '',
            decision: 'approve',
            autoStart: false,
            keys: sent[1]?.keys ?? [],
          })
        ).toBe(true);
        const report = await enabling;

        expect(report.enabled).toEqual([expect.objectContaining({ key: 'mcp:docs', kind: 'mcp' })]);
        const enabled = (await registry.view(PACKAGE)).find((view) => view.key === 'mcp:docs')?.state;
        expect(enabled).toMatchObject({ enabled: true, status: 'on' });
        expect(enabled?.approvalHash).toMatch(/^sha256-/u);
        broker.dispose();
        settings.dispose();
      } finally {
        await rm(dir, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  );
});

