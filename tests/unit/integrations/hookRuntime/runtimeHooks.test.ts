import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryPermissionRepository, PermissionStore } from '@process/services/agentChat/permission';
import type {
  CoreAdapter,
  CoreAdapterProtocol,
  CoreRunInput,
  DetectedCoreTarget,
} from '@process/experimentalCore/adapters/coreAdapter';
import { ExperimentalCoreRuntime, type ExperimentalCoreEvent } from '@process/experimentalCore/experimentalCoreRuntime';
import { configureHookRuntime, queuedHookContextSessions } from '@process/integrations/hookRuntime/hookDispatcher';
import { createHookWorld, hookAnswer, readRecords, type HookWorld } from './hookTestKit';

/**
 * ExperimentalCoreRuntime with fake adapters and REAL hook processes (design 17.2): PreToolUse blocking
 * (native gate and permission-request path), PostToolUse, the Stop loop and context hand-over between turns.
 */

const targetFor = (id: string, protocol: CoreAdapterProtocol): DetectedCoreTarget => ({
  id,
  name: id,
  protocol,
  candidates: [id],
  args: [],
  detail: 'fake',
  runnable: true,
  detected: true,
  available: true,
  command: `${id}.exe`,
});

type Rig = {
  runtime: ExperimentalCoreRuntime;
  events: ExperimentalCoreEvent[];
  adapter: CoreAdapter & { run: ReturnType<typeof vi.fn> };
  permissionStore: PermissionStore;
};

let world: HookWorld;
let counter = 0;

beforeEach(async () => {
  world = await createHookWorld();
  configureHookRuntime({ registry: async () => world.registry });
});

afterEach(() => {
  configureHookRuntime();
});

const record = (name: string): string => `${world.dir}/${name}.jsonl`;

const makeRig = async (
  protocol: CoreAdapterProtocol,
  behaviour: (input: CoreRunInput, turn: number) => Promise<void>,
  options: { retainsConversationHistory?: boolean } = {}
): Promise<Rig> => {
  counter += 1;
  const events: ExperimentalCoreEvent[] = [];
  let turn = 0;
  const adapter = {
    protocol,
    ...(options.retainsConversationHistory === false ? { retainsConversationHistory: false } : {}),
    listModels: vi.fn().mockResolvedValue([]),
    run: vi.fn(async (input: CoreRunInput) => {
      turn += 1;
      await behaviour(input, turn);
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as Rig['adapter'];
  const permissionStore = new PermissionStore(new MemoryPermissionRepository());
  await permissionStore.initialize();
  await permissionStore.createGrant({
    scope: { subjectId: 'tomny', sessionId: '*', surfaceId: 'chat', capabilityId: 'core', toolPattern: 'Bash' },
    effect: 'allow',
    lifetime: 'persistent',
  });
  const runtime = new ExperimentalCoreRuntime((event) => events.push(event), {
    detectTargets: vi.fn().mockResolvedValue([targetFor('agent', protocol)]),
    adapters: [adapter],
    permissionStore,
    coordinator: { requestLease: vi.fn().mockResolvedValue({ id: 'lease' }), releaseLease: vi.fn() },
  });
  await runtime.listTargets();
  return { runtime, events, adapter, permissionStore };
};

const turnTo = async (
  rig: Rig,
  requestId: string,
  prompt = 'do the work',
  extra: { sessionId?: string; sterile?: boolean } = {}
): Promise<void> => {
  rig.runtime.start(
    requestId,
    'agent',
    prompt,
    world.workspace,
    undefined,
    'workspace-write',
    extra.sessionId ?? `session-${counter}`,
    undefined,
    extra.sterile ? { sterile: true } : undefined
  );
  await vi.waitFor(
    () =>
      expect(
        rig.events.some(
          (event) => event.requestId === requestId && ['completed', 'error', 'cancelled'].includes(event.type)
        )
      ).toBe(true),
    { timeout: 20_000 }
  );
};

const promptOf = (rig: Rig, index: number): string =>
  (rig.adapter.run.mock.calls[index]?.[0] as CoreRunInput | undefined)?.prompt ?? '';

const eventsOf = (rig: Rig, requestId: string): ExperimentalCoreEvent[] =>
  rig.events.filter((event) => event.requestId === requestId);

describe('PreToolUse in the runtime', { timeout: 60_000 }, () => {
  it('native adapter: the gate denies, the person is not asked, and the hook runs once per tool', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: { record: record('pre'), exitCode: 2, stderr: 'rm is not allowed' },
    });
    let verdict: unknown;
    const rig = await makeRig('tomny-json-stream', async (input) => {
      expect(input.preToolUse).toBeTypeOf('function');
      verdict = await input.preToolUse?.({ tool: 'Bash', callId: 'c1', input: { command: 'rm -rf /' } });
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-native-deny');
    expect(verdict).toEqual({ action: 'deny', reason: 'rm is not allowed' });
    const notice = eventsOf(rig, 'r-native-deny').find((event) => event.type === 'notice');
    expect(notice?.text).toContain('A hook blocked Bash');
    expect(notice?.text).toContain('rm is not allowed');
    expect(eventsOf(rig, 'r-native-deny').some((event) => event.type === 'permission')).toBe(false);
    expect(await readRecords(record('pre'))).toHaveLength(1);
  });

  it('native adapter: its own permission prompt does not run the hook a second time', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('pre-once') } });
    let permitted: boolean | undefined;
    const rig = await makeRig('tomny-json-stream', async (input) => {
      await input.preToolUse?.({ tool: 'Bash', callId: 'c1' });
      permitted = await input.requestPermission({ tool: 'Bash' });
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-native-once');
    expect(permitted).toBe(true);
    expect(await readRecords(record('pre-once'))).toHaveLength(1);
  });

  it('native adapter: ask is returned as ask, and no hook answer means no change', async () => {
    await world.install({
      event: 'PreToolUse',
      matcher: 'Write',
      spec: { record: record('ask'), stdout: hookAnswer('PreToolUse', { permissionDecision: 'ask' }) },
    });
    const verdicts: unknown[] = [];
    const rig = await makeRig('tomny-json-stream', async (input) => {
      verdicts.push(await input.preToolUse?.({ tool: 'Write', callId: 'c1' }));
      verdicts.push(await input.preToolUse?.({ tool: 'Read', callId: 'c2' }));
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-native-ask');
    expect(verdicts).toEqual([{ action: 'ask' }, { action: 'none' }]);
  });

  it('ACP-style adapter: a deny hook refuses the permission request before the person or the grant store', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('acp'), exitCode: 2, stderr: 'no shell' } });
    let permitted: boolean | undefined;
    const rig = await makeRig('acp', async (input) => {
      expect(input.preToolUse).toBeUndefined();
      // The grant store would allow `Bash` silently; the hook must still win.
      permitted = await input.requestPermission({ tool: 'Bash', detail: 'ls' });
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-acp-deny');
    expect(permitted).toBe(false);
    expect(eventsOf(rig, 'r-acp-deny').some((event) => event.type === 'permission')).toBe(false);
    expect(
      eventsOf(rig, 'r-acp-deny')
        .filter((event) => event.type === 'notice')
        .map((event) => event.text)
        .join(' ')
    ).toContain('no shell');
  });

  it('ACP-style adapter: ask forces a fresh prompt even though a grant exists; no hook means the grant applies', async () => {
    const rig = await makeRig('acp', async (input) => {
      const permitted = await input.requestPermission({ tool: 'Bash', detail: 'ls' });
      input.emit({ type: 'delta', text: String(permitted), mode: 'replace' });
    });
    await turnTo(rig, 'r-acp-nohook');
    expect(eventsOf(rig, 'r-acp-nohook').some((event) => event.type === 'permission')).toBe(false);

    await world.install({
      event: 'PreToolUse',
      spec: { record: record('acp-ask'), stdout: hookAnswer('PreToolUse', { permissionDecision: 'ask' }) },
    });
    const turnDone = turnTo(rig, 'r-acp-ask');
    await vi.waitFor(() => expect(eventsOf(rig, 'r-acp-ask').some((event) => event.type === 'permission')).toBe(true), {
      timeout: 20_000,
    });
    const permission = eventsOf(rig, 'r-acp-ask').find((event) => event.type === 'permission');
    await rig.runtime.resolvePermission(permission?.permissionId ?? '', false);
    await turnDone;
    const reply = eventsOf(rig, 'r-acp-ask').find((event) => event.type === 'delta');
    expect(reply?.text).toBe('false');
  });

  it('Codex: no tool can be blocked, the hook never runs, and the person is told so', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('codex'), exitCode: 2, stderr: 'no' } });
    const rig = await makeRig('codex-app-server', async (input) => {
      input.emit({ type: 'tool-call', tool: 'shell', callId: 'c1', text: 'run', input: { cmd: 'ls' } });
      input.emit({ type: 'tool-result', tool: 'shell', callId: 'c1', text: 'files', outcome: 'success' });
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-codex');
    expect(await readRecords(record('codex'))).toEqual([]);
    const notices = eventsOf(rig, 'r-codex').filter((event) => event.type === 'notice');
    expect(notices.map((event) => event.text).join(' ')).toMatch(/cannot block Codex tools/);
  });

  it('says nothing about coverage when no PreToolUse hook is active', async () => {
    const rig = await makeRig('codex-app-server', async (input) => {
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-quiet');
    expect(eventsOf(rig, 'r-quiet').some((event) => event.type === 'notice')).toBe(false);
  });
});

describe('PostToolUse and context hand-over', { timeout: 60_000 }, () => {
  it('reports finished tools of any agent with input and a redacted result, and failures separately', async () => {
    await world.install({ event: 'PostToolUse', spec: { record: record('post') } });
    await world.install({ event: 'PostToolUseFailure', spec: { record: record('postfail') } });
    const rig = await makeRig('codex-app-server', async (input) => {
      input.emit({
        type: 'tool-call',
        tool: 'Write',
        callId: 'w1',
        text: 'w',
        input: { file_path: 'a.ts', password: 'p4ss-p4ss' },
      });
      input.emit({
        type: 'tool-result',
        tool: 'Write',
        callId: 'w1',
        text: 'wrote with key sk-live-abcdefghijklmnopqrstuv1234',
        outcome: 'success',
      });
      input.emit({ type: 'tool-call', tool: 'Bash', callId: 'b1', text: 'b', input: { command: 'false' } });
      input.emit({ type: 'tool-result', tool: 'Bash', callId: 'b1', text: 'exit 1', outcome: 'error' });
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-post');
    await vi.waitFor(
      async () => {
        expect(await readRecords(record('postfail'))).toHaveLength(1);
        expect(await readRecords(record('post'))).toHaveLength(1);
      },
      { timeout: 20_000 }
    );
    const [ok] = await readRecords(record('post'));
    expect(ok).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'w1' });
    expect(JSON.stringify(ok)).not.toContain('p4ss-p4ss');
    expect(JSON.stringify(ok)).not.toContain('sk-live-abcdefghijklmnopqrstuv1234');
    expect(ok).toHaveProperty('tool_input.file_path', 'a.ts');
    const [failed] = await readRecords(record('postfail'));
    expect(failed).toMatchObject({ tool_name: 'Bash', error: 'exit 1', tool_input: { command: 'false' } });
  });

  it('delivers hook context from one turn to the next turn of the same session, once', async () => {
    await world.install({
      event: 'PostToolUse',
      name: 'pkg.lint',
      spec: {
        record: record('ctx'),
        stdout: hookAnswer('PostToolUse', { additionalContext: 'lint: 2 warnings in a.ts' }),
      },
    });
    const rig = await makeRig('codex-app-server', async (input, turn) => {
      if (turn === 1) {
        input.emit({ type: 'tool-call', tool: 'Write', callId: 'w1', text: 'w', input: { file_path: 'a.ts' } });
        input.emit({ type: 'tool-result', tool: 'Write', callId: 'w1', text: 'ok', outcome: 'success' });
      }
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-ctx-1', 'first', { sessionId: 'shared' });
    // The hook's answer is queued after its process exits, which can be after the first turn completed.
    await vi.waitFor(() => expect(queuedHookContextSessions()).toBe(1), { timeout: 20_000 });
    await turnTo(rig, 'r-ctx-2', 'second', { sessionId: 'shared' });
    await turnTo(rig, 'r-ctx-3', 'third', { sessionId: 'shared' });
    const prompts = rig.adapter.run.mock.calls.map((call) => (call[0] as CoreRunInput).prompt);
    expect(prompts[0]).not.toContain('Hook context');
    expect(prompts[1]).toContain('## Hook context');
    expect(prompts[1]).toContain('lint: 2 warnings in a.ts');
    expect(prompts[2]).not.toContain('## Hook context');
  });

  it('sterile derivation runs never fire hooks', async () => {
    await world.install({ event: 'Stop', spec: { record: record('sterile'), blockTimes: 9 } });
    const rig = await makeRig('codex-app-server', async (input) => {
      input.emit({ type: 'delta', text: 'ok', mode: 'replace' });
    });
    await turnTo(rig, 'r-sterile', 'derive', { sterile: true });
    expect(rig.adapter.run).toHaveBeenCalledTimes(1);
    expect(await readRecords(record('sterile'))).toHaveLength(0);
  });
});

describe('Stop loop', { timeout: 90_000 }, () => {
  it('continues up to 3 times, then ends; completed comes once and last', async () => {
    await world.install({ event: 'Stop', spec: { record: record('stop'), blockTimes: 99, blockReason: 'keep going' } });
    const rig = await makeRig('codex-app-server', async (input, turn) => {
      input.emit({ type: 'delta', text: `answer-${turn}`, mode: 'replace' });
    });
    await turnTo(rig, 'r-stop-max');
    // 1 original turn + at most 3 continuations.
    expect(rig.adapter.run).toHaveBeenCalledTimes(4);
    const mine = eventsOf(rig, 'r-stop-max');
    expect(mine.filter((event) => event.type === 'completed')).toHaveLength(1);
    expect(mine.at(-1)?.type).toBe('completed');
    expect(mine.some((event) => event.type === 'notice' && /more than 3 times/.test(event.text ?? ''))).toBe(true);
    const prompts = rig.adapter.run.mock.calls.map((call) => (call[0] as CoreRunInput).prompt);
    expect(prompts[1]).toContain('keep going');
    expect(prompts[3]).toContain('keep going');
    const finalText = mine.toReversed().find((event) => event.type === 'delta' && event.mode === 'replace')?.text ?? '';
    expect(finalText).toContain('answer-1');
    expect(finalText).toContain('answer-4');
    const payloads = await readRecords(record('stop'));
    expect(payloads.map((entry) => entry.stop_hook_active)).toEqual([false, true, true, true]);
    const session = await rig.runtime.getSession(`session-${counter}`);
    expect(session?.status).toBe('completed');
  });

  it('a hook that blocks once gives exactly one extra turn carrying its reason', async () => {
    await world.install({
      event: 'Stop',
      spec: { record: record('stop-once'), blockTimes: 1, blockReason: 'run the tests' },
    });
    const rig = await makeRig('codex-app-server', async (input, turn) => {
      input.emit({ type: 'delta', text: `answer-${turn}`, mode: 'replace' });
    });
    await turnTo(rig, 'r-stop-once');
    expect(rig.adapter.run).toHaveBeenCalledTimes(2);
    const second = promptOf(rig, 1);
    expect(second).toContain('run the tests');
    expect(eventsOf(rig, 'r-stop-once').filter((event) => event.type === 'completed')).toHaveLength(1);
  });

  it('re-sends the earlier answer to a transport that keeps no history', async () => {
    await world.install({
      event: 'Stop',
      spec: { record: record('stop-nohist'), blockTimes: 1, blockReason: 'again' },
    });
    const rig = await makeRig(
      'loopback-openai',
      async (input, turn) => {
        input.emit({ type: 'delta', text: `answer-${turn}`, mode: 'replace' });
      },
      { retainsConversationHistory: false }
    );
    await turnTo(rig, 'r-stop-nohist');
    const second = promptOf(rig, 1);
    expect(second).toContain('Your previous answer:\nanswer-1');
    expect(second).toContain('again');
  });

  it('continue:false stops without extra turns and tells the person', async () => {
    await world.install({
      event: 'Stop',
      spec: {
        record: record('stop-halt'),
        stdout: JSON.stringify({ continue: false, stopReason: 'enough for today' }),
      },
    });
    const rig = await makeRig('codex-app-server', async (input) => {
      input.emit({ type: 'delta', text: 'answer', mode: 'replace' });
    });
    await turnTo(rig, 'r-halt');
    expect(rig.adapter.run).toHaveBeenCalledTimes(1);
    expect(
      eventsOf(rig, 'r-halt').some((event) => event.type === 'notice' && /enough for today/.test(event.text ?? ''))
    ).toBe(true);
  });

  it('honours the global switch: no hook process, one turn', async () => {
    await world.install({ event: 'Stop', spec: { record: record('stop-off'), blockTimes: 99 } });
    await world.registry.setDisableAll(true);
    const rig = await makeRig('codex-app-server', async (input) => {
      input.emit({ type: 'delta', text: 'answer', mode: 'replace' });
    });
    await turnTo(rig, 'r-off');
    expect(rig.adapter.run).toHaveBeenCalledTimes(1);
    expect(await readRecords(record('stop-off'))).toHaveLength(0);
  });

  it('a user cancel during a continuation ends the run as cancelled, not completed', async () => {
    await world.install({ event: 'Stop', spec: { record: record('stop-cancel'), blockTimes: 99 } });
    let rigRef: Rig | undefined;
    const rig = await makeRig('codex-app-server', async (input, turn) => {
      if (turn === 2) {
        await rigRef?.runtime.cancel('r-cancel');
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
        return;
      }
      input.emit({ type: 'delta', text: `answer-${turn}`, mode: 'replace' });
    });
    rigRef = rig;
    await turnTo(rig, 'r-cancel');
    const types = eventsOf(rig, 'r-cancel').map((event) => event.type);
    expect(types).toContain('cancelled');
    expect(types).not.toContain('completed');
    expect(rig.adapter.run.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
