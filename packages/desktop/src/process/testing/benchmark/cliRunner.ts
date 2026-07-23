/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BenchmarkTokenUsage } from '@/common/types/benchmark';
import { execFile, spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TURN_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const VERSION_TIMEOUT_MS = 5_000;
const VERSION_MAX_OUTPUT_BYTES = 64 * 1024;

export type NativeCliId = 'claude' | 'codex';

export type NativeCliProbeResult = {
  runnerId: NativeCliId;
  available: boolean;
  executable: string | null;
  version: string | null;
  detail: string;
  models: NativeCliModelOption[];
  defaultModel?: string;
};

export type NativeCliModelOption = {
  key: string;
  label: string;
  isDefault: boolean;
  model?: string;
  reasoningEffort?: string;
};

export type NativeCliTurnOptions = {
  runnerId: NativeCliId;
  workspace: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  previousSessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type NativeCliTurnResult = {
  sessionId: string;
  response: string;
  startedAt: number;
  durationMs: number;
  firstTokenMs: number | null;
  modelRequests: number;
  toolCalls: number;
  toolFailures: number;
  usage: BenchmarkTokenUsage;
  rawOutput: string;
};

export type NativeCliSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcessWithoutNullStreams;

export type NativeCliExecutableResolver = (runnerId: NativeCliId) => Promise<string | null>;

export type NativeCliRunnerDependencies = {
  spawnProcess?: NativeCliSpawn;
  resolveExecutable?: NativeCliExecutableResolver;
  createSessionId?: () => string;
  now?: () => number;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: () => string;
  readTextFile?: (filePath: string) => Promise<string>;
};

type JsonObject = Record<string, unknown>;

type TimedJsonEvent = {
  value: JsonObject;
  receivedAt: number;
};

type CapturedProcess = {
  stdout: string;
  stderr: string;
  events: TimedJsonEvent[];
  startedAt: number;
  durationMs: number;
};

type CaptureOptions = {
  executable: string;
  args: string[];
  cwd: string;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
};

type ReportedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  totalTokens: number | null;
  cacheCreationInputTokens: number | null;
};

type ToolMetrics = {
  calls: number;
  failures: number;
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objectValue = (record: JsonObject, key: string): JsonObject | undefined => {
  const value = record[key];
  return isObject(value) ? value : undefined;
};

const stringValue = (record: JsonObject | undefined, keys: readonly string[]): string | undefined => {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
};

const numberValue = (record: JsonObject | undefined, keys: readonly string[]): number | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
};

const countValue = (record: JsonObject | undefined, keys: readonly string[]): number | null => {
  const value = numberValue(record, keys);
  return value === null ? null : Math.trunc(value);
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const abortError = (message: string): Error => Object.assign(new Error(message), { name: 'AbortError' });

const timeoutError = (message: string): Error => Object.assign(new Error(message), { name: 'TimeoutError' });

const outputLimitError = (message: string): Error => Object.assign(new Error(message), { name: 'OutputLimitError' });

const defaultSpawn: NativeCliSpawn = (command, args, options) =>
  spawn(command, [...args], options) as ChildProcessWithoutNullStreams;

const runnerLabel = (runnerId: NativeCliId): string => (runnerId === 'claude' ? 'Claude CLI' : 'Codex CLI');

const readUtf8 = (filePath: string): Promise<string> => readFile(filePath, 'utf8');

const deduplicateModels = (models: NativeCliModelOption[]): NativeCliModelOption[] => {
  const seen = new Set<string>();
  return models.filter((model) => {
    const normalized = model.key.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

type ClaudeConfiguration = {
  defaultModel?: string;
  defaultEffort: string;
  aliases: Record<'opus' | 'sonnet' | 'haiku', string | undefined>;
};

const configuredClaude = async (dependencies: NativeCliRunnerDependencies): Promise<ClaudeConfiguration> => {
  const runtimeEnv = dependencies.env ?? process.env;
  const homeDirectory = (dependencies.homeDirectory ?? homedir)();
  const readTextFile = dependencies.readTextFile ?? readUtf8;
  let settings: JsonObject | undefined;
  try {
    const parsed: unknown = JSON.parse(await readTextFile(path.join(homeDirectory, '.claude', 'settings.json')));
    if (isObject(parsed)) settings = parsed;
  } catch {
    // Claude settings are optional; the CLI aliases remain valid choices.
  }
  const settingsEnv = objectValue(settings ?? {}, 'env');
  const configuredEffort = stringValue(settings, ['effortLevel']);
  return {
    defaultModel:
      runtimeEnv.ANTHROPIC_MODEL?.trim() ||
      stringValue(settingsEnv, ['ANTHROPIC_MODEL']) ||
      stringValue(settings, ['model']),
    defaultEffort: CLAUDE_EFFORTS.includes(configuredEffort as (typeof CLAUDE_EFFORTS)[number])
      ? (configuredEffort as string)
      : 'medium',
    aliases: {
      opus:
        runtimeEnv.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() || stringValue(settingsEnv, ['ANTHROPIC_DEFAULT_OPUS_MODEL']),
      sonnet:
        runtimeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() ||
        stringValue(settingsEnv, ['ANTHROPIC_DEFAULT_SONNET_MODEL']),
      haiku:
        runtimeEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() || stringValue(settingsEnv, ['ANTHROPIC_DEFAULT_HAIKU_MODEL']),
    },
  };
};

const claudeModels = async (
  dependencies: NativeCliRunnerDependencies
): Promise<{ models: NativeCliModelOption[]; defaultModel?: string }> => {
  const configured = await configuredClaude(dependencies);
  const aliasTargets = Object.values(configured.aliases).filter((value): value is string => Boolean(value));
  const sharedAliasTarget = aliasTargets.length > 0 && new Set(aliasTargets).size === 1 ? aliasTargets[0] : undefined;
  const resolvedDefault = configured.defaultModel ?? sharedAliasTarget;
  const logicalModels: Array<{ key: 'default' | 'opus' | 'sonnet' | 'haiku'; label: string; resolved?: string }> = [
    { key: 'default', label: 'Default', resolved: resolvedDefault },
    { key: 'opus', label: 'Opus', resolved: configured.aliases.opus },
    { key: 'sonnet', label: 'Sonnet', resolved: configured.aliases.sonnet },
    { key: 'haiku', label: 'Haiku', resolved: configured.aliases.haiku },
  ];
  const models = logicalModels.flatMap((choice) =>
    CLAUDE_EFFORTS.map((reasoningEffort) => {
      const option: NativeCliModelOption = {
        key: `${choice.key}::${reasoningEffort}`,
        label: `${choice.label}${choice.resolved ? ` → ${choice.resolved}` : ''} (${reasoningEffort})`,
        isDefault: choice.key === 'default' && reasoningEffort === configured.defaultEffort,
        reasoningEffort,
      };
      if (choice.key !== 'default') option.model = choice.key;
      else if (choice.resolved) option.model = choice.resolved;
      return option;
    })
  );
  return { models, ...(resolvedDefault ? { defaultModel: resolvedDefault } : {}) };
};

const codexConfigValue = (config: string, key: string): string | undefined => {
  const lines = config.split(/\r?\n/u);
  const firstTable = lines.findIndex((line) => /^\s*\[/u.test(line));
  const rootConfig = lines.slice(0, firstTable < 0 ? lines.length : firstTable).join('\n');
  const match = rootConfig.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'mu'));
  return match?.[1]?.trim() || undefined;
};

const codexModels = async (
  dependencies: NativeCliRunnerDependencies
): Promise<{ models: NativeCliModelOption[]; defaultModel?: string }> => {
  const homeDirectory = (dependencies.homeDirectory ?? homedir)();
  const readTextFile = dependencies.readTextFile ?? readUtf8;
  const codexDirectory = path.join(homeDirectory, '.codex');
  let defaultModel: string | undefined;
  let configuredEffort: string | undefined;
  let cachedModels: NativeCliModelOption[] = [];

  try {
    const config = await readTextFile(path.join(codexDirectory, 'config.toml'));
    defaultModel = codexConfigValue(config, 'model');
    configuredEffort = codexConfigValue(config, 'model_reasoning_effort');
  } catch {
    // Codex can run without an explicit model in config.toml.
  }

  try {
    const parsed: unknown = JSON.parse(await readTextFile(path.join(codexDirectory, 'models_cache.json')));
    if (isObject(parsed) && Array.isArray(parsed.models)) {
      cachedModels = parsed.models
        .filter(isObject)
        .filter((model) => model.visibility !== 'hide')
        .flatMap((model): NativeCliModelOption[] => {
          const modelKey = stringValue(model, ['slug', 'id', 'model']);
          if (!modelKey) return [];
          const label = stringValue(model, ['display_name', 'name']) ?? modelKey;
          const supported = Array.isArray(model.supported_reasoning_levels)
            ? model.supported_reasoning_levels
                .filter(isObject)
                .map((level) => stringValue(level, ['effort']))
                .filter((effort): effort is string => Boolean(effort))
            : [];
          const modelDefaultEffort = stringValue(model, ['default_reasoning_level']);
          const efforts = supported.length > 0 ? supported : modelDefaultEffort ? [modelDefaultEffort] : [];
          if (efforts.length === 0) {
            return [{ key: modelKey, label, isDefault: modelKey === defaultModel, model: modelKey }];
          }
          return efforts.map((reasoningEffort) => ({
            key: `${modelKey}::${reasoningEffort}`,
            label: `${label} (${reasoningEffort})`,
            isDefault:
              modelKey === defaultModel &&
              reasoningEffort === (configuredEffort ?? modelDefaultEffort ?? reasoningEffort),
            model: modelKey,
            reasoningEffort,
          }));
        });
    }
  } catch {
    // The cache is best-effort and may not exist before Codex has refreshed it.
  }

  const models = deduplicateModels([
    ...(defaultModel && !cachedModels.some((model) => model.model === defaultModel)
      ? [
          {
            key: `${defaultModel}::${configuredEffort ?? 'default'}`,
            label: `${defaultModel}${configuredEffort ? ` (${configuredEffort})` : ''}`,
            isDefault: true,
            model: defaultModel,
            ...(configuredEffort ? { reasoningEffort: configuredEffort } : {}),
          },
        ]
      : []),
    ...cachedModels,
  ]);
  return { models, ...(defaultModel ? { defaultModel } : {}) };
};

const discoverNativeCliModels = async (
  runnerId: NativeCliId,
  dependencies: NativeCliRunnerDependencies
): Promise<{ models: NativeCliModelOption[]; defaultModel?: string }> => {
  if (runnerId === 'claude') {
    return claudeModels(dependencies);
  }
  return codexModels(dependencies);
};

const resolveExecutableOnPath = async (
  runnerId: NativeCliId,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> => {
  const probe = platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(probe, [runnerId], {
      encoding: 'utf8',
      timeout: 2_500,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    const paths = String(stdout)
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
    if (platform !== 'win32') return paths[0] ?? null;

    return (
      paths.find((value) => /\.exe$/iu.test(value) && !/[\\/]WindowsApps[\\/]/iu.test(value)) ??
      paths.find((value) => /\.exe$/iu.test(value)) ??
      paths.find((value) => /\.cmd$/iu.test(value)) ??
      paths.find((value) => !/\.ps1$/iu.test(value)) ??
      null
    );
  } catch {
    return null;
  }
};

const quoteCmdArgument = (value: string): string => `"${value.replace(/"/gu, '""')}"`;

const spawnTarget = (
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } => {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(executable)) {
    return { command: executable, args: [...args] };
  }

  // Node cannot CreateProcess a batch shim directly. Keep shell mode disabled
  // and invoke the trusted shim explicitly through cmd.exe with quoted values.
  const commandLine = [executable, ...args].map(quoteCmdArgument).join(' ');
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
    windowsVerbatimArguments: true,
  };
};

const createJsonlCollector = (): {
  events: TimedJsonEvent[];
  write: (chunk: Buffer, receivedAt: number) => void;
  finish: (receivedAt: number) => void;
} => {
  const decoder = new StringDecoder('utf8');
  const events: TimedJsonEvent[] = [];
  let pending = '';

  const parseLine = (line: string, receivedAt: number): void => {
    const normalized = line.trim();
    if (!normalized) return;
    try {
      const value: unknown = JSON.parse(normalized);
      if (isObject(value)) events.push({ value, receivedAt });
    } catch {
      // Native CLIs can emit diagnostics among JSONL records. Preserve them in
      // rawOutput, but do not let one malformed line discard later events.
    }
  };

  const drain = (receivedAt: number): void => {
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      parseLine(pending.slice(0, newline).replace(/\r$/u, ''), receivedAt);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  };

  return {
    events,
    write: (chunk, receivedAt) => {
      pending += decoder.write(chunk);
      drain(receivedAt);
    },
    finish: (receivedAt) => {
      pending += decoder.end();
      drain(receivedAt);
      parseLine(pending, receivedAt);
      pending = '';
    },
  };
};

const captureProcess = (
  options: CaptureOptions,
  dependencies: NativeCliRunnerDependencies
): Promise<CapturedProcess> => {
  const now = dependencies.now ?? Date.now;
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const spawnProcess = dependencies.spawnProcess ?? defaultSpawn;

  return new Promise<CapturedProcess>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(`${options.executable} run was aborted before it started.`));
      return;
    }

    const target = spawnTarget(options.executable, options.args, platform, env);
    const startedAt = now();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess(target.command, target.args, {
        cwd: options.cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: target.windowsVerbatimArguments,
      });
    } catch (error) {
      reject(new Error(`Failed to start ${options.executable}: ${errorMessage(error)}`));
      return;
    }

    const collector = createJsonlCollector();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let settled = false;
    let stdinFailure: Error | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const safeKill = (): void => {
      try {
        child.kill();
      } catch {
        // The process may already have exited between the event and cleanup.
      }
    };

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.stdin.off('error', onStdinError);
      child.off('error', onProcessError);
      child.off('close', onClose);
    };

    const fail = (error: Error, terminate = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminate) safeKill();
      reject(error);
    };

    const appendChunk = (targetChunks: Buffer[], chunk: Buffer, isStdout: boolean): void => {
      const remaining = options.maxOutputBytes - capturedBytes;
      if (remaining <= 0 || chunk.byteLength > remaining) {
        if (remaining > 0) {
          const prefix = chunk.subarray(0, remaining);
          targetChunks.push(prefix);
          capturedBytes += prefix.byteLength;
          if (isStdout) collector.write(prefix, now());
        }
        fail(
          outputLimitError(`${options.executable} exceeded the ${options.maxOutputBytes}-byte combined output limit.`),
          true
        );
        return;
      }
      targetChunks.push(chunk);
      capturedBytes += chunk.byteLength;
      if (isStdout) collector.write(chunk, now());
    };

    function onStdout(value: Buffer | string): void {
      appendChunk(stdoutChunks, Buffer.isBuffer(value) ? value : Buffer.from(value), true);
    }

    function onStderr(value: Buffer | string): void {
      appendChunk(stderrChunks, Buffer.isBuffer(value) ? value : Buffer.from(value), false);
    }

    function onStdinError(error: Error): void {
      stdinFailure = error;
    }

    function onAbort(): void {
      fail(abortError(`${options.executable} run was aborted.`), true);
    }

    function onProcessError(error: Error): void {
      fail(new Error(`Failed to run ${options.executable}: ${error.message}`));
    }

    function onClose(code: number | null, signal: NodeJS.Signals | null): void {
      if (settled) return;
      const finishedAt = now();
      collector.finish(finishedAt);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        const diagnostic = stderr.trim().slice(-3_000);
        fail(
          new Error(
            `${options.executable} exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}${
              diagnostic ? `: ${diagnostic}` : ''
            }`
          )
        );
        return;
      }
      if (stdinFailure) {
        fail(new Error(`Failed to send the prompt to ${options.executable}: ${stdinFailure.message}`));
        return;
      }

      settled = true;
      cleanup();
      resolve({
        stdout,
        stderr,
        events: collector.events,
        startedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
      });
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.stdin.on('error', onStdinError);
    child.once('error', onProcessError);
    child.once('close', onClose);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () => fail(timeoutError(`${options.executable} timed out after ${options.timeoutMs} ms.`), true),
      options.timeoutMs
    );
    if (options.stdin === undefined) child.stdin.end();
    else child.stdin.end(options.stdin, 'utf8');
  });
};

const textFromContent = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((block) => {
      if (!isObject(block)) return '';
      const type = stringValue(block, ['type']);
      if (type && !['text', 'output_text', 'input_text'].includes(type)) return '';
      return stringValue(block, ['text', 'output_text']) ?? '';
    })
    .join('');
};

const claudeResponse = (events: readonly TimedJsonEvent[]): string => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = events[index].value;
    if (record.type === 'result') {
      const result = record.result;
      if (typeof result === 'string' && result.trim()) return result;
    }
    if (record.type === 'assistant') {
      const message = objectValue(record, 'message');
      const text = textFromContent(message?.content ?? record.content);
      if (text.trim()) return text;
    }
  }
  return '';
};

const codexResponse = (events: readonly TimedJsonEvent[]): string => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = events[index].value;
    const item = objectValue(record, 'item');
    const itemType = stringValue(item, ['type']);
    if (item && ['agent_message', 'assistant_message', 'message'].includes(itemType ?? '')) {
      const text = stringValue(item, ['text', 'output_text']) ?? textFromContent(item.content);
      if (text.trim()) return text;
    }
    if (record.type === 'result' && typeof record.result === 'string' && record.result.trim()) {
      return record.result;
    }
    if (record.type === 'message' && (record.role === 'assistant' || !record.role)) {
      const text = stringValue(record, ['text', 'output_text']) ?? textFromContent(record.content);
      if (text.trim()) return text;
    }
  }
  return '';
};

const extractSessionId = (runnerId: NativeCliId, events: readonly TimedJsonEvent[], fallback?: string): string => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = events[index].value;
    const direct =
      runnerId === 'claude'
        ? stringValue(record, ['session_id', 'sessionId'])
        : stringValue(record, ['thread_id', 'threadId']);
    if (direct) return direct;
    if (runnerId === 'codex') {
      const nested = stringValue(objectValue(record, 'thread'), ['id', 'thread_id', 'threadId']);
      if (nested) return nested;
    }
  }
  if (fallback?.trim()) return fallback.trim();
  throw new Error(`${runnerLabel(runnerId)} completed without reporting a continuation id.`);
};

const emptyReportedUsage = (): ReportedUsage => ({
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  totalTokens: null,
  cacheCreationInputTokens: null,
});

const usageFromObject = (record: JsonObject | undefined): ReportedUsage => ({
  inputTokens: numberValue(record, ['input_tokens', 'inputTokens']),
  outputTokens: numberValue(record, ['output_tokens', 'outputTokens']),
  cachedInputTokens: numberValue(record, [
    'cached_input_tokens',
    'cachedInputTokens',
    'cache_read_input_tokens',
    'cacheReadInputTokens',
  ]),
  totalTokens: numberValue(record, ['total_tokens', 'totalTokens']),
  cacheCreationInputTokens: numberValue(record, ['cache_creation_input_tokens', 'cacheCreationInputTokens']),
});

const mergeUsage = (preferred: ReportedUsage, fallback: ReportedUsage): ReportedUsage => ({
  inputTokens: preferred.inputTokens ?? fallback.inputTokens,
  outputTokens: preferred.outputTokens ?? fallback.outputTokens,
  cachedInputTokens: preferred.cachedInputTokens ?? fallback.cachedInputTokens,
  totalTokens: preferred.totalTokens ?? fallback.totalTokens,
  cacheCreationInputTokens: preferred.cacheCreationInputTokens ?? fallback.cacheCreationInputTokens,
});

const sumUsage = (values: readonly ReportedUsage[]): ReportedUsage => {
  if (values.length === 0) return emptyReportedUsage();
  const sumField = (field: keyof ReportedUsage): number | null => {
    const numbers = values.map((value) => value[field]);
    return numbers.every((value): value is number => value !== null)
      ? numbers.reduce((total, value) => total + value, 0)
      : null;
  };
  return {
    inputTokens: sumField('inputTokens'),
    outputTokens: sumField('outputTokens'),
    cachedInputTokens: sumField('cachedInputTokens'),
    totalTokens: sumField('totalTokens'),
    cacheCreationInputTokens: sumField('cacheCreationInputTokens'),
  };
};

const claudeModelUsage = (record: JsonObject): ReportedUsage => {
  const modelUsage = objectValue(record, 'modelUsage') ?? objectValue(record, 'model_usage');
  if (!modelUsage) return emptyReportedUsage();
  return sumUsage(Object.values(modelUsage).filter(isObject).map(usageFromObject));
};

const claudeAssistantUsage = (events: readonly TimedJsonEvent[]): ReportedUsage => {
  const byMessage = new Map<string, ReportedUsage>();
  let anonymous = 0;
  for (const event of events) {
    if (event.value.type !== 'assistant') continue;
    const message = objectValue(event.value, 'message');
    const usage = usageFromObject(objectValue(message ?? event.value, 'usage'));
    const id = stringValue(message, ['id']) ?? `anonymous-${anonymous++}`;
    byMessage.set(id, usage);
  }
  return sumUsage([...byMessage.values()]);
};

const reportedUsage = (runnerId: NativeCliId, events: readonly TimedJsonEvent[]): BenchmarkTokenUsage => {
  let usage = emptyReportedUsage();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = events[index].value;
    const isTerminalUsage = runnerId === 'claude' ? record.type === 'result' : record.type === 'turn.completed';
    if (!isTerminalUsage) continue;
    usage = usageFromObject(objectValue(record, 'usage'));
    if (runnerId === 'claude') usage = mergeUsage(usage, claudeModelUsage(record));
    break;
  }

  if (runnerId === 'claude') usage = mergeUsage(usage, claudeAssistantUsage(events));
  if (usage.totalTokens === null) {
    if (runnerId === 'codex' && usage.inputTokens !== null && usage.outputTokens !== null) {
      usage.totalTokens = usage.inputTokens + usage.outputTokens;
    } else if (
      runnerId === 'claude' &&
      usage.inputTokens !== null &&
      usage.outputTokens !== null &&
      usage.cachedInputTokens !== null &&
      usage.cacheCreationInputTokens !== null
    ) {
      usage.totalTokens =
        usage.inputTokens + usage.outputTokens + usage.cachedInputTokens + usage.cacheCreationInputTokens;
    }
  }

  const hasReportedValue = [usage.inputTokens, usage.outputTokens, usage.cachedInputTokens, usage.totalTokens].some(
    (value) => value !== null
  );
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    totalTokens: usage.totalTokens,
    source: hasReportedValue ? 'reported' : 'unavailable',
  };
};

const assistantBlocks = (record: JsonObject): JsonObject[] => {
  const message = objectValue(record, 'message');
  const content = message?.content ?? record.content;
  return Array.isArray(content) ? content.filter(isObject) : [];
};

const hasFailureStatus = (record: JsonObject): boolean => {
  const status = stringValue(record, ['status', 'state'])?.toLowerCase();
  if (status && ['error', 'failed', 'failure', 'denied'].includes(status)) return true;
  if (record.is_error === true || record.isError === true) return true;
  const error = record.error;
  return typeof error === 'string' ? error.trim().length > 0 : isObject(error);
};

const claudeToolMetrics = (events: readonly TimedJsonEvent[]): ToolMetrics => {
  const calls = new Set<string>();
  const failures = new Set<string>();
  let anonymousCall = 0;
  let anonymousFailure = 0;

  for (const event of events) {
    const record = event.value;
    if (record.type === 'assistant') {
      for (const block of assistantBlocks(record)) {
        if (!['tool_use', 'server_tool_use'].includes(stringValue(block, ['type']) ?? '')) continue;
        calls.add(stringValue(block, ['id', 'tool_use_id']) ?? `anonymous-call-${anonymousCall++}`);
      }
    }
    if (record.type === 'user') {
      for (const block of assistantBlocks(record)) {
        if (stringValue(block, ['type']) !== 'tool_result' || !hasFailureStatus(block)) continue;
        failures.add(
          stringValue(block, ['tool_use_id', 'toolUseId', 'id']) ?? `anonymous-failure-${anonymousFailure++}`
        );
      }
    }
    if (record.type === 'result' && Array.isArray(record.permission_denials)) {
      for (const denial of record.permission_denials.filter(isObject)) {
        failures.add(
          stringValue(denial, ['tool_use_id', 'toolUseId', 'id']) ?? `anonymous-failure-${anonymousFailure++}`
        );
      }
    }
  }
  return { calls: calls.size, failures: failures.size };
};

const CODEX_TOOL_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'tool_call',
  'dynamic_tool_call',
  'web_search',
]);

const codexToolMetrics = (events: readonly TimedJsonEvent[]): ToolMetrics => {
  const calls = new Set<string>();
  const failures = new Set<string>();
  let anonymous = 0;

  for (const event of events) {
    const record = event.value;
    const item = objectValue(record, 'item');
    const itemType = stringValue(item, ['type']);
    if (!item || !CODEX_TOOL_ITEM_TYPES.has(itemType ?? '')) continue;
    const key = stringValue(item, ['id', 'call_id', 'callId']) ?? `${itemType}-${anonymous++}`;
    calls.add(key);
    const exitCode = numberValue(item, ['exit_code', 'exitCode']);
    const result = objectValue(item, 'result');
    if (hasFailureStatus(item) || (exitCode !== null && exitCode !== 0) || (result && hasFailureStatus(result))) {
      failures.add(key);
    }
  }
  return { calls: calls.size, failures: failures.size };
};

const explicitModelRequests = (runnerId: NativeCliId, events: readonly TimedJsonEvent[]): number | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = events[index].value;
    const direct = countValue(record, [
      ...(runnerId === 'claude' ? ['num_turns', 'numTurns'] : []),
      'model_requests',
      'modelRequests',
      'num_model_requests',
    ]);
    if (direct !== null) return direct;
    const nested = countValue(objectValue(record, 'usage'), ['model_requests', 'modelRequests']);
    if (nested !== null) return nested;
  }
  return null;
};

const modelRequestCount = (runnerId: NativeCliId, events: readonly TimedJsonEvent[]): number => {
  const explicit = explicitModelRequests(runnerId, events);
  if (explicit !== null) return explicit;

  if (runnerId === 'claude') {
    const messageIds = new Set<string>();
    let anonymous = 0;
    for (const event of events) {
      if (event.value.type !== 'assistant') continue;
      const message = objectValue(event.value, 'message');
      messageIds.add(stringValue(message, ['id']) ?? `anonymous-${anonymous++}`);
    }
    return messageIds.size;
  }

  const reasoningIds = new Set<string>();
  let anonymous = 0;
  for (const event of events) {
    const item = objectValue(event.value, 'item');
    if (stringValue(item, ['type']) !== 'reasoning') continue;
    reasoningIds.add(stringValue(item, ['id']) ?? `anonymous-${anonymous++}`);
  }
  if (reasoningIds.size > 0) return reasoningIds.size;
  return events.some((event) => event.value.type === 'turn.started' || event.value.type === 'turn.completed') ? 1 : 0;
};

const isFirstModelOutput = (runnerId: NativeCliId, record: JsonObject): boolean => {
  if (runnerId === 'claude') {
    if (record.type === 'assistant' && assistantBlocks(record).length > 0) return true;
    if (record.type === 'result' && typeof record.result === 'string' && record.result.length > 0) return true;
    if (record.type === 'content_block_delta') return true;
    if (record.type !== 'stream_event') return false;
    const streamEvent = objectValue(record, 'event');
    return stringValue(streamEvent, ['type']) === 'content_block_delta';
  }

  if (['item.started', 'item.updated', 'item.completed'].includes(String(record.type))) {
    const itemType = stringValue(objectValue(record, 'item'), ['type']);
    // Command/tool lifecycle events can arrive before any assistant text. They
    // are useful tool metrics, but are not a comparable time-to-first-token.
    return itemType === 'agent_message';
  }
  return typeof record.type === 'string' && /(?:output|content).*delta/iu.test(record.type);
};

const firstTokenTime = (runnerId: NativeCliId, events: readonly TimedJsonEvent[], startedAt: number): number | null => {
  const event = events.find((candidate) => isFirstModelOutput(runnerId, candidate.value));
  return event ? Math.max(0, event.receivedAt - startedAt) : null;
};

const throwForReportedFailure = (runnerId: NativeCliId, events: readonly TimedJsonEvent[]): void => {
  if (runnerId === 'claude') {
    const result = events.toReversed().find((event) => event.value.type === 'result')?.value;
    if (
      !result ||
      (result.is_error !== true &&
        !String(result.subtype ?? '')
          .toLowerCase()
          .includes('error'))
    )
      return;
    throw new Error(stringValue(result, ['error', 'result']) ?? 'Claude CLI reported a failed result.');
  }

  const terminal = events
    .toReversed()
    .find((event) => ['turn.completed', 'turn.failed'].includes(String(event.value.type)))?.value;
  if (terminal?.type !== 'turn.failed') return;
  const nested = objectValue(terminal, 'error');
  throw new Error(stringValue(nested, ['message']) ?? stringValue(terminal, ['message']) ?? 'Codex CLI turn failed.');
};

const positiveIntegerOption = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number.`);
  return Math.trunc(value);
};

const buildTurnInvocation = (
  options: NativeCliTurnOptions,
  createSessionId: () => string
): { args: string[]; fallbackSessionId?: string } => {
  const model = options.model?.trim();
  const reasoningEffort = options.reasoningEffort?.trim();
  const previousSessionId = options.previousSessionId?.trim();
  if (options.runnerId === 'claude') {
    const sessionId = previousSessionId || createSessionId();
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      ...(model ? ['--model', model] : []),
      ...(reasoningEffort ? ['--effort', reasoningEffort] : []),
      ...(previousSessionId ? ['--resume', sessionId] : ['--session-id', sessionId]),
    ];
    return { args, fallbackSessionId: sessionId };
  }

  const args = [
    'exec',
    '--json',
    '--sandbox',
    'workspace-write',
    '--skip-git-repo-check',
    '-C',
    options.workspace,
    ...(model ? ['--model', model] : []),
    ...(reasoningEffort ? ['--config', `model_reasoning_effort="${reasoningEffort}"`] : []),
    ...(previousSessionId ? ['resume', previousSessionId] : []),
    '-',
  ];
  return { args, fallbackSessionId: previousSessionId };
};

/** Probe a normal native CLI without loading any Tomny adapter or MCP configuration. */
export const probeNativeCli = async (
  runnerId: NativeCliId,
  dependencies: NativeCliRunnerDependencies = {}
): Promise<NativeCliProbeResult> => {
  const catalog = await discoverNativeCliModels(runnerId, dependencies);
  const resolveExecutable =
    dependencies.resolveExecutable ??
    ((candidate: NativeCliId) => resolveExecutableOnPath(candidate, dependencies.platform ?? process.platform));
  let executable: string | null;
  try {
    executable = await resolveExecutable(runnerId);
  } catch (error) {
    return {
      runnerId,
      available: false,
      executable: null,
      version: null,
      detail: `${runnerLabel(runnerId)} detection failed: ${errorMessage(error)}`,
      ...catalog,
    };
  }
  if (!executable) {
    return {
      runnerId,
      available: false,
      executable: null,
      version: null,
      detail: `${runnerLabel(runnerId)} was not found on PATH.`,
      ...catalog,
    };
  }

  try {
    const captured = await captureProcess(
      {
        executable,
        args: ['--version'],
        cwd: process.cwd(),
        timeoutMs: VERSION_TIMEOUT_MS,
        maxOutputBytes: VERSION_MAX_OUTPUT_BYTES,
      },
      dependencies
    );
    const version = (captured.stdout.trim() || captured.stderr.trim()).split(/\r?\n/u)[0] || null;
    return {
      runnerId,
      available: true,
      executable,
      version,
      detail: version ? `${runnerLabel(runnerId)} ${version}` : `${runnerLabel(runnerId)} is available.`,
      ...catalog,
    };
  } catch (error) {
    return {
      runnerId,
      available: true,
      executable,
      version: null,
      detail: `${runnerLabel(runnerId)} was found, but its version probe failed: ${errorMessage(error)}`,
      ...catalog,
    };
  }
};

/**
 * Run one prompt directly through Claude or Codex's native non-interactive CLI.
 * The caller passes the returned sessionId back as previousSessionId for the
 * next prompt; no Tomny surface, context, system prompt, or MCP is injected.
 */
export const runNativeCliTurn = async (
  options: NativeCliTurnOptions,
  dependencies: NativeCliRunnerDependencies = {}
): Promise<NativeCliTurnResult> => {
  const workspace = options.workspace.trim();
  if (!workspace) throw new Error('Native CLI workspace is required.');
  if (!options.prompt.trim()) throw new Error('Native CLI prompt is required.');
  const timeoutMs = positiveIntegerOption(options.timeoutMs, DEFAULT_TURN_TIMEOUT_MS, 'timeoutMs');
  const maxOutputBytes = positiveIntegerOption(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes');
  const resolveExecutable =
    dependencies.resolveExecutable ??
    ((candidate: NativeCliId) => resolveExecutableOnPath(candidate, dependencies.platform ?? process.platform));
  const executable = await resolveExecutable(options.runnerId);
  if (!executable) throw new Error(`${runnerLabel(options.runnerId)} was not found on PATH.`);

  const invocation = buildTurnInvocation({ ...options, workspace }, dependencies.createSessionId ?? randomUUID);
  const captured = await captureProcess(
    {
      executable,
      args: invocation.args,
      cwd: workspace,
      stdin: options.prompt,
      signal: options.signal,
      timeoutMs,
      maxOutputBytes,
    },
    dependencies
  );
  throwForReportedFailure(options.runnerId, captured.events);

  const response = options.runnerId === 'claude' ? claudeResponse(captured.events) : codexResponse(captured.events);
  if (!response.trim()) {
    throw new Error(`${runnerLabel(options.runnerId)} completed without a final text response.`);
  }
  const tools = options.runnerId === 'claude' ? claudeToolMetrics(captured.events) : codexToolMetrics(captured.events);

  return {
    sessionId: extractSessionId(options.runnerId, captured.events, invocation.fallbackSessionId),
    response,
    startedAt: captured.startedAt,
    durationMs: captured.durationMs,
    firstTokenMs: firstTokenTime(options.runnerId, captured.events, captured.startedAt),
    modelRequests: modelRequestCount(options.runnerId, captured.events),
    toolCalls: tools.calls,
    toolFailures: tools.failures,
    usage: reportedUsage(options.runnerId, captured.events),
    rawOutput: captured.stdout,
  };
};
