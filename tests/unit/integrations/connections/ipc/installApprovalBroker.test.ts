import { describe, expect, it } from 'vitest';
import type { AdapterConnectionKind } from '@/common/packages/adapter';
import type { InstallApprovalRequest } from '@/common/types/platform/packageConnections';
import {
  createInstallApprovalBroker,
  INSTALL_APPROVAL_TIMEOUT_MS,
} from '@process/integrations/connections/ipc/installApprovalBroker';
import type { InstallActivationRequest } from '@process/integrations/connections/wiring/installActivation';

const request = (packageId = 'pkg.one', keys: readonly string[] = ['mcp:a', 'hook:b']): InstallActivationRequest => ({
  packageId,
  items: keys.map((key) => ({
    key,
    kind: key.split(':')[0] as AdapterConnectionKind,
    subject: { kind: 'mcp', title: key, lines: [{ label: 'Command', value: 'npx tool' }], files: [] },
  })),
});

const setup = (options: { sends?: boolean; timeoutMs?: number } = {}) => {
  const sent: InstallApprovalRequest[] = [];
  const broker = createInstallApprovalBroker({
    send: (payload) => {
      sent.push(payload);
      return options.sends ?? true;
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { broker, sent };
};

const answer = (requestId: string, keys: readonly string[], extra: Record<string, unknown> = {}) => ({
  requestId,
  decision: 'approve',
  autoStart: false,
  keys,
  ...extra,
});

describe('the in-app install approval', () => {
  it('sends the request to the window and resolves with the approval the renderer gives for the exact keys', async () => {
    const { broker, sent } = setup();
    const pending = broker.ask(request(), 'Pkg One');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ packageId: 'pkg.one', packageName: 'Pkg One', keys: ['mcp:a', 'hook:b'] });
    const requestId = sent[0]?.requestId ?? '';
    expect(broker.respond(answer(requestId, ['hook:b', 'mcp:a'], { autoStart: true }))).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true, autoStart: true });
  });

  it('refuses an answer whose key set differs from the one Main sent, and keeps the request open', async () => {
    const { broker, sent } = setup({ timeoutMs: 20 });
    const pending = broker.ask(request(), 'Pkg');
    const requestId = sent[0]?.requestId ?? '';
    expect(broker.respond(answer(requestId, ['mcp:a']))).toBe(false);
    expect(broker.respond(answer(requestId, ['mcp:a', 'hook:b', 'mcp:extra']))).toBe(false);
    expect(broker.respond(answer(requestId, ['mcp:a', 'mcp:a']))).toBe(false);
    // Nothing was approved, so the request times out as Cancel.
    await expect(pending).resolves.toEqual({ approved: false, autoStart: false });
  });

  it('refuses an unknown request id and any field the contract does not have', () => {
    const { broker, sent } = setup();
    void broker.ask(request(), 'Pkg');
    const requestId = sent[0]?.requestId ?? '';
    expect(broker.respond(answer('00000000-0000-4000-8000-000000000000', ['mcp:a', 'hook:b']))).toBe(false);
    expect(broker.respond(answer(requestId, ['mcp:a', 'hook:b'], { approved: true }))).toBe(false);
    expect(broker.respond({ requestId, decision: 'maybe', autoStart: false, keys: ['mcp:a', 'hook:b'] })).toBe(false);
    expect(broker.respond(null)).toBe(false);
    broker.dispose();
  });

  it('treats a cancel as no approval, even with the start-again box ticked', async () => {
    const { broker, sent } = setup();
    const pending = broker.ask(request(), 'Pkg');
    const requestId = sent[0]?.requestId ?? '';
    expect(broker.respond(answer(requestId, ['mcp:a', 'hook:b'], { decision: 'cancel', autoStart: true }))).toBe(true);
    await expect(pending).resolves.toEqual({ approved: false, autoStart: false });
  });

  it('allows one pending request per package: a second one for the same package is cancelled at once', async () => {
    const { broker, sent } = setup();
    const first = broker.ask(request('pkg.one'), 'Pkg');
    await expect(broker.ask(request('pkg.one', ['mcp:z']), 'Pkg')).resolves.toEqual({
      approved: false,
      autoStart: false,
    });
    expect(sent).toHaveLength(1);
    const other = broker.ask(request('pkg.two', ['mcp:y']), 'Other');
    expect(sent).toHaveLength(2);
    broker.dispose();
    await expect(first).resolves.toEqual({ approved: false, autoStart: false });
    await expect(other).resolves.toEqual({ approved: false, autoStart: false });
  });

  it('cancels when nobody answers in time', async () => {
    const { broker } = setup({ timeoutMs: 10 });
    await expect(broker.ask(request(), 'Pkg')).resolves.toEqual({ approved: false, autoStart: false });
    expect(INSTALL_APPROVAL_TIMEOUT_MS).toBe(300_000);
  });

  it('reports no answer at all when no window can show the request, so the caller can use the native dialog', async () => {
    const { broker } = setup({ sends: false });
    await expect(broker.ask(request(), 'Pkg')).resolves.toBeUndefined();
    // The failed request is gone, so the package is not left blocked.
    await expect(broker.ask(request(), 'Pkg')).resolves.toBeUndefined();
  });

  it('lists the requests still waiting, so a reloaded window can show them again and answer them', async () => {
    const { broker, sent } = setup();
    const pending = broker.ask(request(), 'Pkg One');
    // The window was reloaded: the old one received the request, the new one asks for what is still waiting.
    const listed = broker.pending();
    expect(listed).toEqual([sent[0]]);
    const requestId = listed[0]?.requestId ?? '';
    expect(broker.respond(answer(requestId, ['mcp:a', 'hook:b']))).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true, autoStart: false });
    expect(broker.pending()).toEqual([]);
    broker.dispose();
  });

  it('offers "do not ask again" only on the start-again question, which answers it as dismissed', async () => {
    const { broker, sent } = setup();
    const install = broker.ask(request(), 'Pkg');
    expect(sent[0]).toMatchObject({ prompt: 'install' });
    const installId = sent[0]?.requestId ?? '';
    expect(
      broker.respond({ requestId: installId, decision: 'dismiss', autoStart: false, keys: ['mcp:a', 'hook:b'] })
    ).toBe(false);
    expect(broker.respond(answer(installId, ['mcp:a', 'hook:b']))).toBe(true);
    await expect(install).resolves.toEqual({ approved: true, autoStart: false });

    const again = broker.ask(request('pkg.one', ['mcp:a']), 'Pkg', 'start-again');
    expect(sent[1]).toMatchObject({ prompt: 'start-again', keys: ['mcp:a'] });
    const againId = sent[1]?.requestId ?? '';
    expect(broker.respond({ requestId: againId, decision: 'dismiss', autoStart: true, keys: ['mcp:a'] })).toBe(true);
    await expect(again).resolves.toEqual({ approved: false, autoStart: false, dismissed: true });
    broker.dispose();
  });
});
