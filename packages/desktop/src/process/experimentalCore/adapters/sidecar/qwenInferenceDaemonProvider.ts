/**
 * Legacy experimental NDJSON client for the local Qwen daemon.
 * @deprecated Superceded by Laya Decision Engine (layaSemanticEgressModel.ts / layaSecurityStage.ts).
 * Kept strictly for backward compatibility with older experimental test suites.
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ModelPackBaseBinding, ModelPackRegistryRecord } from '../../catalog/modelPackTypes';
import type {
  AdapterSlotPreparation,
  CoreModelProviderOutput,
  CoreModelRequest,
  LocalInferenceProvider,
} from './localInferenceBroker';
import type { LoadedBase } from './localInferenceRuntimeRouter';
const MAX_LINE_BYTES = 1_048_576;
const MAX_REQUEST_BYTES = 262_144;
type DaemonResponse = { id: string; ok: boolean; result?: unknown; error?: { code?: string; message?: string } };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export type QwenInferenceDaemonConfig = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  baseRoot: string;
  baseBinding: ModelPackBaseBinding;
  adapterRoot: string;
  requestTimeoutMs?: number;
}>;
export class QwenInferenceDaemonProvider implements LocalInferenceProvider {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = '';
  private loaded: LoadedBase | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly requestTimeoutMs: number;
  public constructor(private readonly config: QwenInferenceDaemonConfig) {
    if (!config.command.trim() || !path.isAbsolute(config.baseRoot) || !path.isAbsolute(config.adapterRoot)) {
      throw new Error('Qwen daemon requires explicit absolute command roots.');
    }
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
  }
  public async getLoadedBase(): Promise<LoadedBase | undefined> {
    return this.loaded ? structuredClone(this.loaded) : undefined;
  }
  public async loadBase(base: LoadedBase, signal: AbortSignal): Promise<void> {
    if (!sameBinding(base.binding, this.config.baseBinding)) throw new Error('QWEN_BASE_BINDING_MISMATCH');
    if ((await hashTree(this.config.baseRoot)) !== base.binding.sha256) throw new Error('QWEN_BASE_HASH_MISMATCH');
    await this.request('base.load', { base: { root: this.config.baseRoot, binding: base.binding } }, signal);
    this.loaded = structuredClone(base);
  }
  public async unloadBase(base: LoadedBase, signal: AbortSignal): Promise<void> {
    if (!this.loaded || !sameBinding(this.loaded.binding, base.binding)) return;
    await this.request('base.unload', {}, signal).catch((): void => undefined);
    this.loaded = undefined;
  }
  public async prepareAdapter(
    record: ModelPackRegistryRecord,
    base: LoadedBase,
    signal: AbortSignal
  ): Promise<AdapterSlotPreparation> {
    try {
      const adapterPath = await this.verifyAdapter(record, base);
      const result = await this.request(
        'adapter.prepare',
        {
          adapter: {
            path: adapterPath,
            id: record.manifest.id,
            version: record.manifest.version,
            files: record.manifest.files,
          },
          base: base.binding,
        },
        signal
      );
      if (
        !isObject(result) ||
        typeof result.slotId !== 'string' ||
        !Number.isInteger(result.rank) ||
        !Number.isInteger(result.alpha)
      ) {
        return {
          compatible: false,
          code: 'runtime-incompatible',
          reason: 'Daemon adapter preparation response is malformed.',
        };
      }
      return {
        compatible: true,
        slotId: result.slotId,
        rank: Number(result.rank),
        alpha: Number(result.alpha),
        poolId: base.poolId,
        baseSha256: base.binding.sha256,
      };
    } catch {
      return { compatible: false, code: 'load-failed', reason: 'Daemon refused the adapter binding.' };
    }
  }
  public async infer(
    request: CoreModelRequest,
    record: ModelPackRegistryRecord,
    slot: Extract<AdapterSlotPreparation, { compatible: true }>,
    signal: AbortSignal
  ): Promise<CoreModelProviderOutput> {
    if (!this.loaded || slot.baseSha256 !== this.loaded.binding.sha256) throw new Error('QWEN_DAEMON_BASE_UNAVAILABLE');
    const result = await this.request(
      'infer',
      {
        request: {
          id: request.requestId,
          purpose: request.purpose,
          contractVersion: request.contractVersion,
          payload: request.payload,
        },
        adapter: { id: record.manifest.id, version: record.manifest.version, slotId: slot.slotId },
      },
      signal
    );
    if (!isObject(result) || !('value' in result)) throw new Error('QWEN_DAEMON_INVALID_RESULT');
    return { value: result.value, ...(typeof result.latencyMs === 'number' ? { latencyMs: result.latencyMs } : {}) };
  }
  public async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.loaded = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('QWEN_DAEMON_STOPPED'));
    }
    this.pending.clear();
    child?.kill();
  }
  private async verifyAdapter(record: ModelPackRegistryRecord, base: LoadedBase): Promise<string> {
    if (!record.installedPath || !sameBinding(record.manifest.baseModel, base.binding))
      throw new Error('QWEN_ADAPTER_BASE_MISMATCH');
    const root = await realpath(this.config.adapterRoot);
    const candidate = await realpath(record.installedPath);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error('QWEN_ADAPTER_PATH_ESCAPE');
    for (const file of record.manifest.files) {
      if (path.isAbsolute(file.path) || file.path.split(/[\\/]/u).includes('..'))
        throw new Error('QWEN_ADAPTER_PATH_UNSAFE');
      const target = path.join(candidate, file.path);
      const details = await stat(target);
      if (!details.isFile() || details.size !== file.size || (await hashFile(target)) !== file.sha256)
        throw new Error('QWEN_ADAPTER_HASH_MISMATCH');
    }
    return candidate;
  }
  private async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error('QWEN_DAEMON_CANCELLED');
    const child = await this.start();
    const id = randomUUID();
    const message = JSON.stringify({ id, method, params });
    if (Buffer.byteLength(message) > MAX_REQUEST_BYTES) throw new Error('QWEN_DAEMON_REQUEST_TOO_LARGE');
    return new Promise<unknown>((resolve, reject) => {
      const cancelAndRestart = (code: 'QWEN_DAEMON_TIMEOUT' | 'QWEN_DAEMON_CANCELLED'): void => {
        this.pending.delete(id);
        child.stdin.write(`${JSON.stringify({ id: randomUUID(), method: 'cancel', params: { requestId: id } })}\n`);
        // Transformers generation is synchronous; terminate the child so cancellation
        // never leaves a timed-out request consuming the sole local worker.
        void this.stop();
        reject(new Error(code));
      };
      const timer = setTimeout(() => cancelAndRestart('QWEN_DAEMON_TIMEOUT'), this.requestTimeoutMs);
      const abort = (): void => {
        clearTimeout(timer);
        cancelAndRestart('QWEN_DAEMON_CANCELLED');
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          signal.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
        timer,
      });
      child.stdin.write(`${message}\n`);
    });
  }
  private async start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child && !this.child.killed) return this.child;
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'])
      if (process.env[key]) env[key] = process.env[key];
    env.PYTHONUTF8 = '1';
    const child = spawn(
      this.config.command,
      [...this.config.args, '--base-root', this.config.baseRoot, '--adapter-root', this.config.adapterRoot],
      { cwd: this.config.cwd, env, shell: false, stdio: 'pipe', windowsHide: true }
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receive(chunk));
    child.on('exit', () => this.failAll(new Error('QWEN_DAEMON_EXITED')));
    child.on('error', (error) => this.failAll(error));
    this.child = child;
    return child;
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES)
      return this.failAll(new Error('QWEN_DAEMON_RESPONSE_TOO_LARGE'));
    for (;;) {
      const end = this.buffer.indexOf('\n');
      if (end < 0) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let response: DaemonResponse;
      try {
        response = JSON.parse(line) as DaemonResponse;
      } catch {
        this.failAll(new Error('QWEN_DAEMON_PROTOCOL'));
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error(response.error?.code ?? response.error?.message ?? 'QWEN_DAEMON_ERROR'));
      }
    }
  }
  private failAll(error: Error): void {
    this.child = undefined;
    this.loaded = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const sameBinding = (left: ModelPackBaseBinding, right: ModelPackBaseBinding): boolean =>
  left.id === right.id && left.revision === right.revision && left.sha256 === right.sha256;
const hashFile = async (file: string): Promise<string> =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const hashTree = async (root: string): Promise<string> => {
  const walk = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths = await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : entry.isFile()
            ? [path.join(directory, entry.name)]
            : []
      )
    );
    return paths.flat();
  };
  const digest = createHash('sha256');
  for (const file of (await walk(root)).sort()) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const bytes = Buffer.from(relative, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    digest
      .update(length)
      .update(bytes)
      .update(Buffer.from(await hashFile(file), 'hex'));
  }
  return digest.digest('hex');
};
