/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { BoundedSessionPool } from '../../../packages/desktop/src/process/experimentalCore/sessionPool';
import {
  classifyAgentFailure,
  isRetryManagedError,
  withPersistentAgentRetry,
} from '../../../packages/desktop/src/process/agentRuntime/retryPolicy';

import {
  APP_PROVIDER_CHILD_CREDENTIAL_ENVIRONMENT_UNSUPPORTED,
  appProviderEnvironment,
  appProviderNetworkHost,
  isTomnyControlPlaneTool,
  normalizeTomnyStreamEvent,
  preflightSkillWorkflowTool,
  parseTomnyContextSnapshot,
  parseTomnyModelCatalog,
  sanitizeTomnyToolDetail,
  tomnyMcpInjectionCommand,
  tomnyMcpServerCommand,
  tomnyNativeToolDenialReason,
  tomnyProvidedToolResultCommand,
  tomnyShouldInitializeMcpServers,
  tomnySurfaceSystemPrompt,
  tomnyToolRequestInput,
  translateNativeTomnyTool,
  tomnyStrictProjectArgs,
  tomnyStrictToolsConfig,
  tomnyToolAccessForPermission,
  tomnyModeForPermission,
  tomnyModelArgs,
  tomnyRuntimeKey,
  tomnySessionActionHistoryQuery,
  waitForTomnyTurn,
} from '../../../packages/desktop/src/process/experimentalCore/adapters/tomnyCoreAdapter';

describe('Tomny JSON stream adapter', () => {
  it('resolves network host and safe environment for valid app-provider models', async () => {
    const source = {
      list: vi.fn(),
      get: vi.fn().mockResolvedValue({
        id: 'provider-1',
        platform: 'custom',
        name: 'Local Proxy',
        base_url: 'http://localhost:20128/v1',
        api_key: 'test-key',
        models: ['ag/gemini-3.8-flash-medium'],
      }),
    };
    const modelKey = 'app-provider:provider-1:ag%2Fgemini-3.8-flash-medium';

    await expect(appProviderNetworkHost(modelKey, source)).resolves.toBe('localhost');
    const env = await appProviderEnvironment(modelKey, source, {
      PATH: 'C:\\Windows',
      HTTP_PROXY: 'http://proxy.invalid',
    });
    expect(env).toMatchObject({
      PROVIDER: 'openai',
      MODEL: 'ag/gemini-3.8-flash-medium',
      API_KEY: 'test-key',
      BASE_URL: 'http://localhost:20128/v1',
    });
    expect(env).not.toHaveProperty('HTTP_PROXY');
  });

  it('returns the stable deny error for malformed app-provider encoding before any provider lookup', async () => {
    const source = {
      list: vi.fn(),
      get: vi.fn(),
    };

    await expect(appProviderNetworkHost('app-provider:%:model-1', source)).rejects.toThrow(
      'APP_PROVIDER_BASE_URL_INVALID'
    );
    await expect(appProviderEnvironment('app-provider:%:model-1', source)).rejects.toThrow(
      'APP_PROVIDER_BASE_URL_INVALID'
    );
    expect(source.get).not.toHaveBeenCalled();
  });

  it('keeps local and supported CLI model targets out of the app-provider child guard', async () => {
    const inherited = { PATH: 'C:\\Windows\\System32' };
    const source = { list: vi.fn(), get: vi.fn() };

    await expect(appProviderNetworkHost('provider:openai:gpt-5.6', source)).resolves.toBeUndefined();
    await expect(appProviderEnvironment(undefined, source, inherited)).resolves.toBe(inherited);
    expect(source.get).not.toHaveBeenCalled();
  });

  it('bounds session action-history queries without accepting a session id', () => {
    expect(
      tomnySessionActionHistoryQuery({
        limit: 999,
        after_sequence: 12,
        query: ' earlier decision ',
        sessionId: 'other',
      })
    ).toEqual({
      limit: 100,
      afterSequence: 12,
      query: 'earlier decision',
    });
    expect(tomnySessionActionHistoryQuery({ limit: 0, after_sequence: -1 })).toEqual({ limit: 1 });
  });
  it('uses an explanatory IDE system prompt under 200 tokens', () => {
    const prompt = tomnySurfaceSystemPrompt('ide', 'C:/workspace', {
      mode: 'surface',
      patterns: ['ide_*', 'tomny_*'],
    });

    expect(prompt).toContain('[TomnyExactSurfacePrompt]');
    expect(prompt).toContain('[TomnyToolCatalog] surface');
    expect(prompt).toContain('[TomnyToolPatterns] ide_*,tomny_*');
    expect(prompt).toContain('You are Tomny Agentic in Tomny ide; project: C:/workspace');
    expect(prompt).toContain('only for tool/external turns');
    expect(prompt).toContain('never casual chat');
    expect(prompt).not.toContain('Open the current user action exactly once with StartAction');
    expect(prompt).toContain('Once open, do not nest it');
    expect(prompt).toContain('Use ToolSearch only for another exact schema');
    expect(prompt).toContain('ide_research once');
    expect(prompt).toContain('flow/bug/logic/purpose');
    expect(prompt).toContain('fresh Wiki test profile');
    expect(prompt).toContain('Bug root-cause gate');
    expect(prompt).toContain('ide_test_script phase=reproduce');
    expect(prompt).toContain('identical script as post-fix');
    expect(prompt).toContain('Use ide_quick_test only for hard/runtime-only');
    expect(prompt).toContain('follow up only for explicit gaps');
    expect(prompt).toContain('call loaded tools directly');
    expect(prompt).toContain('ToolMap');
    expect(prompt).toContain('Save is sole historical conversation context');
    expect(prompt).toContain('action journal');
    expect(prompt).not.toContain('older conversation details');
    expect(prompt).not.toContain('nested action schema');
    expect(prompt).toContain('Skip skills for ordinary repo/bug work');
    expect(prompt).toContain('use them when named or clearly specialized');
    expect(prompt).not.toContain('Before execution, find skills');
    expect(prompt).toContain('Secret Context values stay hidden');
    expect(prompt?.trim().split(/\s+/u).length).toBeLessThan(200);
    expect(tomnySurfaceSystemPrompt('chat', 'C:/workspace')).toContain('You are Tomny Agentic in Tomny chat');
  });

  it('never exposes typed credentials in permission details', () => {
    const detail = sanitizeTomnyToolDetail('browser_type', {
      selector: '#password',
      text: 'super-secret-password',
    });

    expect(detail).toContain('#password');
    expect(detail).not.toContain('super-secret-password');
    expect(detail).toContain('[REDACTED]');
  });

  it('redacts credential-shaped fields while preserving non-secret approval context', () => {
    const detail = sanitizeTomnyToolDetail('some_tool', {
      endpoint: 'https://example.test',
      apiKey: 'sk-example-secret-123456',
      nested: { token: 'private-token', count: 2 },
    });

    expect(detail).toContain('https://example.test');
    expect(detail).toContain('"count":2');
    expect(detail).not.toContain('sk-example-secret-123456');
    expect(detail).not.toContain('private-token');
  });

  it('maps text and informational events into the transport-neutral contract', () => {
    expect(normalizeTomnyStreamEvent({ type: 'text_delta', text: 'Hello' })).toEqual({
      type: 'delta',
      text: 'Hello',
      mode: 'append',
    });
    expect(normalizeTomnyStreamEvent({ type: 'info', message: 'Retrying' })).toEqual({
      type: 'step',
      text: 'Retrying',
    });
    expect(normalizeTomnyStreamEvent({ type: 'thinking', text: 'Checking files' })).toEqual({
      type: 'thinking',
      text: 'Checking files',
    });
    expect(normalizeTomnyStreamEvent({ type: 'info', message: 'Tool call: Glob' })).toEqual({
      type: 'tool-call',
      tool: 'Glob',
      text: 'Tool call: Glob',
      phase: 'requested',
    });
    expect(normalizeTomnyStreamEvent({ type: 'info', message: '[ExecCommand error] failed' })).toBeNull();
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_result',
        tool_name: 'ExecCommand',
        call_id: 'call-1',
        status: 'error',
        output: 'failed',
      })
    ).toEqual({
      type: 'tool-result',
      tool: 'ExecCommand',
      callId: 'call-1',
      outcome: 'error',
      text: 'failed',
    });
    expect(normalizeTomnyStreamEvent({ type: 'tool_running', tool_name: 'Read' })).toEqual({
      type: 'tool-call',
      tool: 'Read',
      text: 'Tomny is running Read',
      phase: 'running',
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_result',
        tool_name: 'ide_map',
        call_id: 'call-invalid-args',
        output: 'MCP error -32602: Input validation error: Invalid arguments for tool ide_map',
      })
    ).toEqual({
      type: 'tool-result',
      tool: 'ide_map',
      callId: 'call-invalid-args',
      outcome: 'error',
      text: 'MCP error -32602: Input validation error: Invalid arguments for tool ide_map',
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_result',
        tool_name: 'ide_search',
        call_id: 'call-explicit-error',
        is_error: true,
        output: 'rootPath is required.',
      })
    ).toMatchObject({ tool: 'ide_search', callId: 'call-explicit-error', outcome: 'error' });
  });

  it('retains structured JSON arguments on Tomny tool lifecycle events', () => {
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_running',
        tool_name: 'ide_scan_repo',
        call_id: 'scan-1',
        raw_input: { rootPath: 'C:/repo', maxFiles: 2000 },
      })
    ).toMatchObject({
      type: 'tool-call',
      tool: 'ide_scan_repo',
      callId: 'scan-1',
      input: { rootPath: 'C:/repo', maxFiles: 2000 },
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_result',
        tool_name: 'ide_scan_repo',
        call_id: 'scan-1',
        input: { rootPath: 'C:/repo', maxFiles: 2000 },
        output: 'Files: 2000',
      })
    ).toMatchObject({ type: 'tool-result', callId: 'scan-1', input: { rootPath: 'C:/repo', maxFiles: 2000 } });
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_running',
        tool_name: 'browser_type',
        call_id: 'typing-1',
        input: { selector: '#password', text: 'do-not-persist' },
      })
    ).toMatchObject({ input: { selector: '#password', text: '[REDACTED]' } });
  });

  it('exposes action-gateway and schema-loading input/output in the user worklog', () => {
    expect(isTomnyControlPlaneTool('StartAction')).toBe(true);
    expect(isTomnyControlPlaneTool('ToolSearch')).toBe(true);
    expect(isTomnyControlPlaneTool('ide_read_file')).toBe(false);
    expect(normalizeTomnyStreamEvent({ type: 'info', message: 'Token watermark override: using=27182' })).toBeNull();
    expect(
      normalizeTomnyStreamEvent({
        type: 'info',
        message: 'Tool call: StartAction',
        call_id: 'gate-1',
        input: { goal: 'Inspect the repo' },
      })
    ).toMatchObject({
      type: 'tool-call',
      tool: 'StartAction',
      callId: 'gate-1',
      input: { goal: 'Inspect the repo' },
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_running',
        tool_name: 'ToolSearch',
        call_id: 'schema-1',
        input: { query: 'ide map' },
      })
    ).toMatchObject({
      type: 'tool-call',
      tool: 'ToolSearch',
      callId: 'schema-1',
      input: { query: 'ide map' },
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'info',
        message: '[ToolSearch success] Loaded exact schema for ide_map.',
        call_id: 'schema-1',
        input: { query: 'ide map' },
      })
    ).toMatchObject({
      type: 'tool-result',
      tool: 'ToolSearch',
      callId: 'schema-1',
      input: { query: 'ide map' },
      text: 'Loaded exact schema for ide_map.',
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'tool_result',
        tool_name: 'StartAction',
        call_id: 'gate-1',
        status: 'success',
        input: { goal: 'Inspect the repo' },
        output: 'Action gate opened.\nToolMap: [{"name":"ide_map"}]',
      })
    ).toMatchObject({
      type: 'tool-result',
      tool: 'StartAction',
      callId: 'gate-1',
      input: { goal: 'Inspect the repo' },
      text: expect.stringContaining('ToolMap'),
      outcome: 'success',
    });
  });

  it('compacts a large StartAction ToolMap before the event text limit can corrupt it', () => {
    const map = Array.from({ length: 180 }, (_, index) => ({
      name: `ide_tool_${index}`,
      description: `Long schema-discovery description ${'x'.repeat(120)}`,
      ...(index === 0 ? { recommended: true } : {}),
      ...(index === 179 ? { deferred: true } : {}),
    }));
    const normalized = normalizeTomnyStreamEvent({
      type: 'tool_result',
      tool_name: 'StartAction',
      call_id: 'large-map',
      status: 'success',
      output: `Action gate opened.\nToolMap: ${JSON.stringify(map)}\nSchema cache unchanged.`,
    });

    expect(normalized).toMatchObject({ type: 'tool-result', tool: 'StartAction' });
    if (normalized?.type !== 'tool-result') throw new Error('Expected a StartAction tool result');
    expect(normalized.text).not.toContain('[Event text truncated]');
    const encodedMap = /ToolMap:\s*(\[[^\r\n]*\])/u.exec(normalized.text ?? '')?.[1];
    expect(encodedMap).toBeTruthy();
    const compact = JSON.parse(encodedMap as string) as Array<Record<string, unknown>>;
    expect(compact.at(-1)).toEqual({ name: 'ide_tool_179', deferred: true });
    expect(compact[0]).toEqual({ name: 'ide_tool_0', recommended: true });
  });

  it('ignores lifecycle events that are handled by the process session', () => {
    expect(normalizeTomnyStreamEvent({ type: 'ready' })).toBeNull();
    expect(normalizeTomnyStreamEvent({ type: 'stream_end' })).toBeNull();
  });

  it('reads StartAction plus the hidden schema cache and compacted core context', () => {
    expect(
      parseTomnyContextSnapshot({
        type: 'context_snapshot',
        system: 'Tomny system prompt',
        tools: [
          {
            name: 'StartAction',
            description: 'Core action gateway',
            input_schema: { type: 'object', properties: { goal: { type: 'string' } } },
            deferred: false,
          },
        ],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Compacted context' }] }],
        capability_summary: 'Available surface capabilities: project reading and search.',
        working_memory: { goal: 'Inspect' },
        tool_cache: [
          {
            name: 'ide_read',
            description: 'Read an IDE file',
            input_schema: { type: 'object', properties: { path: { type: 'string' } } },
            deferred: true,
          },
        ],
      })
    ).toEqual({
      system: 'Tomny system prompt',
      tools: [expect.objectContaining({ name: 'StartAction', deferred: false })],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Compacted context' }] }],
      capabilitySummary: 'Available surface capabilities: project reading and search.',
      workingMemory: { goal: 'Inspect' },
      toolCache: [expect.objectContaining({ name: 'ide_read', deferred: true })],
    });
    expect(parseTomnyContextSnapshot({ type: 'context_snapshot', system: '', tools: [{ name: 'broken' }] })).toBeNull();
  });
  it('keeps provider worklog text and every emitted detail field without summarizing it', () => {
    expect(
      normalizeTomnyStreamEvent({
        type: 'thinking',
        text: 'Planning Vietnamese support inspection',
        intent: 'Trace the complete event path.',
        reason: 'Need to distinguish provider output from renderer formatting.',
        action: 'Search the core adapter\nand UI event renderer.',
        input: { query: 'thinking step tool-call' },
        output: { matches: 4 },
        next_step: 'Read the matching adapter code before editing.',
        detail: 'Provider detail is preserved verbatim.',
      })
    ).toEqual({
      type: 'thinking',
      text: [
        'Planning Vietnamese support inspection',
        'Intent: Trace the complete event path.',
        'Reason:\nNeed to distinguish provider output from renderer formatting.',
        'Action:\nSearch the core adapter\nand UI event renderer.',
        'Input:\n{\n  "query": "thinking step tool-call"\n}',
        'Output:\n{\n  "matches": 4\n}',
        'Next:\nRead the matching adapter code before editing.',
        'Detail:\nProvider detail is preserved verbatim.',
      ].join('\n\n'),
    });
  });

  it('does not truncate long provider thinking or detailed step fields', () => {
    const fullThinking = `Evidence:\n${'x'.repeat(16_000)}`;
    expect(normalizeTomnyStreamEvent({ type: 'thinking', text: fullThinking })).toEqual({
      type: 'thinking',
      text: fullThinking,
    });
    expect(
      normalizeTomnyStreamEvent({
        type: 'info',
        message: 'Inspecting provider response',
        reason: 'The full worklog must reach the UI.',
        detail: 'Detailed observation',
      })
    ).toEqual({
      type: 'step',
      text: [
        'Inspecting provider response',
        'Reason:\nThe full worklog must reach the UI.',
        'Detail:\nDetailed observation',
      ].join('\n\n'),
    });
  });

  it('treats null, undefined, and whitespace-only worklog fields as absent', () => {
    expect(normalizeTomnyStreamEvent({ type: 'thinking', text: null, detail: undefined })).toBeNull();
    expect(normalizeTomnyStreamEvent({ type: 'info', message: '', reason: '   ' })).toBeNull();
    expect(normalizeTomnyStreamEvent({ type: 'text_delta', text: null })).toBeNull();
  });

  it('preserves provider whitespace in response deltas and thinking text', () => {
    expect(normalizeTomnyStreamEvent({ type: 'text_delta', text: ' next' })).toEqual({
      type: 'delta',
      text: ' next',
      mode: 'append',
    });
    expect(normalizeTomnyStreamEvent({ type: 'thinking', text: '  line one\nline two  ' })).toEqual({
      type: 'thinking',
      text: '  line one\nline two  ',
    });
  });

  it('discovers the default model and named profiles from Tomny config', () => {
    const models = parseTomnyModelCatalog(`
[default]
provider = "openai"
model = "gpt-5.6"

[profiles.fast]
provider = "openai"
model = "gpt-5.5"

[profiles.local]
provider = "ollama"
model = "qwen3:30b"
`);

    expect(models).toEqual([
      {
        key: 'provider:openai:gpt-5.6',
        modelId: 'gpt-5.6',
        label: 'gpt-5.6 (openai)',
        providerId: 'openai',
        isDefault: true,
      },
      {
        key: 'profile:fast',
        modelId: 'gpt-5.5',
        label: 'gpt-5.5 (fast)',
        providerId: 'openai',
        isDefault: false,
      },
      {
        key: 'profile:local',
        modelId: 'qwen3:30b',
        label: 'qwen3:30b (local)',
        providerId: 'ollama',
        isDefault: false,
      },
    ]);
  });

  it('uses Tomny provider defaults without requiring the legacy core catalog', () => {
    expect(parseTomnyModelCatalog('[default]\nprovider = "anthropic"')).toEqual([
      expect.objectContaining({
        key: 'provider:anthropic:claude-sonnet-4-20250514',
        modelId: 'claude-sonnet-4-20250514',
        isDefault: true,
      }),
    ]);
    expect(parseTomnyModelCatalog('', { PROVIDER: 'openai', MODEL: 'gpt-env' })).toEqual([
      expect.objectContaining({
        key: 'provider:openai:gpt-env',
        modelId: 'gpt-env',
        isDefault: true,
      }),
    ]);
  });

  it('rejects a stalled Tomny turn instead of waiting forever', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const waiting = waitForTomnyTurn(new Promise<void>(() => undefined), onTimeout, 50);
    const rejected = expect(waiting).rejects.toThrow('produced no activity');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(onTimeout).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('keeps a Tomny turn alive while stream activity continues', async () => {
    vi.useFakeTimers();
    let lastActivityAt = Date.now();
    const onTimeout = vi.fn();
    const waiting = waitForTomnyTurn(new Promise<void>(() => undefined), onTimeout, 50, () => lastActivityAt);

    await vi.advanceTimersByTimeAsync(40);
    lastActivityAt = Date.now();
    await vi.advanceTimersByTimeAsync(40);
    expect(onTimeout).not.toHaveBeenCalled();

    const rejected = expect(waiting).rejects.toThrow('produced no activity');
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(onTimeout).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('injects the Tomny tool MCP over SSE before the first message', () => {
    expect(tomnyMcpInjectionCommand('http://127.0.0.1:1234/sse')).toEqual({
      type: 'add_mcp_server',
      name: 'tomny-tools',
      transport: 'sse',
      url: 'http://127.0.0.1:1234/sse',
      deferred: true,
    });
  });

  it('preserves stdio MCP commands and secret environment values inside the process boundary', () => {
    expect(
      tomnyMcpServerCommand({
        name: 'local-tools',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: [{ name: 'TOKEN', value: 'secret' }],
      })
    ).toEqual({
      type: 'add_mcp_server',
      name: 'local-tools',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'secret' },
      deferred: true,
    });
  });

  it('uses the IDE host SSE sibling but rejects other unsupported HTTP MCP transports', () => {
    expect(
      tomnyMcpServerCommand({ name: 'ide-tools', transport: 'sse', url: 'http://127.0.0.1:4100/sse' })
    ).toMatchObject({ name: 'ide-tools', transport: 'sse', url: 'http://127.0.0.1:4100/sse' });
    expect(
      tomnyMcpServerCommand({
        name: 'tomny-ide',
        transport: 'streamable_http',
        url: 'http://127.0.0.1:4100/mcp',
      })
    ).toMatchObject({ name: 'tomny-ide', transport: 'sse', url: 'http://127.0.0.1:4100/sse' });
    expect(() =>
      tomnyMcpServerCommand({ name: 'http-tools', transport: 'streamable_http', url: 'http://127.0.0.1:4100/mcp' })
    ).toThrow('does not support HTTP MCP transport');
  });

  it('injects selected MCP servers even when ready only reports that none are configured yet', () => {
    const mcpServers = [{ name: 'ide-tools', transport: 'sse' as const, url: 'http://127.0.0.1:4100/sse' }];
    expect(tomnyShouldInitializeMcpServers({ type: 'ready', capabilities: { mcp: false } }, mcpServers)).toBe(true);
    expect(tomnyShouldInitializeMcpServers({ type: 'ready', capabilities: { mcp: true } }, mcpServers)).toBe(true);
    expect(tomnyShouldInitializeMcpServers({ type: 'ready' }, mcpServers)).toBe(true);
    expect(tomnyShouldInitializeMcpServers({ type: 'ready', capabilities: { mcp: false } }, [])).toBe(false);
  });

  it('allows safe Tomny reads but denies mutation in read-only mode', () => {
    expect(tomnyToolAccessForPermission('read-only', 'ToolSearch', 'info')).toBe('approve');

    expect(tomnyToolAccessForPermission('read-only', 'StartAction', 'info')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'tomny_read', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'ide_research', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'tomny_visual_analyze', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'tomny_team_status', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'agent_track', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'agent_spawn', 'mcp')).toBe('deny');
    expect(tomnyToolAccessForPermission('read-only', 'test_report', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'test_run', 'mcp')).toBe('deny');
    expect(tomnyToolAccessForPermission('read-only', 'browser_screenshot', 'mcp')).toBe('approve');
    expect(tomnyToolAccessForPermission('read-only', 'browser_secret_type', 'mcp')).toBe('deny');
    expect(tomnyToolAccessForPermission('read-only', 'tomny_edit', 'mcp')).toBe('deny');
    expect(tomnyToolAccessForPermission('read-only', 'tomny_command', 'mcp')).toBe('deny');

    expect(tomnyToolAccessForPermission('read-only', 'ide_memory_set_secret', 'mcp')).toBe('deny');
    expect(tomnyToolAccessForPermission('read-only', 'db_query', 'mcp')).toBe('deny');
  });

  it('prompts for workspace writes and auto-approves full-access Tomny requests', () => {
    expect(tomnyToolAccessForPermission('workspace-write', 'tomny_edit', 'mcp')).toBe('prompt');
    expect(tomnyToolAccessForPermission('full-access', 'tomny_command', 'mcp')).toBe('approve');
  });

  it('blocks native filesystem and shell tools even when full access is selected', () => {
    for (const nativeTool of ['Read', 'Write', 'Edit', 'ExecCommand', 'Grep', 'Glob', 'Spawn']) {
      expect(tomnyToolAccessForPermission('workspace-write', nativeTool, 'info')).toBe('deny');
      expect(tomnyToolAccessForPermission('full-access', nativeTool, 'exec')).toBe('deny');
    }
    expect(tomnyNativeToolDenialReason('Read')).toContain('tomny_read');
    expect(tomnyNativeToolDenialReason('ExecCommand')).toContain('tomny_command');
    expect(tomnyNativeToolDenialReason('Edit')).toContain('tomny_edit');
  });

  it('translates safe native tool schemas into Tomny MCP calls', () => {
    expect(translateNativeTomnyTool('Read', { file_path: 'C:/repo/src/a.ts', offset: 4, limit: 3 }, 'C:/repo')).toEqual(
      {
        name: 'tomny_read',
        arguments: { filePath: 'C:/repo/src/a.ts', from: 5, to: 7, lineNumbers: true },
      }
    );
    expect(translateNativeTomnyTool('Grep', { pattern: 'hello', path: 'src', glob: '*.ts' }, 'C:/repo')).toEqual({
      name: 'tomny_search',
      arguments: {
        rootPath: expect.stringMatching(/C:[\\/]repo[\\/]src/u),
        pattern: 'hello',
        glob: '*.ts',
        regex: false,
      },
    });
    expect(translateNativeTomnyTool('Glob', { pattern: '**/*.ts' }, 'C:/repo')).toEqual({
      name: 'tomny_glob',
      arguments: { dir: 'C:/repo', pattern: '**/*.ts', recursive: true },
    });
    expect(translateNativeTomnyTool('ExecCommand', { cmd: 'bun test', timeout: 5000 }, 'C:/repo')).toEqual({
      name: 'tomny_command',
      arguments: { rootPath: 'C:/repo', command: 'bun test', cwd: 'C:/repo', timeoutMs: 5000 },
    });
    expect(translateNativeTomnyTool('Write', { file_path: 'C:/repo/a.ts', content: 'x' }, 'C:/repo')).toEqual({
      name: 'tomny_write',
      arguments: { filePath: 'C:/repo/a.ts', content: 'x' },
    });
    expect(
      translateNativeTomnyTool('Edit', { file_path: 'C:/repo/a.ts', old_string: 'x', new_string: 'y' }, 'C:/repo')
    ).toEqual({
      name: 'tomny_edit',
      arguments: { filePath: 'C:/repo/a.ts', oldText: 'x', newText: 'y' },
    });
  });

  it('preserves arguments from every supported Tomny tool-request envelope', () => {
    expect(tomnyToolRequestInput({ input: { query: 'input' }, arguments: { query: 'arguments' } })).toEqual({
      query: 'input',
    });
    expect(tomnyToolRequestInput({ arguments: { name: 'fix-errors' } })).toEqual({ name: 'fix-errors' });
    expect(tomnyToolRequestInput({ args: { rootPath: 'C:/repo' } })).toEqual({ rootPath: 'C:/repo' });
    expect(tomnyToolRequestInput({ tool: { input: { filePath: 'a.ts' } } })).toEqual({ filePath: 'a.ts' });
    expect(tomnyToolRequestInput({ tool: { arguments: { command: 'bun test' } } })).toEqual({
      command: 'bun test',
    });
  });

  it('rejects incomplete skill workflow calls before MCP dispatch', () => {
    expect(preflightSkillWorkflowTool('skills_read', {})).toEqual({
      kind: 'error',
      message: expect.stringContaining('name is required'),
    });
    expect(preflightSkillWorkflowTool('skills_read', { name: 'fix-errors' })).toBeNull();
    expect(preflightSkillWorkflowTool('tools_recall', {})).toEqual({
      kind: 'error',
      message: expect.stringContaining('query is required'),
    });
    expect(preflightSkillWorkflowTool('skills_select', { goal: 'debug' })).toEqual({
      kind: 'error',
      message: expect.stringContaining('names is required'),
    });
    expect(preflightSkillWorkflowTool('skills_finish', { goal: 'debug' })).toEqual({
      kind: 'error',
      message: expect.stringContaining('succeeded is required'),
    });
    expect(preflightSkillWorkflowTool('ide_map', {})).toBeNull();
  });

  it('does not auto-translate incomplete or incompatible native tools', () => {
    expect(translateNativeTomnyTool('Write', { file_path: 'C:/repo/a.ts' }, 'C:/repo')).toBeNull();
    expect(translateNativeTomnyTool('Edit', {}, 'C:/repo')).toBeNull();
    expect(translateNativeTomnyTool('Spawn', {}, 'C:/repo')).toBeNull();
    expect(translateNativeTomnyTool('ExecCommand', { cmd: 'dir', shell: 'cmd' }, 'C:/repo')).toBeNull();
  });

  it('returns translated results through the host-result protocol command', () => {
    expect(tomnyProvidedToolResultCommand('call-1', 'translated output', false, 'tomny_read')).toEqual({
      type: 'tool_result',
      call_id: 'call-1',
      content: 'translated output',
      is_error: false,
      tool_name: 'tomny_read',
    });
  });

  it('keeps Tomny in host-controlled mode for every shared permission policy', () => {
    expect(tomnyModeForPermission('read-only')).toBe('default');
    expect(tomnyModeForPermission('workspace-write')).toBe('default');
    expect(tomnyModeForPermission('full-access')).toBe('default');
  });

  it('starts the CLI with an empty native auto-approval list', () => {
    expect(tomnyStrictToolsConfig).toContain('auto_approve = false');
    expect(tomnyStrictToolsConfig).toContain('allow_list = []');
    expect(tomnyStrictProjectArgs('C:/runtime/tomny-tools')).toEqual(['--project-dir', 'C:/runtime/tomny-tools']);
  });

  it('turns catalog keys into safe CLI arguments and rejects malformed config', () => {
    expect(tomnyModelArgs('tomny-default')).toEqual([]);
    expect(tomnyModelArgs('profile:fast')).toEqual(['--profile', 'fast']);
    expect(tomnyModelArgs('provider:openai:gpt-5.6')).toEqual(['--provider', 'openai', '--model', 'gpt-5.6']);
    expect(parseTomnyModelCatalog('[broken')).toEqual([]);
  });

  it('reuses one lightweight runtime when only model or permission changes', () => {
    const identity = { targetId: 'tomny', workspace: 'C:/work' };
    expect(tomnyRuntimeKey({ ...identity, modelKey: 'provider:openai:gpt-5.5', permissionMode: 'read-only' })).toBe(
      tomnyRuntimeKey({ ...identity, modelKey: 'provider:openai:gpt-5.6', permissionMode: 'full-access' })
    );
    expect(tomnyRuntimeKey({ ...identity, modelKey: 'app-provider:first:gpt-5.6' })).not.toBe(
      tomnyRuntimeKey({ ...identity, modelKey: 'app-provider:second:gpt-5.6' })
    );
  });

  it('rebuilds the runtime when Super changes the deferred ToolMap catalog', () => {
    const identity = { targetId: 'tomny', workspace: 'C:/work', surface: 'ide' };
    const regular = [{ name: 'tomny-ide', transport: 'sse' as const, url: 'http://127.0.0.1:4100/sse' }];
    const superCatalog = [
      { name: 'tomny-browser-control', transport: 'sse' as const, url: 'http://127.0.0.1:4200/sse' },
      ...regular,
    ];

    expect(tomnyRuntimeKey(identity, regular)).not.toBe(tomnyRuntimeKey(identity, superCatalog));
    expect(tomnyRuntimeKey(identity, superCatalog)).toBe(tomnyRuntimeKey(identity, [...regular, superCatalog[0]]));
    expect(tomnyRuntimeKey(identity, regular)).not.toBe(
      tomnyRuntimeKey(identity, [{ ...regular[0], url: 'http://127.0.0.1:4300/sse' }])
    );
  });

  it('separates surface-only and Super alias catalogs even with the same MCP servers', () => {
    const identity = { targetId: 'tomny', workspace: 'C:/work', surface: 'ide' };
    const servers = [{ name: 'tomny-ide', transport: 'sse' as const, url: 'http://127.0.0.1:4100/sse' }];
    const surfaceCatalog = { mode: 'surface' as const, patterns: ['ide_*', 'tomny_*'] };
    const superCatalog = { mode: 'super' as const, patterns: ['*'] };

    expect(tomnyRuntimeKey(identity, servers, surfaceCatalog)).not.toBe(
      tomnyRuntimeKey(identity, servers, superCatalog)
    );
    expect(tomnySurfaceSystemPrompt('ide', 'C:/work', superCatalog)).toContain('[TomnyToolCatalog] super');
  });

  it('deduplicates concurrent startup and evicts the least-recent idle session', async () => {
    let now = 0;
    const pool = new BoundedSessionPool({ maxSessions: 2, now: () => now });
    const makeSession = () => ({ isBusy: () => false, dispose: vi.fn() });
    const first = makeSession();
    const factory = vi.fn().mockResolvedValue(first);
    const [left, right] = await Promise.all([pool.getOrCreate('a', factory), pool.getOrCreate('a', factory)]);
    now = 1;
    await pool.getOrCreate('b', async () => makeSession());
    now = 2;
    await pool.getOrCreate('c', async () => makeSession());

    expect(left).toBe(right);
    expect(factory).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('automatically hibernates an idle Core process without requiring another request', async () => {
    vi.useFakeTimers();
    try {
      const pool = new BoundedSessionPool({ idleTimeoutMs: 1_000 });
      const session = { isBusy: () => false, dispose: vi.fn() };
      await pool.getOrCreate('idle', async () => session);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(session.dispose).toHaveBeenCalledOnce();
      expect(pool.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a stale process generation invalidate its replacement', async () => {
    const pool = new BoundedSessionPool();
    const oldSession = { isBusy: () => false, dispose: vi.fn() };
    const newSession = { isBusy: () => false, dispose: vi.fn() };
    await pool.getOrCreate('same', async () => oldSession);
    pool.invalidate('same', oldSession);
    await pool.getOrCreate('same', async () => newSession);

    expect(pool.invalidate('same', oldSession)).toBe(false);
    expect(pool.size).toBe(1);
  });
});

describe('persistent agent retry policy', () => {
  it('retries provider overload, network stalls, and unexpected process exits', () => {
    for (const error of [
      Object.assign(new Error('Too many requests'), { status: 429 }),
      new Error('Tomny produced no activity for 90s'),
      new Error('tomny exited with code 1'),
      new Error('HTTP 503 service unavailable'),
      new Error('500 Internal Server Error'),
      new Error('All API keys are busy'),
      new Error('unexpected status 404 Not Found: No active credentials for provider: openai'),
      new Error('RESOURCE_EXHAUSTED: Kiro is throttling requests'),
    ]) {
      expect(classifyAgentFailure(error)).toMatchObject({ kind: 'transient', retry: true });
    }
  });

  it('does not retry failures that require user or configuration changes', () => {
    const cases = [
      ['Maximum context length exceeded', 'context'],
      ['Invalid API key', 'auth'],
      ['HTTP 401: Your authentication token has been invalidated. Please try signing in again.', 'auth'],
      ['insufficient_quota: out of credits', 'quota'],
      ['Model is not configured', 'configuration'],
      ['Failed to start tomny: spawn EACCES', 'configuration'],
      ['Surface ide is unavailable; using chat.', 'configuration'],
      ['HTTP 404 Not Found', 'configuration'],
      ['Tool Read failed', 'tool'],
      ['Denied by user', 'permission'],
      ['The request was cancelled', 'cancelled'],
    ] as const;
    for (const [message, kind] of cases) {
      expect(classifyAgentFailure(new Error(message))).toMatchObject({ kind, retry: false });
    }
  });

  it('retries in batches of five, waits fifteen seconds, and keeps one logical output', async () => {
    const operation = vi.fn(async (attempt: number) => {
      if (attempt <= 6) throw Object.assign(new Error('provider overloaded'), { status: 429 });
      return 'completed';
    });
    const onBeforeRetry = vi.fn();
    const onStatus = vi.fn();
    const sleep = vi.fn(async () => undefined);

    await expect(
      withPersistentAgentRetry({
        operation,
        signal: new AbortController().signal,
        onBeforeRetry,
        onStatus,
        sleep,
      })
    ).resolves.toBe('completed');

    expect(operation).toHaveBeenCalledTimes(7);
    expect(onBeforeRetry).toHaveBeenCalledTimes(6);
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ batch: 2, nextAttemptInBatch: 1, remainingMs: 15_000 })
    );
    expect(sleep).toHaveBeenCalledTimes(6);
  });

  it('stops an endless retry batch immediately when the user aborts', async () => {
    const controller = new AbortController();
    const sleep = vi.fn(async () => {
      controller.abort();
    });
    const pending = withPersistentAgentRetry({
      operation: async () => {
        throw Object.assign(new Error('HTTP 429'), { status: 429 });
      },
      signal: controller.signal,
      sleep,
    });

    const error = await pending.catch((reason: unknown) => reason);
    expect(isRetryManagedError(error)).toBe(true);
    expect(error).toMatchObject({ message: 'The request was cancelled.' });
  });

  it('returns permanent errors without a second provider call', async () => {
    const operation = vi.fn(async () => {
      throw new Error('Maximum context length exceeded');
    });
    const error = await withPersistentAgentRetry({
      operation,
      signal: new AbortController().signal,
    }).catch((reason: unknown) => reason);

    expect(operation).toHaveBeenCalledOnce();
    expect(isRetryManagedError(error)).toBe(true);
  });

  it('removes the abort listener after a retry delay resolves', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const operation = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 429'), { status: 429 }))
      .mockResolvedValue('completed');
    const pending = withPersistentAgentRetry({
      operation,
      signal: controller.signal,
      retryDelayMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBe('completed');
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    vi.useRealTimers();
  });
});
