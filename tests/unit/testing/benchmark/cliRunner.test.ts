/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  probeNativeCli,
  runNativeCliTurn,
  type NativeCliId,
  type NativeCliSpawn,
} from '@process/testing/benchmark/cliRunner';

type SpawnCall = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

class FakeChild extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly input: Buffer[] = [];
  public killed = false;

  public constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => this.input.push(Buffer.from(chunk)));
  }

  public complete(stdout: string, code = 0, stderr = ''): void {
    if (stdout) this.stdout.write(stdout);
    if (stderr) this.stderr.write(stderr);
    this.emit('close', code, null);
  }

  public kill(): boolean {
    this.killed = true;
    return true;
  }

  public prompt(): string {
    return Buffer.concat(this.input).toString('utf8');
  }
}

const fakeSpawn = (
  outputs: Array<{ stdout?: string; stderr?: string; code?: number } | 'hang'>
): { spawnProcess: NativeCliSpawn; calls: SpawnCall[]; children: FakeChild[] } => {
  const calls: SpawnCall[] = [];
  const children: FakeChild[] = [];
  const spawnProcess: NativeCliSpawn = vi.fn((command, args, options) => {
    const output = outputs[calls.length];
    if (!output) throw new Error('No fake process output was configured.');
    const child = new FakeChild();
    calls.push({ command, args: [...args], options });
    children.push(child);
    if (output !== 'hang') {
      queueMicrotask(() => child.complete(output.stdout ?? '', output.code ?? 0, output.stderr));
    }
    return child as unknown as ChildProcessWithoutNullStreams;
  });
  return { spawnProcess, calls, children };
};

const resolver = (executable: string) => vi.fn(async (_runnerId: NativeCliId) => executable);

const jsonl = (...events: unknown[]): string => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

describe('native benchmark CLI runner', () => {
  it('starts Claude with a dedicated session and parses reported metrics', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const output = jsonl(
      { type: 'system', subtype: 'init', session_id: sessionId },
      {
        type: 'assistant',
        session_id: sessionId,
        message: {
          id: 'message-1',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }],
          usage: {
            input_tokens: 12,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 1,
          },
        },
      },
      {
        type: 'user',
        session_id: sessionId,
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true }] },
      },
      {
        type: 'result',
        subtype: 'success',
        session_id: sessionId,
        num_turns: 2,
        result: 'Claude final answer',
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 1,
        },
      }
    );
    const harness = fakeSpawn([{ stdout: output }]);

    const result = await runNativeCliTurn(
      {
        runnerId: 'claude',
        workspace: 'C:\\bench\\claude',
        model: 'claude-sonnet-4-6',
        reasoningEffort: 'high',
        prompt: 'Prompt one',
      },
      {
        spawnProcess: harness.spawnProcess,
        resolveExecutable: resolver('C:\\Tools\\claude.exe'),
        createSessionId: () => sessionId,
      }
    );

    expect(harness.calls[0]).toMatchObject({
      command: 'C:\\Tools\\claude.exe',
      options: { cwd: 'C:\\bench\\claude', shell: false },
    });
    expect(harness.calls[0].args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'claude-sonnet-4-6',
      '--effort',
      'high',
      '--session-id',
      sessionId,
    ]);
    expect(harness.children[0].prompt()).toBe('Prompt one');
    expect(harness.calls[0].args.join(' ')).not.toMatch(/tomny|mcp|surface|context/iu);
    expect(result).toMatchObject({
      sessionId,
      response: 'Claude final answer',
      modelRequests: 2,
      toolCalls: 1,
      toolFailures: 1,
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cachedInputTokens: 3,
        totalTokens: 20,
        source: 'reported',
      },
    });
    expect(result.firstTokenMs).not.toBeNull();
  });

  it('resumes Claude with the prior native session id', async () => {
    const sessionId = '22222222-2222-4222-8222-222222222222';
    const harness = fakeSpawn([
      {
        stdout: jsonl({
          type: 'result',
          subtype: 'success',
          session_id: sessionId,
          result: 'Second answer',
          num_turns: 1,
        }),
      },
    ]);

    await runNativeCliTurn(
      {
        runnerId: 'claude',
        workspace: 'C:\\bench\\claude',
        prompt: 'Prompt two',
        previousSessionId: sessionId,
      },
      { spawnProcess: harness.spawnProcess, resolveExecutable: resolver('C:\\Tools\\claude.exe') }
    );

    expect(harness.calls[0].args).toContain('--resume');
    expect(harness.calls[0].args).toContain(sessionId);
    expect(harness.calls[0].args).not.toContain('--session-id');
  });

  it('runs Codex in workspace-write mode and tolerates malformed JSONL', async () => {
    const threadId = '33333333-3333-4333-8333-333333333333';
    const output = [
      JSON.stringify({ type: 'thread.started', thread_id: threadId }),
      'native diagnostic that is not JSON',
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'command-1', type: 'command_execution', command: 'test', exit_code: 1, status: 'failed' },
      }),
      '{ malformed json',
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'message-1', type: 'agent_message', text: 'Codex final answer' },
      }),
      JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 10 },
      }),
      '',
    ].join('\n');
    const harness = fakeSpawn([{ stdout: output }]);

    const result = await runNativeCliTurn(
      {
        runnerId: 'codex',
        workspace: 'C:\\bench\\codex',
        model: 'gpt-5.4',
        reasoningEffort: 'low',
        prompt: 'Prompt one',
      },
      { spawnProcess: harness.spawnProcess, resolveExecutable: resolver('C:\\Tools\\codex.exe') }
    );

    expect(harness.calls[0].args).toEqual([
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '-C',
      'C:\\bench\\codex',
      '--model',
      'gpt-5.4',
      '--config',
      'model_reasoning_effort="low"',
      '-',
    ]);
    expect(harness.children[0].prompt()).toBe('Prompt one');
    expect(harness.calls[0].args.join(' ')).not.toMatch(/tomny|mcp|surface|context/iu);
    expect(result).toMatchObject({
      sessionId: threadId,
      response: 'Codex final answer',
      modelRequests: 1,
      toolCalls: 1,
      toolFailures: 1,
      usage: {
        inputTokens: 120,
        outputTokens: 10,
        cachedInputTokens: 80,
        totalTokens: 130,
        source: 'reported',
      },
    });
  });

  it('resumes Codex by thread id and keeps absent token counts unavailable', async () => {
    const threadId = '44444444-4444-4444-8444-444444444444';
    const harness = fakeSpawn([
      {
        stdout: jsonl(
          { type: 'turn.started' },
          { type: 'item.completed', item: { id: 'message-2', type: 'agent_message', text: 'Follow-up' } },
          { type: 'turn.completed' }
        ),
      },
    ]);

    const result = await runNativeCliTurn(
      {
        runnerId: 'codex',
        workspace: 'C:\\bench\\codex',
        prompt: 'Prompt two',
        previousSessionId: threadId,
      },
      { spawnProcess: harness.spawnProcess, resolveExecutable: resolver('C:\\Tools\\codex.exe') }
    );

    expect(harness.calls[0].args.slice(-3)).toEqual(['resume', threadId, '-']);
    expect(result.sessionId).toBe(threadId);
    expect(result.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      totalTokens: null,
      source: 'unavailable',
    });
  });

  it('surfaces a native CLI non-zero exit with stderr context', async () => {
    const harness = fakeSpawn([{ code: 7, stderr: 'authentication failed' }]);

    await expect(
      runNativeCliTurn(
        { runnerId: 'codex', workspace: 'C:\\bench', prompt: 'Prompt' },
        { spawnProcess: harness.spawnProcess, resolveExecutable: resolver('C:\\Tools\\codex.exe') }
      )
    ).rejects.toThrow(/exited with code 7.*authentication failed/iu);
  });

  it('kills the native CLI when its AbortSignal fires', async () => {
    const harness = fakeSpawn(['hang']);
    const controller = new AbortController();
    const running = runNativeCliTurn(
      { runnerId: 'claude', workspace: 'C:\\bench', prompt: 'Prompt', signal: controller.signal },
      { spawnProcess: harness.spawnProcess, resolveExecutable: resolver('C:\\Tools\\claude.exe') }
    );
    await vi.waitFor(() => expect(harness.children).toHaveLength(1));

    controller.abort();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.children[0].killed).toBe(true);
  });

  it('terminates a CLI that exceeds the configured output bound', async () => {
    const harness = fakeSpawn([{ stdout: 'x'.repeat(200) }]);

    await expect(
      runNativeCliTurn(
        { runnerId: 'claude', workspace: 'C:\\bench', prompt: 'Prompt', maxOutputBytes: 64 },
        { spawnProcess: harness.spawnProcess, resolveExecutable: resolver('C:\\Tools\\claude.exe') }
      )
    ).rejects.toMatchObject({ name: 'OutputLimitError' });
    expect(harness.children[0].killed).toBe(true);
  });

  it('probes the resolved executable without routing through an adapter', async () => {
    const harness = fakeSpawn([{ stdout: 'codex-cli 1.2.3\n' }]);
    const resolveExecutable = resolver('C:\\Tools\\codex.exe');

    const result = await probeNativeCli('codex', {
      spawnProcess: harness.spawnProcess,
      resolveExecutable,
    });

    expect(resolveExecutable).toHaveBeenCalledWith('codex');
    expect(harness.calls[0].args).toEqual(['--version']);
    expect(result).toMatchObject({ available: true, executable: 'C:\\Tools\\codex.exe', version: 'codex-cli 1.2.3' });
  });

  it('loads clickable Codex models from the local cache and marks the configured default', async () => {
    const harness = fakeSpawn([{ stdout: 'codex-cli 1.2.3\n' }]);
    const readTextFile = vi.fn(async (filePath: string) => {
      if (filePath.endsWith('config.toml')) {
        return 'model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\n';
      }
      if (filePath.endsWith('models_cache.json')) {
        return JSON.stringify({
          models: [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT-5.6-Sol',
              visibility: 'list',
              default_reasoning_level: 'low',
              supported_reasoning_levels: [{ effort: 'low' }],
            },
            {
              slug: 'gpt-5.6-terra',
              display_name: 'GPT-5.6-Terra',
              visibility: 'list',
              default_reasoning_level: 'medium',
              supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'high' }],
            },
            { slug: 'hidden-review', display_name: 'Hidden Review', visibility: 'hide' },
          ],
        });
      }
      throw new Error(`Unexpected path: ${filePath}`);
    });

    const result = await probeNativeCli('codex', {
      spawnProcess: harness.spawnProcess,
      resolveExecutable: resolver('C:\\Tools\\codex.exe'),
      homeDirectory: () => 'C:\\Users\\Tester',
      readTextFile,
    });

    expect(result.defaultModel).toBe('gpt-5.6-terra');
    expect(result.models).toEqual([
      {
        key: 'gpt-5.6-sol::low',
        label: 'GPT-5.6-Sol (low)',
        isDefault: false,
        model: 'gpt-5.6-sol',
        reasoningEffort: 'low',
      },
      {
        key: 'gpt-5.6-terra::medium',
        label: 'GPT-5.6-Terra (medium)',
        isDefault: false,
        model: 'gpt-5.6-terra',
        reasoningEffort: 'medium',
      },
      {
        key: 'gpt-5.6-terra::high',
        label: 'GPT-5.6-Terra (high)',
        isDefault: true,
        model: 'gpt-5.6-terra',
        reasoningEffort: 'high',
      },
    ]);
  });

  it('shows Claude alias routing and effort choices exactly as the CLI configuration resolves them', async () => {
    const harness = fakeSpawn([{ stdout: '2.1.0\n' }]);

    const result = await probeNativeCli('claude', {
      spawnProcess: harness.spawnProcess,
      resolveExecutable: resolver('C:\\Tools\\claude.exe'),
      env: {},
      readTextFile: async () =>
        JSON.stringify({
          effortLevel: 'low',
          env: {
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'cx/gpt-5.6-luna',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'cx/gpt-5.6-luna',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'cx/gpt-5.6-luna',
          },
        }),
    });

    expect(result.defaultModel).toBe('cx/gpt-5.6-luna');
    expect(result.models).toContainEqual({
      key: 'default::low',
      label: 'Default → cx/gpt-5.6-luna (low)',
      isDefault: true,
      model: 'cx/gpt-5.6-luna',
      reasoningEffort: 'low',
    });
    expect(result.models).toContainEqual({
      key: 'opus::max',
      label: 'Opus → cx/gpt-5.6-luna (max)',
      isDefault: false,
      model: 'opus',
      reasoningEffort: 'max',
    });
    expect(result.models).toHaveLength(20);
  });

  it('uses Claude settings env for the default without guessing from different aliases', async () => {
    const harness = fakeSpawn([{ stdout: '2.1.0\n' }]);
    const readTextFile = vi.fn(async () =>
      JSON.stringify({
        effortLevel: 'high',
        env: {
          ANTHROPIC_MODEL: 'router/default-model',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'router/opus-model',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'router/sonnet-model',
        },
      })
    );

    const result = await probeNativeCli('claude', {
      spawnProcess: harness.spawnProcess,
      resolveExecutable: resolver('C:\\Tools\\claude.exe'),
      env: {},
      readTextFile,
    });

    expect(result.defaultModel).toBe('router/default-model');
    expect(result.models).toContainEqual({
      key: 'default::high',
      label: 'Default → router/default-model (high)',
      isDefault: true,
      model: 'router/default-model',
      reasoningEffort: 'high',
    });
  });

  it('reads only root Codex model settings and ignores profile tables', async () => {
    const harness = fakeSpawn([{ stdout: 'codex-cli 1.2.3\n' }]);
    const result = await probeNativeCli('codex', {
      spawnProcess: harness.spawnProcess,
      resolveExecutable: resolver('C:\\Tools\\codex.exe'),
      readTextFile: async (filePath) => {
        if (filePath.endsWith('config.toml')) {
          return [
            'model = "gpt-root"',
            'model_reasoning_effort = "low"',
            '[profiles.review]',
            'model = "gpt-profile"',
            'model_reasoning_effort = "max"',
          ].join('\n');
        }
        if (filePath.endsWith('models_cache.json')) throw new Error('No cache');
        throw new Error(`Unexpected path: ${filePath}`);
      },
    });

    expect(result.defaultModel).toBe('gpt-root');
    expect(result.models).toEqual([
      {
        key: 'gpt-root::low',
        label: 'gpt-root (low)',
        isDefault: true,
        model: 'gpt-root',
        reasoningEffort: 'low',
      },
    ]);
  });

  it('reports an unavailable executable without spawning a process', async () => {
    const spawnProcess = vi.fn() as unknown as NativeCliSpawn;

    const result = await probeNativeCli('claude', {
      spawnProcess,
      resolveExecutable: async () => null,
    });

    expect(result).toMatchObject({ runnerId: 'claude', available: false, executable: null, version: null });
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
