/**
 * Decides exactly what process a hook handler becomes (design section 11.6 items 3 and 4):
 * path containment under the plugin root, interpreter allow-list, extension mapping, Git Bash and
 * PowerShell lookup. Pure planning: nothing here spawns a process.
 */

import { realpath as realpathCallback, promises as fsp, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { expandPlaceholders, type PlaceholderContext } from '@/common/integrations/hooks';
import {
  HOOK_INTERPRETER_NAMES,
  type HookInterpreterName,
  type HookInterpreterResolver,
  type HookRunnerError,
  type HookRunnerErrorCode,
  type HookRunnerHandler,
  type HookSource,
} from './hookTypes';

/** Command line chosen for a handler, before the environment is attached. */
export type HookPlan =
  | {
      kind: 'ok';
      file: string;
      args: string[];
      shell: boolean;
      usesElectronAsNode: boolean;
      /** The script the process will execute, when the plan has one (used for the pre-spawn content check). */
      scriptFile?: string;
    }
  | { kind: 'error'; error: HookRunnerError };

export type HookPlanRequest = {
  handler: HookRunnerHandler;
  source: HookSource;
  placeholders: PlaceholderContext;
  cwd: string;
  resolveInterpreter?: HookInterpreterResolver;
  /** Parent environment used by the default interpreter lookup (PATH, Program Files). */
  env: NodeJS.ProcessEnv;
};

const INTERPRETER_SET: ReadonlySet<string> = new Set<string>(HOOK_INTERPRETER_NAMES);
const POWERSHELL_FLAGS: readonly string[] = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const MISSING_GIT_BASH = 'Git Bash is required to run .sh hooks on Windows, but bash was not found';

const fail = (code: HookRunnerErrorCode, message: string): { kind: 'error'; error: HookRunnerError } => ({
  kind: 'error',
  error: { code, message },
});

const realpathNative = (target: string): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    realpathCallback.native(target, (error, resolved) => (error ? reject(error) : resolve(resolved)));
  });

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** True when `target` is strictly inside `root` (both already absolute). Case-insensitive on Windows via `path`. */
const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  if (relative === '' || path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

type RootCheck = { kind: 'ok'; real: string } | { kind: 'error'; error: HookRunnerError };

/**
 * Resolves `candidate` (absolute, or relative to the plugin root) and proves, through real paths, that it is
 * an existing regular file inside the plugin root. A symlink or junction that leaves the root is rejected.
 */
const resolveFileUnderRoot = async (candidate: string, pluginRoot: string | undefined): Promise<RootCheck> => {
  if (pluginRoot === undefined || pluginRoot === '') {
    return fail('HOOK_PATH_FORBIDDEN', 'A plugin root is required to run a package hook');
  }
  const lexicalRoot = path.resolve(pluginRoot);
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(lexicalRoot, candidate);
  let realRoot: string;
  try {
    realRoot = await realpathNative(lexicalRoot);
  } catch {
    return fail('HOOK_PATH_FORBIDDEN', 'The plugin root does not exist');
  }
  if (!isInside(lexicalRoot, absolute) && !isInside(realRoot, absolute)) {
    return fail('HOOK_PATH_FORBIDDEN', 'The hook command is outside the plugin root');
  }
  let real: string;
  try {
    real = await realpathNative(absolute);
  } catch (error) {
    if (errorCodeOf(error) === 'ENOENT') return fail('HOOK_START_FAILED', 'The hook script does not exist');
    return fail('HOOK_PATH_FORBIDDEN', 'The hook command path could not be resolved');
  }
  if (!isInside(realRoot, real)) {
    return fail('HOOK_PATH_FORBIDDEN', 'The hook command resolves outside the plugin root (symlink or junction)');
  }
  try {
    if (!(await fsp.stat(real)).isFile()) return fail('HOOK_PATH_FORBIDDEN', 'The hook command is not a file');
  } catch {
    return fail('HOOK_START_FAILED', 'The hook script cannot be read');
  }
  return { kind: 'ok', real };
};

const isExecutableFile = async (file: string): Promise<boolean> => {
  try {
    if (!(await fsp.stat(file)).isFile()) return false;
    if (process.platform !== 'win32') await fsp.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const pathEntries = (env: NodeJS.ProcessEnv): string[] => {
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path');
  const raw = key === undefined ? undefined : env[key];
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '');
};

const winEnvValue = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
};

/** Searches PATH for a real executable. `skip` drops directories (Windows app-execution aliases, the WSL launcher). */
export const findExecutableOnPath = async (
  name: string,
  env: NodeJS.ProcessEnv,
  skip: (directory: string) => boolean = () => false
): Promise<string | undefined> => {
  const suffixes = process.platform === 'win32' ? ['.exe'] : [''];
  for (const directory of pathEntries(env)) {
    if (skip(directory)) continue;
    for (const suffix of suffixes) {
      const candidate = path.join(directory, `${name}${suffix}`);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
};

const WINDOWS_STUB_DIRECTORY = /[\\/]windowsapps([\\/]|$)/i;
const WINDOWS_SYSTEM_DIRECTORY = /[\\/]windows[\\/]system32([\\/]|$)/i;

/** Git for Windows installs: next to `git.exe` on PATH, then the usual Program Files and per-user locations. */
const gitForWindowsRoots = async (env: NodeJS.ProcessEnv): Promise<string[]> => {
  const roots: string[] = [];
  const git = await findExecutableOnPath('git', env);
  if (git !== undefined) {
    let directory = path.dirname(git);
    for (let depth = 0; depth < 3; depth += 1) {
      if (path.basename(directory).toLowerCase() === 'git') roots.push(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  for (const variable of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
    const base = winEnvValue(env, variable);
    if (base) roots.push(path.join(base, 'Git'));
  }
  const local = winEnvValue(env, 'LocalAppData');
  if (local) roots.push(path.join(local, 'Programs', 'Git'));
  return roots;
};

/**
 * Default interpreter lookup. `node` is Electron's own binary (run with ELECTRON_RUN_AS_NODE=1 by the planner);
 * `bash`/`sh` on Windows come from Git for Windows, never from the WSL launcher in System32.
 */
export const createDefaultInterpreterResolver =
  (env: NodeJS.ProcessEnv): HookInterpreterResolver =>
  async (name) => {
    if (name === 'node') return process.execPath;
    if (process.platform === 'win32' && (name === 'bash' || name === 'sh')) {
      for (const root of await gitForWindowsRoots(env)) {
        const candidate = path.join(root, 'bin', `${name}.exe`);
        if (await isExecutableFile(candidate)) return candidate;
      }
      return findExecutableOnPath(name, env, (directory) => WINDOWS_SYSTEM_DIRECTORY.test(directory));
    }
    const skipStubs =
      process.platform === 'win32' && (name === 'python' || name === 'python3')
        ? (directory: string): boolean => WINDOWS_STUB_DIRECTORY.test(directory)
        : undefined;
    return findExecutableOnPath(name, env, skipStubs);
  };

const toBashPath = (file: string): string => (process.platform === 'win32' ? file.replace(/\\/g, '/') : file);

const isElectronNode = (exe: string): boolean =>
  path.resolve(exe).toLowerCase() === path.resolve(process.execPath).toLowerCase();

const missing = (name: string): { kind: 'error'; error: HookRunnerError } =>
  name === 'bash' || name === 'sh'
    ? fail(
        'HOOK_RUNTIME_MISSING',
        process.platform === 'win32' ? MISSING_GIT_BASH : `Interpreter "${name}" was not found`
      )
    : fail('HOOK_RUNTIME_MISSING', `Interpreter "${name}" was not found`);

/** Builds argv for an interpreter that runs `script` followed by `rest`. */
const interpreterArgs = (name: HookInterpreterName, script: string, rest: readonly string[]): string[] => {
  switch (name) {
    case 'pwsh':
    case 'powershell':
      return [...POWERSHELL_FLAGS, '-File', script, ...rest];
    case 'bash':
    case 'sh':
      return [toBashPath(script), ...rest];
    case 'uv':
    case 'deno':
      return ['run', script, ...rest];
    default:
      return [script, ...rest];
  }
};

/** Extracts the interpreter named by a `#!` line, or undefined when it is not a listed interpreter. */
const interpreterFromShebang = (head: string): HookInterpreterName | undefined => {
  if (!head.startsWith('#!')) return undefined;
  const firstLine = head.slice(2).split(/\r?\n/, 1)[0] ?? '';
  const tokens = firstLine
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  let program: string | undefined = tokens[0];
  if (program === undefined) return undefined;
  let base = path.posix.basename(program.replace(/\\/g, '/'));
  if (base === 'env') {
    program = tokens.slice(1).find((token) => !token.startsWith('-') && !token.includes('='));
    if (program === undefined) return undefined;
    base = path.posix.basename(program);
  }
  if (/^python3(\.\d+)*$/.test(base)) return 'python3';
  if (/^python(\.\d+)*$/.test(base)) return 'python';
  return INTERPRETER_SET.has(base) ? (base as HookInterpreterName) : undefined;
};

const readHead = async (file: string): Promise<string> => {
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    handle = await fsp.open(file, 'r');
    const buffer = Buffer.alloc(160);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close().catch((): void => undefined);
  }
};

type Mapped =
  | { kind: 'ok'; file: string; args: string[]; usesElectronAsNode: boolean }
  | { kind: 'error'; error: HookRunnerError };

const viaInterpreter = async (
  names: readonly HookInterpreterName[],
  script: string,
  rest: readonly string[],
  resolve: HookInterpreterResolver
): Promise<Mapped> => {
  for (const name of names) {
    const exe = await resolve(name);
    if (exe === undefined) continue;
    return {
      kind: 'ok',
      file: exe,
      args: interpreterArgs(name, script, rest),
      usesElectronAsNode: isElectronNode(exe),
    };
  }
  return missing(names[0] ?? 'interpreter');
};

/** Maps a script file to its interpreter by extension, then by shebang. */
const mapScriptFile = async (
  file: string,
  rest: readonly string[],
  resolve: HookInterpreterResolver
): Promise<Mapped> => {
  const extension = path.extname(file).toLowerCase();
  switch (extension) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return viaInterpreter(['node'], file, rest, resolve);
    case '.sh':
      return viaInterpreter(process.platform === 'win32' ? ['bash'] : ['bash', 'sh'], file, rest, resolve);
    case '.ps1':
      return viaInterpreter(['pwsh', 'powershell'], file, rest, resolve);
    case '.py':
      return viaInterpreter(['python', 'python3', 'uv'], file, rest, resolve);
    case '.exe':
    case '.com':
      if (process.platform === 'win32') return { kind: 'ok', file, args: [...rest], usesElectronAsNode: false };
      break;
    case '.cmd':
    case '.bat':
      return fail(
        'HOOK_RUNTIME_MISSING',
        'Batch files cannot run as exec hooks; use a script with a listed interpreter'
      );
    default:
      break;
  }
  const shebang = interpreterFromShebang(await readHead(file));
  if (shebang !== undefined) {
    const names: HookInterpreterName[] = shebang === 'python3' ? ['python3', 'python'] : [shebang];
    return viaInterpreter(names, file, rest, resolve);
  }
  return fail('HOOK_RUNTIME_MISSING', 'The hook script has no known extension and no usable shebang');
};

const interpreterNameOf = (command: string): HookInterpreterName | undefined => {
  if (command.includes('/') || command.includes('\\')) return undefined;
  const lower = command.toLowerCase().replace(/\.exe$/, '');
  return INTERPRETER_SET.has(lower) ? (lower as HookInterpreterName) : undefined;
};

/**
 * Turns a handler into a concrete command line.
 *
 * - package + shell: refused (`HOOK_SHELL_FORBIDDEN`).
 * - package + exec: the command must be a file under the plugin root, or a listed interpreter whose first
 *   script argument is such a file; everything else is `HOOK_PATH_FORBIDDEN`.
 * - user/workspace: shell runs the expanded string through the platform shell (the user approved it);
 *   exec applies the same interpreter mapping without the containment rule.
 */
export const planHookCommand = async (request: HookPlanRequest): Promise<HookPlan> => {
  const { handler, source, placeholders } = request;
  const command = expandPlaceholders(handler.command, placeholders);
  const args = (handler.args ?? []).map((arg) => expandPlaceholders(arg, placeholders));

  if (handler.form === 'shell') {
    if (source === 'package') {
      return fail('HOOK_SHELL_FORBIDDEN', 'Package hooks must use exec form; shell commands are not allowed');
    }
    return { kind: 'ok', file: command, args: [], shell: true, usesElectronAsNode: false };
  }

  const resolve = request.resolveInterpreter ?? createDefaultInterpreterResolver(request.env);
  const enforceRoot = source === 'package';
  const interpreter = interpreterNameOf(command);

  if (interpreter !== undefined) {
    // `uv run script` and `deno run script`: the sub-command precedes the script.
    const hasSubcommand = (interpreter === 'uv' || interpreter === 'deno') && args[0] === 'run';
    const scriptIndex = hasSubcommand ? 1 : 0;
    let script = args[scriptIndex];
    let scriptFile: string | undefined;
    if (enforceRoot) {
      if (script === undefined || script.startsWith('-')) {
        return fail(
          'HOOK_PATH_FORBIDDEN',
          'An interpreter hook needs a script file under the plugin root as its first argument'
        );
      }
      const checked = await resolveFileUnderRoot(script, placeholders.pluginRoot);
      if (checked.kind === 'error') return checked;
      script = checked.real;
      scriptFile = checked.real;
    }
    const exe = await resolve(interpreter);
    if (exe === undefined) return missing(interpreter);
    const rest = args.slice(scriptIndex + 1);
    const finalArgs =
      script === undefined || (!enforceRoot && script.startsWith('-'))
        ? args
        : interpreterArgs(interpreter, script, rest);
    return {
      kind: 'ok',
      file: exe,
      args: finalArgs,
      shell: false,
      usesElectronAsNode: isElectronNode(exe),
      ...(scriptFile !== undefined ? { scriptFile } : {}),
    };
  }

  if (enforceRoot) {
    const checked = await resolveFileUnderRoot(command, placeholders.pluginRoot);
    if (checked.kind === 'error') return checked;
    const mapped = await mapScriptFile(checked.real, args, resolve);
    return mapped.kind === 'ok' ? { ...mapped, shell: false, scriptFile: checked.real } : mapped;
  }

  // User and workspace hooks: a path to an existing file gets the same mapping, a bare program name runs as is.
  const looksLikePath = command.includes('/') || command.includes('\\');
  if (looksLikePath) {
    const file = path.resolve(request.cwd, command);
    if (await isExistingFile(file)) {
      const mapped = await mapScriptFile(file, args, resolve);
      return mapped.kind === 'ok' ? { ...mapped, shell: false, scriptFile: file } : mapped;
    }
  }
  return { kind: 'ok', file: command, args, shell: false, usesElectronAsNode: false };
};

const isExistingFile = async (file: string): Promise<boolean> => {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
};
