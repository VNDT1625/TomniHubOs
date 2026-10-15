import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HookEventName, HookHandler } from '@/common/integrations/hooks';
import { createHookRegistry, type HookRegistry } from '@process/integrations/hooks/hookRegistry';
import { createHookLimiter } from '@process/integrations/hooks/hookRunner';

/**
 * Shared kit of the hook runtime tests: a real registry in a temp directory and real hook processes
 * (.js files run through process.execPath, as in tests/unit/integrations/hooks).
 */

export type ScriptSpec = {
  /** Every run appends its stdin (one JSON line) here. */
  record: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** Milliseconds to sleep before answering (timeout tests). */
  sleepMs?: number;
  /**
   * Stop-hook helper: while fewer than `blockTimes` runs happened (counted in `record`), answer with a block
   * decision whose reason is `blockReason`.
   */
  blockTimes?: number;
  blockReason?: string;
};

export const writeHookScript = async (file: string, spec: ScriptSpec): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const body = `
const fs = require('fs');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks).toString('utf8');
  const before = fs.existsSync(${JSON.stringify(spec.record)})
    ? fs.readFileSync(${JSON.stringify(spec.record)}, 'utf8').split('\\n').filter(Boolean).length
    : 0;
  fs.appendFileSync(${JSON.stringify(spec.record)}, input.replace(/\\n/g, ' ') + '\\n');
  const finish = () => {
    ${
      spec.blockTimes !== undefined
        ? `if (before < ${spec.blockTimes}) process.stdout.write(JSON.stringify({ decision: 'block', reason: ${JSON.stringify(spec.blockReason ?? 'keep going')} + ' ' + before }));`
        : spec.stdout
          ? `process.stdout.write(${JSON.stringify(spec.stdout)});`
          : ''
    }
    ${spec.stderr ? `process.stderr.write(${JSON.stringify(spec.stderr)});` : ''}
    process.exitCode = ${spec.exitCode ?? 0};
  };
  ${spec.sleepMs ? `setTimeout(finish, ${spec.sleepMs});` : 'finish();'}
});
`;
  await writeFile(file, body, 'utf8');
};

export const readRecords = async (record: string): Promise<Array<Record<string, unknown>>> => {
  if (!existsSync(record)) return [];
  const text = await readFile(record, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

export const hookAnswer = (event: HookEventName, fields: Record<string, unknown>): string =>
  JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } });

export type HookWorld = {
  registry: HookRegistry;
  /** A real directory usable as workspace and plugin root parent. */
  dir: string;
  workspace: string;
  /** Registers a package hook for `event`, approves it as the UI would and returns its id. */
  install: (input: {
    event: HookEventName;
    spec: ScriptSpec;
    matcher?: string;
    name?: string;
    timeoutSec?: number;
  }) => Promise<string>;
};

let counter = 0;

export const createHookWorld = async (): Promise<HookWorld> => {
  counter += 1;
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), `tomny-hookrt-${counter}-`)));
  const workspace = path.join(dir, 'ws');
  await mkdir(workspace, { recursive: true });
  const registry = createHookRegistry({
    storeFilePath: path.join(dir, 'state', 'user-hooks.json'),
    auditFilePath: path.join(dir, 'state', 'audit.jsonl'),
    limiter: createHookLimiter(),
  });
  await registry.initialize();
  let installed = 0;
  const install: HookWorld['install'] = async ({ event, spec, matcher, name, timeoutSec }) => {
    installed += 1;
    const pluginRoot = path.join(dir, `plugin-${installed}`);
    await writeHookScript(path.join(pluginRoot, 'hook.js'), spec);
    const handler: HookHandler = {
      event,
      command: '${CLAUDE_PLUGIN_ROOT}/hook.js',
      args: [],
      timeoutSec: timeoutSec ?? 20,
      form: 'exec',
      unsupported: false,
      ...(matcher !== undefined ? { matcher } : {}),
    };
    const [view] = await registry.registerPackageHooks(name ?? `pkg.test${installed}`, [{ handler, pluginRoot }]);
    if (!view) throw new Error('hook was not registered');
    const description = await registry.describeHook(view.id);
    const approved = await registry.approveHook(view.id, description?.hash ?? '');
    if ('code' in approved) throw new Error(`approval failed: ${approved.code}`);
    return view.id;
  };
  return { registry, dir, workspace, install };
};
