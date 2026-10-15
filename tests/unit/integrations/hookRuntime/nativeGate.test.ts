import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TomnyCoreAdapter,
  type CoreAdapterEvent,
  type CoreRunInput,
  type DetectedCoreTarget,
} from '@process/experimentalCore/adapters';
import { configureHookRuntime, dispatchPreToolUse } from '@process/integrations/hookRuntime/hookDispatcher';
import { createHookWorld, hookAnswer, readRecords, type HookWorld } from './hookTestKit';

/**
 * The REAL native adapter against a fake sidecar process that speaks the tomny-json-stream protocol, with a real
 * hook process behind the gate (design 11.3: PreToolUse blocks every native tool, before every other branch).
 */

let world: HookWorld;
let adapter: TomnyCoreAdapter;

beforeEach(async () => {
  world = await createHookWorld();
  configureHookRuntime({ registry: async () => world.registry });
  adapter = new TomnyCoreAdapter({
    list: async () =>
      [
        {
          id: 'p1',
          platform: 'openai',
          api_key: 'test-key',
          base_url: 'http://127.0.0.1:9',
          models: ['m'],
          enabled: true,
        },
      ] as never,
    get: async () => undefined,
  });
});

afterEach(async () => {
  await adapter.dispose();
  configureHookRuntime();
});

type Tool = { name: string; category?: string; input?: unknown };

/** A sidecar that asks for each tool in turn, waits for the verdict of the host and records every command. */
const writeSidecar = async (file: string, commandsLog: string, tools: Tool[]): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `
const fs = require('fs');
const readline = require('readline');
const tools = ${JSON.stringify(tools)};
const log = (obj) => fs.appendFileSync(${JSON.stringify(commandsLog)}, JSON.stringify(obj) + '\\n');
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
let waiting = null;
const next = (index) => {
  if (index >= tools.length) { send({ type: 'stream_end' }); return; }
  const tool = tools[index];
  waiting = { id: 'call-' + index, index };
  send({ type: 'tool_request', call_id: waiting.id, tool_name: tool.name, category: tool.category || 'exec', input: tool.input });
};
send({ type: 'ready', mcp: false });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = JSON.parse(line);
  log(cmd);
  if (cmd.type === 'message') next(0);
  else if (waiting && cmd.call_id === waiting.id && (cmd.type === 'tool_approve' || cmd.type === 'tool_deny' || cmd.type === 'tool_result')) {
    const index = waiting.index; waiting = null; next(index + 1);
  }
});
`,
    'utf8'
  );
};

const target = (script: string): DetectedCoreTarget => ({
  id: 'tomny',
  name: 'Tomny',
  protocol: 'tomny-json-stream',
  candidates: [],
  args: [script],
  detail: 'fake sidecar',
  runnable: true,
  detected: true,
  available: true,
  command: process.execPath,
});

type Outcome = { events: CoreAdapterEvent[]; commands: Array<Record<string, unknown>>; permissionCalls: unknown[] };

const runTurn = async (
  tools: Tool[],
  options: { permissionMode?: CoreRunInput['permissionMode']; answerPermission?: boolean; gate?: boolean } = {}
): Promise<Outcome> => {
  const script = path.join(world.dir, `sidecar-${Math.random().toString(36).slice(2)}.js`);
  const commandsLog = path.join(world.dir, `commands-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeSidecar(script, commandsLog, tools);
  const events: CoreAdapterEvent[] = [];
  const permissionCalls: unknown[] = [];
  const turn: HookTurn = {
    sessionId: 'native-session',
    workspaceDir: world.workspace,
    permissionMode: options.permissionMode ?? 'full-access',
  };
  await adapter.run({
    sessionId: `native-${script}`,
    target: target(script),
    prompt: 'hello',
    workspace: world.workspace,
    permissionMode: options.permissionMode ?? 'full-access',
    surface: 'chat',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    requestPermission: async (request) => {
      permissionCalls.push(request);
      return options.answerPermission ?? true;
    },
    ...(options.gate === false ? {} : { preToolUse: (call) => dispatchPreToolUse(turn, call) }),
  });
  return { events, commands: await readRecords(commandsLog), permissionCalls };
};

type HookTurn = Parameters<typeof dispatchPreToolUse>[0];

const verdictsOf = (outcome: Outcome): Array<{ type: unknown; reason?: unknown }> =>
  outcome.commands
    .filter((command) => command.type === 'tool_approve' || command.type === 'tool_deny')
    .map((command): { type: unknown; reason?: unknown } => {
      const verdict: { type: unknown; reason?: unknown } = { type: command.type };
      if (command.reason) verdict.reason = command.reason;
      return verdict;
    });

const record = (name: string): string => `${world.dir}/${name}.jsonl`;

describe('native adapter PreToolUse gate', { timeout: 90_000 }, () => {
  it('without a hook verdict the normal flow decides and the tool call is announced once', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('none') } });
    const outcome = await runTurn([{ name: 'Bash', input: { command: 'ls' } }]);
    expect(verdictsOf(outcome)).toEqual([{ type: 'tool_approve' }]);
    const calls = outcome.events.filter((event) => event.type === 'tool-call' && event.phase === 'requested');
    expect(calls).toHaveLength(1);
    expect(await readRecords(record('none'))).toHaveLength(1);
  });

  it('a deny hook beats full-access: the sidecar gets tool_deny with the hook reason, for any tool', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: { record: record('deny'), exitCode: 2, stderr: 'not on my watch' },
    });
    const outcome = await runTurn([
      { name: 'Bash', input: { command: 'rm -rf /' } },
      // Read-only and Hub-run tools sit behind other branches; the gate must come first for them too.
      { name: 'tomny_compass', input: { path: '.' } },
      { name: 'tomny_session_actions', input: {} },
    ]);
    expect(verdictsOf(outcome)).toEqual([
      { type: 'tool_deny', reason: 'Blocked by hook: not on my watch' },
      { type: 'tool_deny', reason: 'Blocked by hook: not on my watch' },
      { type: 'tool_deny', reason: 'Blocked by hook: not on my watch' },
    ]);
    expect(outcome.commands.some((command) => command.type === 'tool_result')).toBe(false);
    expect(outcome.permissionCalls).toEqual([]);
    expect(await readRecords(record('deny'))).toHaveLength(3);
  });

  it('only the tools the matcher selects are blocked', async () => {
    await world.install({
      event: 'PreToolUse',
      matcher: 'Bash',
      spec: { record: record('m'), exitCode: 2, stderr: 'no' },
    });
    const outcome = await runTurn([
      { name: 'Bash', input: {} },
      { name: 'Fetch', input: {} },
    ]);
    expect(verdictsOf(outcome).map((verdict) => verdict.type)).toEqual(['tool_deny', 'tool_approve']);
  });

  it('ask forces a fresh question even in full-access; the answer decides', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: { record: record('ask'), stdout: hookAnswer('PreToolUse', { permissionDecision: 'ask' }) },
    });
    const declined = await runTurn([{ name: 'Bash', input: { command: 'ls' } }], { answerPermission: false });
    expect(declined.permissionCalls).toEqual([expect.objectContaining({ tool: 'Bash', forceFresh: true })]);
    expect(verdictsOf(declined)).toEqual([{ type: 'tool_deny', reason: 'Denied by user' }]);

    // Approved by the person: the normal flow still runs afterwards (full-access then approves).
    const accepted = await runTurn([{ name: 'Bash', input: { command: 'ls' } }], { answerPermission: true });
    expect(verdictsOf(accepted)).toEqual([{ type: 'tool_approve' }]);
  });

  it('an allow answer is not a grant: read-only mode still denies', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: {
        record: record('allow'),
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }),
      },
    });
    const outcome = await runTurn([{ name: 'Bash', category: 'exec', input: { command: 'ls' } }], {
      permissionMode: 'read-only',
    });
    expect(verdictsOf(outcome)).toEqual([{ type: 'tool_deny', reason: 'Tool denied by the current permission mode.' }]);
  });

  it('a hook that times out lets the tool through (fail open) and never wedges the turn', async () => {
    await world.install({
      event: 'PreToolUse',
      timeoutSec: 1,
      spec: { record: record('slow'), sleepMs: 4_000, exitCode: 2, stderr: 'late' },
    });
    const outcome = await runTurn([{ name: 'Bash', input: {} }]);
    expect(verdictsOf(outcome)).toEqual([{ type: 'tool_approve' }]);
  });

  it('a gate that throws fails open', async () => {
    const outcome = await (async () => {
      const spy = vi.fn().mockRejectedValue(new Error('hook layer down'));
      const script = path.join(world.dir, 'sidecar-throw.js');
      const commandsLog = path.join(world.dir, 'commands-throw.jsonl');
      await writeSidecar(script, commandsLog, [{ name: 'Bash', input: {} }]);
      await adapter.run({
        sessionId: 'native-throw',
        target: target(script),
        prompt: 'hello',
        workspace: world.workspace,
        permissionMode: 'full-access',
        surface: 'chat',
        signal: new AbortController().signal,
        emit: () => undefined,
        requestPermission: async () => true,
        preToolUse: spy,
      });
      return readRecords(commandsLog);
    })();
    expect(outcome.filter((command) => command.type === 'tool_approve')).toHaveLength(1);
  });
});
