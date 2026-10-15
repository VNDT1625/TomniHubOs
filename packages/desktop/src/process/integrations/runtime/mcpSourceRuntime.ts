/**
 * Prepares a source-backed MCP server before adding it to the MCP catalog.
 * It cannot execute a file outside the extracted package and never inherits arbitrary app secrets.
 * Setup is performed once for each exact package version/recipe, never during check or describe.
 * A source folder is copied to a writable runtime folder first, and setup and the server run only there, so the
 * signed package folder is never written (setup output rule, see artifactSecurity SETUP_OUTPUT_RULE_VERSION).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { IMcpServerTransportStdio } from '@/common/config/storage';
import { minimalBaseEnv } from '@process/integrations/runtime/repoProcessNodePorts';
import { resolveCwdInsidePackage } from '@process/integrations/runtime/repoProcessCwd';
import type { ConnectionOf, HostContext } from '../connections/core/types';

const execute = promisify(execFile);
type SourceMcp = ConnectionOf<'mcp'> & {
  command: 'node' | 'python' | 'bun';
  args: string[];
  cwd?: string;
  setup?: string[][];
};
const NODE_SCRIPT = /\.(?:mjs|cjs|js)$/iu;
const PY_SCRIPT = /\.py$/iu;

const SETUP_PROGRAMS = new Set(['node', 'python', 'python3', 'uv', 'npm', 'pip', 'bun']);
const MAX_SETUP_COMMANDS = 6;

export type SourceMcpRuntimeDeps = Readonly<{
  /** Main-controlled marker root. A marker is recorded only after the copy and every setup step succeed. */
  markerDirectory: string;
  /**
   * Writable root for the runnable copy of each source folder (`<root>/<packageId>/<recipe digest>/`). The signed
   * package folder is never a working directory: setup output and runtime self-healing write only here.
   */
  runtimeDirectory: string;
  nodeExecutable?: string;
  runSetup?: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string>>
  ) => Promise<void>;
}>;
export type SourceMcpRuntime = Readonly<{
  check: (
    context: HostContext,
    connection: SourceMcp
  ) => Promise<Readonly<{ ok: true } | { ok: false; reason: string }>>;
  prepare: (context: HostContext, connection: SourceMcp) => Promise<IMcpServerTransportStdio>;
  files: (connection: SourceMcp) => string[];
}>;

const within = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};
const entryArgIndex = (connection: SourceMcp): number | undefined => {
  if (connection.command === 'python' && connection.args[0] === '-u') return 1;
  if (connection.command === 'python' && connection.args[0] === '-m') return undefined;
  return 0;
};
export const sourceMcpFiles = (connection: SourceMcp): string[] => {
  const relative = connection.cwd ?? 'source';
  const files: string[] = [];
  const entry = connection.args[entryArgIndex(connection) ?? -1];
  if (entry && !entry.startsWith('-')) {
    const script = entry.replace(/^\.\//u, '');
    files.push(script.startsWith(`${relative}/`) ? script : `${relative}/${script}`);
  }
  for (const argv of connection.setup ?? []) {
    for (const token of argv.slice(1)) {
      if (/\.(?:js|mjs|cjs|py)$/iu.test(token) && !token.startsWith('-')) {
        files.push(`${relative}/${token.replace(/^\.\//u, '')}`);
      }
    }
  }
  if (connection.setup?.length) files.push(`${relative}/package.json`);
  return [...new Set(files)];
};

const programOf = (
  argv: readonly string[],
  nodeExecutable: string
): Readonly<{ command: string; args: readonly string[]; node: boolean }> => {
  const [program, ...args] = argv;
  if (program === undefined || !SETUP_PROGRAMS.has(program)) throw new Error('Setup program is not allowed.');
  return program === 'node' ? { command: nodeExecutable, args, node: true } : { command: program, args, node: false };
};
/**
 * On Windows `npm` is a `.cmd` file that cannot be started without a shell (and a shell is never used here), so npm
 * runs as `node <npm-cli.js>` from the Node installation found on PATH.
 */
const windowsNpm = (): Readonly<{ command: string; prefix: readonly string[] }> | undefined => {
  for (const directory of (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter)) {
    if (directory === '') continue;
    const cli = path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!existsSync(cli)) continue;
    const node = path.join(directory, 'node.exe');
    return { command: existsSync(node) ? node : 'node', prefix: [cli] };
  }
  return undefined;
};
/**
 * The program and arguments a setup step really starts. On Windows `npm` is run through its own CLI script (see
 * `windowsNpm`), so the step never depends on a `.cmd` shim. Exported so a test can check the mapping the enable path uses.
 */
export const setupInvocation = (
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): Readonly<{ command: string; args: readonly string[] }> => {
  const npm = command === 'npm' && platform === 'win32' ? windowsNpm() : undefined;
  return npm ? { command: npm.command, args: [...npm.prefix, ...args] } : { command, args };
};

const defaultSetup = async (
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>
): Promise<void> => {
  const invocation = setupInvocation(command, args);
  await execute(invocation.command, [...invocation.args], {
    cwd,
    env: { ...env },
    timeout: 120_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    shell: false,
  });
};

const MAX_COPIED_FILES = 20_000;
const PACKAGE_ID_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/u;

/**
 * Copies a source folder of a sealed package into a writable runtime folder. Symbolic links are refused, and a
 * `node_modules` directly under the folder is never copied: setup rebuilds it in the copy (setup output rule).
 */
const copySourceTree = async (from: string, to: string): Promise<void> => {
  let copied = 0;
  const visit = async (source: string, target: string, top: boolean): Promise<void> => {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (top && entry.name === 'node_modules') continue;
      if (entry.isSymbolicLink()) throw new Error('The MCP source folder contains a symbolic link.');
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        // oxlint-disable-next-line no-await-in-loop -- directories are copied depth-first, one at a time
        await visit(sourcePath, targetPath, false);
        continue;
      }
      if (!entry.isFile()) throw new Error('The MCP source folder contains an unsupported entry.');
      copied += 1;
      if (copied > MAX_COPIED_FILES) throw new Error('The MCP source folder has too many files.');
      // oxlint-disable-next-line no-await-in-loop -- files are copied one at a time, bounded
      await copyFile(sourcePath, targetPath);
    }
  };
  await visit(from, to, true);
};

export const createSourceMcpRuntime = (deps: SourceMcpRuntimeDeps): SourceMcpRuntime => {
  const nodeExecutable = deps.nodeExecutable ?? process.execPath;
  const runSetup = deps.runSetup ?? defaultSetup;
  /** One build per runtime folder at a time, so two enables cannot copy or set up the same folder twice. */
  const building = new Map<string, Promise<void>>();
  const resolveEntry = async (
    context: HostContext,
    connection: SourceMcp
  ): Promise<{ cwd: string; args: string[] }> => {
    const cwd = await resolveCwdInsidePackage(context.packageDirectory, connection.cwd ?? 'source', connection.id);
    const index = entryArgIndex(connection);
    const args = [...connection.args];
    if (index !== undefined) {
      const entry = args[index];
      const expected = connection.command === 'python' ? PY_SCRIPT : NODE_SCRIPT;
      if (
        !entry ||
        !expected.test(entry) ||
        entry.includes('\\') ||
        path.isAbsolute(entry) ||
        entry.split('/').includes('..')
      ) {
        throw new Error('The MCP source entrypoint is not a safe script path.');
      }
      const sourcePrefix = `${connection.cwd ?? 'source'}/`;
      const script = entry.startsWith(sourcePrefix) ? entry.slice(sourcePrefix.length) : entry;
      const file = await realpath(path.join(cwd, script));
      const packageRoot = await realpath(context.packageDirectory);
      if (!within(packageRoot, file) || !within(cwd, file) || !(await stat(file)).isFile())
        throw new Error('The MCP script must be a regular file inside its source folder.');
      args[index] = file;
    }
    return { cwd, args };
  };
  const check = async (context: HostContext, connection: SourceMcp) => {
    try {
      if (!['node', 'python', 'bun'].includes(connection.command))
        return { ok: false as const, reason: 'Unsupported source interpreter.' };
      await resolveEntry(context, connection);
      if ((connection.setup?.length ?? 0) > MAX_SETUP_COMMANDS) throw new Error('Too many setup steps.');
      for (const argv of connection.setup ?? []) programOf(argv, nodeExecutable);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, reason: error instanceof Error ? error.message : 'MCP source is unavailable.' };
    }
  };
  /**
   * Makes the runnable copy of the source folder (once per recipe), runs the approved setup inside that copy, and
   * records the marker only after both succeed. A copy that is missing or unmarked is rebuilt from the sealed folder.
   */
  const ensureRuntime = (root: string, marker: string, digest: string, source: string, connection: SourceMcp) => {
    const pending = building.get(root);
    if (pending) return pending;
    const build = (async (): Promise<void> => {
      let ready = false;
      try {
        ready = (await readFile(marker, 'utf8')).trim() === digest && (await stat(root)).isDirectory();
      } catch {
        ready = false;
      }
      if (ready) return;
      await rm(root, { recursive: true, force: true });
      await copySourceTree(source, root);
      for (const argv of connection.setup ?? []) {
        const program = programOf(argv, nodeExecutable);
        const env = minimalBaseEnv();
        if (program.node) env.ELECTRON_RUN_AS_NODE = '1';
        // Setup sees only minimal system variables. Package secrets are not available to installers.
        // oxlint-disable-next-line no-await-in-loop -- ordered setup, fail closed
        await runSetup(program.command, program.args, root, env);
      }
      await mkdir(deps.markerDirectory, { recursive: true });
      await writeFile(marker, digest + '\n', { flag: 'w', mode: 0o600 });
    })();
    building.set(root, build);
    return build.finally(() => {
      if (building.get(root) === build) building.delete(root);
    });
  };
  const prepare = async (context: HostContext, connection: SourceMcp): Promise<IMcpServerTransportStdio> => {
    if (!PACKAGE_ID_SEGMENT.test(context.packageId)) throw new Error('The MCP source package id is not safe.');
    // `source` is the sealed folder, checked by resolveEntry; the server runs only from the copy made below.
    const { cwd: sealedCwd, args: sealedArgs } = await resolveEntry(context, connection);
    const recipe = JSON.stringify({
      packageId: context.packageId,
      version: context.packageVersion,
      cwd: connection.cwd,
      setup: connection.setup ?? [],
      args: connection.args,
      command: connection.command,
    });
    const digest = createHash('sha256').update(recipe).digest('hex');
    const root = path.join(deps.runtimeDirectory, context.packageId, digest);
    const marker = path.join(deps.markerDirectory, digest + '.done');
    await ensureRuntime(root, marker, digest, sealedCwd, connection);
    const index = entryArgIndex(connection);
    const args = [...sealedArgs];
    if (index !== undefined) {
      const sealedEntry = sealedArgs[index];
      if (sealedEntry === undefined) throw new Error('The MCP source entrypoint is missing.');
      args[index] = path.join(root, path.relative(sealedCwd, sealedEntry));
    }
    const env: Record<string, string> = {};
    if (connection.command === 'node') env.ELECTRON_RUN_AS_NODE = '1';
    const command = connection.command === 'node' ? nodeExecutable : connection.command;
    // The MCP client is the owner of the child. A stdio server must not be launched during enable.
    return { type: 'stdio', command, args, cwd: root, ...(Object.keys(env).length ? { env } : {}) };
  };
  return { check, prepare, files: sourceMcpFiles };
};
