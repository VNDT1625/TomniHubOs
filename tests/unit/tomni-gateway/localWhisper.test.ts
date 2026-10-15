import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalWhisperTranscriber,
  findLocalWhisperModel,
  localWhisperModelDirs,
} from '@process/services/telegram/localWhisper';
import { VoiceSetupError } from '@process/services/telegram/voice';

/** A stand-in for scripts/whisper_sidecar.py; the mode is the "model directory" argument. */
const FAKE = String.raw`
const fs = require('node:fs');
const readline = require('node:readline');
const mode = process.argv[2];
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (mode === 'missing') { emit({ status: 'startup_error', code: 'MODEL_NOT_FOUND' }); process.exit(2); }
if (mode === 'nodep') { emit({ status: 'startup_error', code: 'DEPENDENCY_MISSING' }); process.exit(2); }
if (mode === 'loadfail') { emit({ status: 'startup_error', code: 'MODEL_LOAD_FAILED' }); process.exit(2); }
if (mode === 'silent') { setInterval(() => {}, 1000); return; }
emit({ status: 'ready' });
let handled = 0;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  handled += 1;
  if (mode === 'crash') process.exit(9);
  if (mode === 'hang') return;
  const reply = () => {
    if (!fs.existsSync(req.path)) return emit({ id: req.id, status: 'error', code: 'NO_AUDIO' });
    const body = fs.readFileSync(req.path, 'utf8');
    emit({ id: req.id, status: 'ok', text: body + '|' + req.language + '|' + process.pid + '|' + handled, started: Date.now() });
  };
  if (mode === 'slow') setTimeout(reply, 80); else reply();
});
`;

let root: string;
let script: string;

const make = (mode: string, extra: Record<string, unknown> = {}) =>
  createLocalWhisperTranscriber({
    modelDir: mode,
    scriptPath: script,
    pythonPath: process.execPath,
    language: 'vi',
    tempRoot: root,
    startupTimeoutMs: 3000,
    requestTimeoutMs: 3000,
    ...extra,
  });

const audio = (text: string, filename = 'voice.oga') => ({
  bytes: Buffer.from(text),
  filename,
  mimeType: 'audio/ogg',
  durationSeconds: 2,
});

const live: Array<{ stop: () => void }> = [];
const track = <T extends { stop: () => void }>(value: T): T => {
  live.push(value);
  return value;
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tomny-whisper-test-'));
  script = path.join(root, 'fake-sidecar.cjs');
  writeFileSync(script, FAKE);
});

afterEach(() => {
  for (const item of live.splice(0)) item.stop();
  rmSync(root, { recursive: true, force: true });
});

const leftovers = (): string[] => readdirSync(root).filter((name) => name.startsWith('tomny-voice-'));

describe('local Whisper sidecar', () => {
  it('sends the audio to the sidecar as a file and returns the text, then removes the file', async () => {
    const transcribe = track(make('ok'));
    const text = await transcribe(audio('xin chao'));
    expect(text.startsWith('xin chao|vi|')).toBe(true);
    expect(leftovers()).toEqual([]);
  });

  it('keeps one process for several messages and answers them one at a time', async () => {
    const transcribe = track(make('slow'));
    const results = await Promise.all([transcribe(audio('a')), transcribe(audio('b')), transcribe(audio('c'))]);
    const parts = results.map((entry) => entry.split('|'));
    expect(parts.map((p) => p[0])).toEqual(['a', 'b', 'c']);
    expect(new Set(parts.map((p) => p[2])).size).toBe(1);
    expect(parts.map((p) => p[3])).toEqual(['1', '2', '3']);
    expect(leftovers()).toEqual([]);
  });

  it.each([
    ['missing', 'MODEL_NOT_FOUND'],
    ['nodep', 'DEPENDENCY_MISSING'],
  ])('turns "%s" into a setup message for the user', async (mode, code) => {
    const transcribe = track(make(mode));
    const error = await transcribe(audio('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceSetupError);
    expect((error as VoiceSetupError).code).toBe(code);
    expect((error as VoiceSetupError).userMessage).toContain('setup-local-whisper.py');
    expect(leftovers()).toEqual([]);
  });

  it('reports a model that cannot be loaded as an ordinary failure', async () => {
    const transcribe = track(make('loadfail'));
    await expect(transcribe(audio('x'))).rejects.toThrow('WHISPER_MODEL_LOAD_FAILED');
  });

  it('reports a missing Python as a setup problem', async () => {
    const transcribe = track(make('ok', { pythonPath: path.join(root, 'no-such-python') }));
    const error = await transcribe(audio('x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceSetupError);
    expect((error as VoiceSetupError).code).toBe('PYTHON_MISSING');
  });

  it('gives up on a sidecar that never says it is ready', async () => {
    const transcribe = track(make('silent', { startupTimeoutMs: 150 }));
    await expect(transcribe(audio('x'))).rejects.toThrow('WHISPER_STARTUP_TIMEOUT');
    expect(leftovers()).toEqual([]);
  });

  it('fails the request when the sidecar dies, and starts a fresh one for the next message', async () => {
    const crashing = track(make('crash'));
    await expect(crashing(audio('x'))).rejects.toThrow(/WHISPER_EXITED_9/u);
    // The same wrapper may be used again; it must spawn again rather than stay broken.
    await expect(crashing(audio('y'))).rejects.toThrow(/WHISPER_EXITED_9/u);
    expect(leftovers()).toEqual([]);
  });

  it('stops waiting after the request timeout', async () => {
    const transcribe = track(make('hang', { requestTimeoutMs: 150 }));
    await expect(transcribe(audio('x'))).rejects.toThrow('WHISPER_REQUEST_TIMEOUT');
    expect(leftovers()).toEqual([]);
  });

  it('honours an abort signal, before and during the request', async () => {
    const early = new AbortController();
    early.abort();
    const transcribe = track(make('hang'));
    await expect(transcribe(audio('x'), early.signal)).rejects.toThrow('WHISPER_ABORTED');

    const late = new AbortController();
    const pending = transcribe(audio('y'), late.signal);
    setTimeout(() => late.abort(), 100);
    await expect(pending).rejects.toThrow('WHISPER_ABORTED');
    expect(leftovers()).toEqual([]);
  });

  it('honours an abort that arrives while the sidecar is still starting', async () => {
    // Under load the 100 ms abort above can land before the sidecar is ready; that window must abort too.
    const slowStart = path.join(root, 'slow-start.cjs');
    writeFileSync(
      slowStart,
      String.raw`setTimeout(() => {
  process.stdout.write(JSON.stringify({ status: 'ready' }) + '\n');
  require('node:readline').createInterface({ input: process.stdin }).on('line', () => {});
}, 1000);`
    );
    const transcribe = track(make('hang', { scriptPath: slowStart }));
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = transcribe(audio('x'), controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow('WHISPER_ABORTED');
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(leftovers()).toEqual([]);
  });

  it('shuts the process down after a quiet period and starts it again on demand', async () => {
    const transcribe = track(make('ok', { idleShutdownMs: 80 }));
    const first = (await transcribe(audio('a'))).split('|');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const second = (await transcribe(audio('b'))).split('|');
    expect(second[2]).not.toBe(first[2]);
    expect(second[3]).toBe('1');
  });

  it('keeps the file extension the audio came with', async () => {
    const transcribe = track(make('ok'));
    // The sidecar reads the file by path; a name without an extension must still work.
    await expect(transcribe(audio('z', 'voice'))).resolves.toMatch(/^z\|/u);
    await expect(transcribe(audio('w', 'voice.mp3'))).resolves.toMatch(/^w\|/u);
  });
});

describe('where the model is looked for', () => {
  const saved = process.env.TOMNY_WHISPER_MODEL_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.TOMNY_WHISPER_MODEL_DIR;
    else process.env.TOMNY_WHISPER_MODEL_DIR = saved;
  });

  it('prefers the folder from the environment, then user data, then the app resources', () => {
    process.env.TOMNY_WHISPER_MODEL_DIR = '/custom/model';
    const dirs = localWhisperModelDirs('base', '/data');
    expect(dirs[0]).toBe('/custom/model');
    expect(dirs[1]).toBe(path.join('/data', 'models', 'whisper-base'));
    expect(dirs[2]).toContain(path.join('resources', 'models', 'whisper-base'));
  });

  it('returns only a folder that really holds model.bin', () => {
    const data = mkdtempSync(path.join(root, 'data-'));
    delete process.env.TOMNY_WHISPER_MODEL_DIR;
    expect(findLocalWhisperModel('tiny', data)).toBeUndefined();
    const folder = path.join(data, 'models', 'whisper-tiny');
    process.env.TOMNY_WHISPER_MODEL_DIR = folder;
    expect(findLocalWhisperModel('tiny', data)).toBeUndefined();
    rmSync(folder, { recursive: true, force: true });
    writeFileSync(path.join(root, 'model.bin'), 'x');
    process.env.TOMNY_WHISPER_MODEL_DIR = root;
    expect(findLocalWhisperModel('tiny', data)).toBe(root);
    expect(existsSync(path.join(root, 'model.bin'))).toBe(true);
  });
});
