/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { VoiceSetupError, type VoiceAudio, type VoiceTranscriber } from './voice';

/**
 * Speech-to-text on this computer with Whisper in INT8 (faster-whisper, CPU), run as a sidecar process that is
 * started on the first voice message and stopped again after a quiet period, so its memory is not held all day.
 * The audio never leaves the machine. The model is read from a local folder and never downloaded by the app;
 * `scripts/setup-local-whisper.py` is the one step that downloads, and the user runs it.
 */

export type LocalWhisperSize = 'tiny' | 'base' | 'small' | 'medium';

export type LocalWhisperOptions = Readonly<{
  modelDir: string;
  scriptPath: string;
  pythonPath?: string;
  /** Spoken language as a Whisper code, for example `vi`. Unset lets the model detect it. */
  language?: string;
  /** Words the model should expect, such as application names; passed to Whisper as its initial prompt. */
  initialPrompt?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** The sidecar is stopped after this long without a request. */
  idleShutdownMs?: number;
  /** Where the audio is written for the sidecar to read; defaults to the system temporary folder. */
  tempRoot?: string;
}>;

type Pending = { resolve: (text: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

const SETUP_HINT =
  'Chưa cài Whisper cục bộ. Chạy một lần: python scripts/setup-local-whisper.py (tải khoảng 145 MB), rồi gửi lại tin nhắn thoại.';

/** Folders where a model of this size may be, in order of preference. */
export const localWhisperModelDirs = (size: LocalWhisperSize, userDataDir?: string): string[] => {
  const fromEnv = process.env.TOMNY_WHISPER_MODEL_DIR?.trim();
  return [
    ...(fromEnv ? [fromEnv] : []),
    ...(userDataDir ? [path.join(userDataDir, 'models', `whisper-${size}`)] : []),
    path.resolve(process.cwd(), 'resources', 'models', `whisper-${size}`),
  ];
};

export const findLocalWhisperModel = (size: LocalWhisperSize, userDataDir?: string): string | undefined =>
  localWhisperModelDirs(size, userDataDir).find((dir) => existsSync(path.join(dir, 'model.bin')));

const extensionFor = (audio: VoiceAudio): string => {
  const match = /\.([a-z0-9]{2,5})$/iu.exec(audio.filename);
  return match ? match[1].toLowerCase() : 'ogg';
};

/**
 * Rejects with `WHISPER_ABORTED` as soon as the signal fires, even while `work` is still pending. A listener added
 * only once the request is written would miss an abort that lands during file preparation or sidecar startup.
 */
const untilAborted = <T>(work: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(new Error('WHISPER_ABORTED'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('WHISPER_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

export class LocalWhisperSidecar {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();
  private idleTimer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: LocalWhisperOptions) {}

  private get startupTimeoutMs(): number {
    return this.options.startupTimeoutMs ?? 120_000;
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const ready = new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.options.pythonPath ?? 'python',
        [this.options.scriptPath, this.options.modelDir, this.options.language ?? ''],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } }
      );
      this.child = child;
      let settled = false;
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        if (error) {
          this.stop();
          reject(error);
        } else {
          resolve();
        }
      };
      const startupTimer = setTimeout(() => settle(new Error('WHISPER_STARTUP_TIMEOUT')), this.startupTimeoutMs);

      readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.status === 'ready') {
          settle();
          return;
        }
        if (message.status === 'startup_error') {
          const code = String(message.code ?? '');
          settle(
            code === 'MODEL_NOT_FOUND' || code === 'DEPENDENCY_MISSING'
              ? new VoiceSetupError(code, SETUP_HINT)
              : new Error(`WHISPER_${code || 'STARTUP_FAILED'}`)
          );
          return;
        }
        const id = typeof message.id === 'string' ? message.id : undefined;
        const request = id ? this.pending.get(id) : undefined;
        if (!id || !request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        if (message.status === 'ok') request.resolve(typeof message.text === 'string' ? message.text : '');
        else request.reject(new Error(`WHISPER_${String(message.code ?? 'FAILED')}`));
      });
      child.stderr.on('data', () => undefined);
      child.on('error', (error) => {
        const missingPython = (error as NodeJS.ErrnoException).code === 'ENOENT';
        settle(
          missingPython ? new VoiceSetupError('PYTHON_MISSING', 'Chưa tìm thấy Python để chạy Whisper cục bộ.') : error
        );
      });
      child.on('exit', (code) => {
        // A process that ends before it was ready is a failed start; one that ends later fails what it was doing.
        settle(new Error(`WHISPER_EXITED_${code ?? 'SIGNAL'}`));
        this.failAll(new Error(`WHISPER_EXITED_${code ?? 'SIGNAL'}`));
        this.child = null;
        this.ready = null;
      });
    });
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }

  private failAll(error: Error): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pending.delete(id);
    }
  }

  public stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.child;
    this.child = null;
    this.ready = null;
    try {
      child?.kill();
    } catch {
      /* already gone */
    }
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const delay = this.options.idleShutdownMs ?? 300_000;
    this.idleTimer = setTimeout(() => this.stop(), delay);
    this.idleTimer.unref?.();
  }

  /** One request at a time: the model is not shared between threads, and a queue keeps memory flat. */
  public transcribe(audio: VoiceAudio, signal?: AbortSignal): Promise<string> {
    const run = async (): Promise<string> => {
      if (signal?.aborted) throw new Error('WHISPER_ABORTED');
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const folder = await mkdtemp(path.join(this.options.tempRoot ?? tmpdir(), 'tomny-voice-'));
      try {
        const file = path.join(folder, `voice.${extensionFor(audio)}`);
        await writeFile(file, audio.bytes);
        // A sidecar that is still starting keeps starting; the idle timer stops it if nothing else needs it.
        await untilAborted(this.start(), signal);
        const child = this.child;
        if (!child?.stdin.writable) throw new Error('WHISPER_NOT_RUNNING');
        const id = randomUUID();
        return await new Promise<string>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('WHISPER_ABORTED'));
            return;
          }
          const timer = setTimeout(() => {
            this.pending.delete(id);
            // A request that overran may leave the model busy; a fresh process is the safe way out.
            this.stop();
            reject(new Error('WHISPER_REQUEST_TIMEOUT'));
          }, this.options.requestTimeoutMs ?? 60_000);
          const onAbort = (): void => {
            this.pending.delete(id);
            clearTimeout(timer);
            this.stop();
            reject(new Error('WHISPER_ABORTED'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          this.pending.set(id, {
            resolve: (text) => {
              signal?.removeEventListener('abort', onAbort);
              resolve(text);
            },
            reject: (error) => {
              signal?.removeEventListener('abort', onAbort);
              reject(error);
            },
            timer,
          });
          child.stdin.write(
            `${JSON.stringify({ id, action: 'transcribe', path: file, language: this.options.language ?? null, prompt: this.options.initialPrompt ?? null })}\n`
          );
        });
      } finally {
        await rm(folder, { recursive: true, force: true }).catch((): undefined => undefined);
        this.armIdleTimer();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch((): undefined => undefined);
    return result;
  }
}

/** A transcriber for the Telegram channel that runs Whisper on this computer. Call `stop` on app exit. */
export const createLocalWhisperTranscriber = (
  options: LocalWhisperOptions
): VoiceTranscriber & { stop: () => void } => {
  const sidecar = new LocalWhisperSidecar(options);
  const transcribe: VoiceTranscriber = (audio, signal) => sidecar.transcribe(audio, signal);
  return Object.assign(transcribe, { stop: () => sidecar.stop() });
};
