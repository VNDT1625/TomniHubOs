/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the built-in IDE MCP server — drives the `ide_*` tools through an
 * in-memory MCP client over the SDK's linked in-process transport, against a
 * fake {@link IdeMcpService} (no real filesystem walk needed).
 */

import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createIdeServer,
  type IdeMcpService,
  type IdeServerDeps,
  type QuickTestScenarioAgentService,
} from '@/process/ide/mcp/ideServer';
import { startIdeMcpHost } from '@/process/ide/mcp/ideMcpHost';
import { buildIdeServer } from '@/process/ide/mcp/ideMcpWiring';
import { createSessionMemoryStore } from '@/process/ide/memory/sessionMemoryStore';

const makeService = (overrides: Partial<IdeMcpService> = {}): IdeMcpService => ({
  listDir: vi.fn(async () => [
    { name: 'src', fullPath: '/repo/src', isDir: true },
    { name: 'readme.md', fullPath: '/repo/readme.md', isDir: false },
  ]),
  readFile: vi.fn(async () => ({
    text: 'file contents',
    lineStart: 1,
    lineEnd: 1,
    totalLines: 1,
    returnedLines: 1,
    truncated: false,
    binary: false,
    sizeBytes: 13,
  })),
  scanRepo: vi.fn(async () => ({
    fileCount: 3,
    edgeCount: 2,
    topGroups: [{ group: 'src', files: 3 }],
    truncated: false,
  })),
  search: vi.fn(async () => [{ file: 'src/a.ts', line: 10, text: 'const x = 1' }]),
  findDefinition: vi.fn(async () => [{ file: 'src/a.ts', line: 1, column: 7, text: 'export const x = 1' }]),
  findReferences: vi.fn(async () => [{ file: 'src/b.ts', line: 5, column: 3, text: 'use x here' }]),
  understand: vi.fn(async () => ({ summary: 'understand summary' })),
  compassRead: vi.fn(async () => ({ summary: 'compass slice' })),
  context: vi.fn(async () => ({ summary: 'context candidates' })),
  map: vi.fn(async () => ({ summary: 'map summary' })),
  analyze: vi.fn(async () => ({ summary: 'analyze summary' })),
  analyzeImage: vi.fn(async () => ({
    json: { schemaVersion: 1, image: { width: 10, height: 20 } },
    semanticText: 'Image: 10x20',
    mockUi: '[image]\n[/image]',
  })),
  compact: vi.fn(async () => ({ summary: 'compacted log' })),
  runCommand: vi.fn(async () => ({ code: 0, stdout: 'ok', stderr: '', timedOut: false, durationMs: 5 })),
  ...overrides,
});

describe('IDE MCP SSE host failures', () => {
  it('returns an HTTP error instead of leaving the handshake open when server construction fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = await startIdeMcpHost({
      buildServer: () => {
        throw new Error('server build failed');
      },
    });

    try {
      const response = await fetch(host.url);
      expect(response.status).toBe(500);
    } finally {
      await host.close();
      consoleSpy.mockRestore();
    }
  });
  it('does not return HTTP 500 when the production IDE server completes an SSE handshake', async () => {
    const host = await startIdeMcpHost({ buildServer: buildIdeServer });
    const abort = new AbortController();

    try {
      const response = await fetch(host.url, { signal: abort.signal });
      expect(response.status).toBe(200);
    } finally {
      abort.abort();
      await host.close();
    }
  });
});

describe('IDE MCP Streamable HTTP host', () => {
  it('accepts a Codex-style Streamable HTTP initialization request', async () => {
    const host = await startIdeMcpHost({ buildServer: buildIdeServer });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(host.mcpUrl));

    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await host.close();
    }
  });
});

const makeDeps = (overrides: Partial<IdeMcpService> = {}): IdeServerDeps => ({ ide: makeService(overrides) });

const makeQuickTestScenarios = (): QuickTestScenarioAgentService => ({
  list: vi.fn(async () => ({
    scenarios: [{ id: 'scenario-1', name: 'Login', platform: 'web', stepCount: 2, createdAt: 100 }],
    total: 1,
  })),
  describe: vi.fn(async () => ({
    id: 'scenario-1',
    name: 'Login',
    platform: 'web',
    stepCount: 2,
    createdAt: 100,
    rootPath: '/repo',
    steps: [{ id: 'step-1', kind: 'navigate', url: 'http://localhost:3000' }],
  })),
  run: vi.fn(async () => ({
    runId: 'run-1',
    scenarioId: 'scenario-1',
    status: 'queued',
    queuedAt: 200,
  })),
  status: vi.fn(async () => ({
    runId: 'run-1',
    scenarioId: 'scenario-1',
    status: 'passed',
    queuedAt: 200,
    finishedAt: 300,
  })),
  cancel: vi.fn(async () => ({
    runId: 'run-1',
    scenarioId: 'scenario-1',
    status: 'cancelled',
    queuedAt: 200,
    finishedAt: 250,
  })),
  compare: vi.fn(async () => ({ baselineRunId: 'run-bad', currentRunId: 'run-fixed', newErrors: [] })),
});

/** Connect a client to the server over a linked in-memory transport pair. */
const connect = async (deps: IdeServerDeps) => {
  const server = createIdeServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

/** Pull the text out of an MCP tool result. */
const textOf = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
};

describe('ideServer', () => {
  it('exposes the expected ide_* tool set', async () => {
    const client = await connect(makeDeps());
    const { tools } = await client.listTools();
    expect(
      tools
        .map((tool) => tool.name)
        .filter((name) => name.startsWith('ide_'))
        .toSorted()
    ).toEqual([
      'ide_analyze',
      'ide_analyze_image',
      'ide_command',
      'ide_compact',
      'ide_compass',
      'ide_context',
      'ide_find_definition',
      'ide_find_references',
      'ide_glob',
      'ide_grep',
      'ide_info',
      'ide_list_dir',
      'ide_map',
      'ide_read_file',
      'ide_research',
      'ide_scan_repo',
      'ide_search',
      'ide_summary',
      'ide_test_script',
    ]);
  });

  it('builds one bounded MTUI research pack and reads ranked files in parallel', async () => {
    const compassRead = vi.fn(async (_rootPath: string, filePath: string) => ({
      summary: `focused slice for ${filePath}`,
    }));
    const map = vi.fn(async () => ({
      summary: 'ranked candidates',
      details: {
        candidates: [
          { path: 'src/send.ts', summary: 'send flow' },
          { path: 'src/service.ts', summary: 'business logic' },
          { path: 'src/ui.tsx', summary: 'renderer' },
        ],
      },
    }));
    const deps = makeDeps({ map, compassRead });
    const client = await connect(deps);

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'trace the message send flow', maxFiles: 2, maxLinesPerFile: 80 },
    });

    expect(map).toHaveBeenCalledWith('/repo', 'intent', 'trace the message send flow', 2);
    expect(compassRead).toHaveBeenCalledTimes(2);
    expect(compassRead).toHaveBeenCalledWith('/repo', 'src/send.ts', 'trace the message send flow', 80);
    expect(compassRead).toHaveBeenCalledWith('/repo', 'src/service.ts', 'trace the message send flow', 80);
    expect(textOf(result)).toContain('MTUI research pack');
    expect(textOf(result)).toContain('focused slice for src/send.ts');
    expect(textOf(result)).not.toContain('src/ui.tsx');
  });

  it('treats blank optional research targets as omitted', async () => {
    const map = vi.fn(async () => ({
      summary: 'ranked candidates',
      details: { candidates: [{ path: 'src/send.ts' }] },
    }));
    const client = await connect(makeDeps({ map }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'trace the primary user flow',
        mode: 'flow',
        targetFile: ' ',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(map).toHaveBeenCalledOnce();
  });

  it('normalizes a generic architecture survey without searching its checklist or negative test instruction', async () => {
    const researchExact = vi.fn(async () => ({ hits: [] }));
    const map = vi.fn(async (_rootPath: string, scope: 'repo' | 'folder' | 'intent') =>
      scope === 'repo'
        ? {
            summary: 'repository map',
            details: { overview: { tagline: 'DESKTOP AGENTIC CHAT OVERVIEW', technologies: ['Electron', 'React'] } },
          }
        : {
            summary: 'primary application path',
            details: { candidates: [{ path: 'packages/desktop/src/common/adapter/ipcBridge.ts' }] },
          }
    );
    const ide = Object.assign(makeService({ map }), { researchExact });
    const client = await connect({ ide });

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent:
          'Điều tra chỉ-đọc repository: xác định mục đích, kiến trúc tổng thể và truy vết một luồng quan trọng từ hành động người dùng qua entry point, validation, business logic, storage, error handling đến UI. Không chạy test/build.',
        mode: 'flow',
        target: 'repository architecture and primary user action flow',
        errorText: 'no specific error; read-only architecture investigation',
      },
    });

    expect(map).toHaveBeenCalledWith('/repo', 'intent', expect.stringContaining('primary application user action'), 18);
    expect(map).toHaveBeenCalledWith('/repo', 'repo', undefined, 6);
    expect(researchExact).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({
        queries: expect.arrayContaining(['sendMessage.invoke', 'runtime.start', 'responseStream.on']),
        symbols: expect.arrayContaining(['sendMessage', 'executeCommand', 'responseStream']),
      })
    );
    expect(textOf(result)).toContain('DESKTOP AGENTIC CHAT OVERVIEW');
  });

  it('covers every causal flow stage before unrelated high-ranked subsystems', async () => {
    const route = [
      'packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsSendBox.tsx',
      'packages/desktop/src/common/adapter/ipcBridge.ts',
      'packages/desktop/src/process/services/database/nativeConversation/bridge.ts',
      'packages/desktop/src/process/services/database/nativeConversation/service.ts',
      'packages/desktop/src/process/services/database/nativeConversation/repository.ts',
      'packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts',
    ];
    const unrelated = [
      'packages/desktop/src/common/adapter/browser.ts',
      'packages/desktop/src/process/utils/initStorage.ts',
      'packages/desktop/src/process/services/tomnyProviderBridge.ts',
      'packages/desktop/src/process/company/companyOrchestrator.ts',
      'packages/desktop/src/common/utils/urlValidation.ts',
    ];
    const map = vi.fn(async (_rootPath: string, scope: 'repo' | 'folder' | 'intent') =>
      scope === 'repo'
        ? { summary: 'repository map', details: { overview: { tagline: 'Agent chat application' } } }
        : {
            summary: 'mixed ranked files',
            details: {
              candidates: [...unrelated, route[1], route[3], route[2], route[4], route[0], route[5]].map((path) => ({
                path,
              })),
            },
          }
    );
    const compassRead = vi.fn(async (_rootPath: string, filePath: string) => ({ summary: filePath }));
    const researchExact = vi.fn(async () => ({
      hits: [
        { file: route[0], line: 282, text: 'ipcBridge.conversation.sendMessage.invoke()', kind: 'text' as const },
        { file: route[1], line: 640, text: "'conversation.native.send'", kind: 'text' as const },
        { file: route[2], line: 55, text: 'registerNativeConversationBridge service.send', kind: 'text' as const },
        { file: route[3], line: 752, text: 'this.runtime.start()', kind: 'text' as const },
        { file: route[4], line: 210, text: 'async saveMessage()', kind: 'text' as const },
        { file: route[5], line: 233, text: 'responseStream.on()', kind: 'text' as const },
      ],
    }));
    const listDir = vi.fn(async () => [
      { name: 'package.json', fullPath: '/repo/package.json', isDir: false },
      { name: 'packages', fullPath: '/repo/packages', isDir: true },
    ]);
    const readFile = vi.fn(async (filePath: string) => ({
      text: filePath.endsWith('package.json')
        ? JSON.stringify({
            name: 'omni-agentic',
            productName: 'Tomni',
            description: 'Tomni personal agentic operating system.',
            author: { name: 'Tomni' },
            main: './out/main/index.js',
            workspaces: ['packages/*'],
            scripts: { start: 'electron-vite dev', noise: 'MANIFEST_NOISE' },
            dependencies: { electron: '1.0.0', react: '1.0.0' },
          })
        : 'anchored source evidence',
      lineStart: 1,
      lineEnd: 1,
      totalLines: 1,
      returnedLines: 1,
      truncated: false,
      binary: false,
      sizeBytes: 24,
    }));
    const client = await connect(makeDeps({ listDir, map, compassRead, researchExact, readFile }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent:
          'Điều tra kiến trúc repository và truy vết một luồng quan trọng từ hành động người dùng qua business logic đến response UI.',
        mode: 'flow',
        target: 'repository architecture and primary user action flow',
        symbols: ['sendMessage'],
        maxFiles: 10,
      },
    });
    const text = textOf(result);
    const positions = route.map((path) => text.indexOf(`] ${path}`));

    expect(route.every((path) => text.includes(path))).toBe(true);
    expect(unrelated.every((path) => !text.includes(path))).toBe(true);
    expect(
      positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))
    ).toBe(true);
    expect(compassRead).toHaveBeenCalledWith(
      '/repo',
      route[3],
      expect.stringContaining('Stage focus: NativeConversationService runtime.start repository.saveMessage'),
      120
    );
    expect(text).toContain(
      'Verified flow stages: ui-input -> contract -> process-bridge -> service-runtime -> persistence -> response-ui'
    );
    expect(text).toContain('Verified candidates inspected: 6/6');
    expect(text).toContain('## Verified repository identity');
    expect(text).toContain('"name": "omni-agentic"');
    expect(text).toContain('"productName": "Tomni"');
    expect(text).toContain('"author": "Tomni"');
    expect(text).toContain('"main": "./out/main/index.js"');
    expect(text).not.toContain('MANIFEST_NOISE');
    expect(text.match(/^### \[E\d+\]/gm)).toHaveLength(6);
    expect(text.match(/package\.json \[stage=/g)).toBeNull();
    expect(compassRead).toHaveBeenCalledTimes(6);
    expect(readFile).toHaveBeenCalledWith(
      '/repo/packages/desktop/src/process/services/database/nativeConversation/service.ts',
      { all: true, lineNumbers: false }
    );
  });

  it('keeps every research candidate inside an explicit directory target', async () => {
    const researchExact = vi.fn(async () => ({
      hits: [
        {
          file: 'mobile/src/context/ChatContext.tsx',
          line: 40,
          text: 'const sendMessage = async () => {}',
          kind: 'definition' as const,
        },
        {
          file: 'packages/desktop/src/common/adapter/ipcBridge.ts',
          line: 100,
          text: 'sendMessage: bridge.buildProvider()',
          kind: 'definition' as const,
        },
      ],
    }));
    const compassRead = vi.fn(async (_rootPath: string, filePath: string) => ({ summary: filePath }));
    const ide = Object.assign(
      makeService({
        map: vi.fn(async () => ({
          summary: 'desktop chat flow',
          details: {
            candidates: [
              { path: 'packages/desktop/src/process/services/database/nativeConversation/service.ts' },
              { path: 'mobile/src/context/ChatContext.tsx' },
            ],
          },
        })),
        compassRead,
      }),
      { researchExact }
    );
    const client = await connect({ ide });

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'Trace the desktop chat message flow',
        mode: 'flow',
        target: 'packages/desktop',
        symbols: ['sendMessage'],
        maxFiles: 3,
      },
    });
    const inspectedPaths = compassRead.mock.calls.map((call) => call[1]);

    expect(inspectedPaths.every((path) => path.startsWith('packages/desktop/'))).toBe(true);
    expect(textOf(result)).not.toContain('mobile/src/context/ChatContext.tsx');
  });

  it('uses one intent Tool Map pass without duplicating semantic output', async () => {
    const context = vi.fn(async () => ({ summary: 'REDUNDANT CONTEXT MUST NOT RUN' }));
    const map = vi.fn(async () => ({
      summary: 'GRAPH MAP UNIQUE MARKER',
      details: { candidates: [{ path: 'src/send.ts', summary: 'send flow' }] },
    }));
    const client = await connect(
      makeDeps({
        context,
        map,
        search: vi.fn(async () => []),
        findDefinition: vi.fn(async () => []),
        findReferences: vi.fn(async () => []),
      })
    );

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'trace graph flow', maxFiles: 1 },
    });
    const text = textOf(result);

    expect(map).toHaveBeenCalledOnce();
    expect(map).toHaveBeenCalledWith('/repo', 'intent', 'trace graph flow', 1);
    expect(context).not.toHaveBeenCalled();
    expect(text.match(/GRAPH MAP UNIQUE MARKER/g)).toHaveLength(1);
    expect(text).toContain('## Graph map');
    expect(text).not.toMatch(/## Ranked context|## Intent map/);
  });

  it('adds only strong automatic ExpBase guidance and a conditional external-search decision in bug mode', async () => {
    const experience = {
      search: vi.fn(async () => [
        {
          entryId: 'exp-strong-enough',
          score: 0.84,
          kind: 'successful_fix' as const,
          symptom: 'HTTP 404 route mapping',
          lesson: 'Rank route-domain evidence before generic API tokens.',
          whyRelevant: ['same network symptom'],
          caution: [],
          suggestedChecks: ['replay the same request'],
        },
        {
          entryId: 'exp-weak',
          score: 0.7,
          kind: 'successful_fix' as const,
          symptom: 'unrelated weak match',
          lesson: 'Do not inject this automatically.',
          whyRelevant: [],
          caution: [],
          suggestedChecks: [],
        },
      ]),
      record: vi.fn(),
      recordFeedback: vi.fn(),
      verifyOutcome: vi.fn(),
    };
    const client = await connect({ ide: makeService(), experience });

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'Debug HTTP 404 route mapping',
        mode: 'bug',
        errorText: 'GET /api/v1/billing/invoices/42 returned HTTP 404',
        maxFiles: 1,
      },
    });
    const text = textOf(result);

    expect(experience.search).toHaveBeenCalledWith('/repo', expect.any(Object), { topK: 5, minScore: 0.6 });
    expect(text).toContain('## WorkStatus');
    expect(text).toContain('exp-strong-enough');
    expect(text).not.toContain('exp-weak');
    expect(text).toContain('External search: NORMAL');
  });

  it('deduplicates an identical research request while the first MTUI pack is in flight', async () => {
    const map = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return { summary: 'DEDUP MAP', details: { candidates: [{ path: 'src/send.ts' }] } };
    });
    const researchExact = vi.fn(async () => ({ hits: [] }));
    const client = await connect({ ide: Object.assign(makeService({ map }), { researchExact }) });
    const args = {
      rootPath: '/repo',
      intent: '  trace   message flow  ',
      mode: 'flow' as const,
      symbols: ['sendMessage', 'executeCommand'],
      maxFiles: 2,
    };

    const [first, second] = await Promise.all([
      client.callTool({ name: 'ide_research', arguments: args }),
      client.callTool({
        name: 'ide_research',
        arguments: { ...args, intent: 'trace message flow', symbols: ['executeCommand', 'sendMessage'] },
      }),
    ]);

    expect(textOf(first)).toBe(textOf(second));
    expect(map).toHaveBeenCalledOnce();
    expect(researchExact).toHaveBeenCalledOnce();
  });

  it('reads ranked fallback candidates produced by the node IDE service', async () => {
    const compassRead = vi.fn(async (_rootPath: string, filePath: string) => ({
      summary: `fallback slice for ${filePath}`,
    }));
    const map = vi.fn(async () => ({
      summary: 'filesystem-ranked candidates',
      stale: true,
      details: { ranked: [{ file: 'src/fallback.ts', score: 2 }] },
    }));
    const client = await connect(makeDeps({ map, compassRead }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'fallback research' },
    });

    expect(compassRead).toHaveBeenCalledWith('/repo', 'src/fallback.ts', 'fallback research', 120);
    expect(textOf(result)).toContain('fallback slice for src/fallback.ts');
  });

  it('keeps successful research slices when one ranked Compass read fails', async () => {
    const compassRead = vi.fn(async (_rootPath: string, filePath: string) => {
      if (filePath === 'src/broken.ts') throw new Error('index entry is stale');
      return { summary: `focused slice for ${filePath}` };
    });
    const map = vi.fn(async () => ({
      summary: 'ranked candidates',
      details: { candidates: [{ path: 'src/broken.ts' }, { path: 'src/good.ts' }] },
    }));
    const client = await connect(makeDeps({ map, compassRead }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'partial research' },
    });
    const text = textOf(result);

    expect(result.isError).not.toBe(true);
    expect(text).toContain('src/broken.ts');
    expect(text).toContain('index entry is stale');
    expect(text).toContain('focused slice for src/good.ts');
  });

  it('preserves verified current source and reports a gap when Compass rejects', async () => {
    const map = vi.fn(async () => ({
      summary: 'ranked candidates',
      details: { candidates: [{ path: 'src/current.ts' }] },
    }));
    const compassRead = vi.fn(async () => {
      throw new Error('Compass temporarily unavailable');
    });
    const readFile = vi.fn(async () => ({
      text: 'CURRENT SOURCE SURVIVES',
      lineStart: 1,
      lineEnd: 1,
      totalLines: 1,
      returnedLines: 1,
      truncated: false,
      binary: false,
      sizeBytes: 23,
    }));
    const client = await connect(makeDeps({ map, compassRead, readFile }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'trace CurrentService', maxFiles: 1 },
    });
    const text = textOf(result);

    expect(result.isError).not.toBe(true);
    expect(text).toContain('Current source excerpt:\n1: CURRENT SOURCE SURVIVES');
    expect(text).toContain('Compass failed for src/current.ts: Compass temporarily unavailable');
    expect(text).not.toContain('src/current.ts [stale]');
    expect(text).toContain('Verified candidates inspected: 1/1');
  });

  it('hard-caps the complete research pack even when services return pathological output', async () => {
    const huge = 'x'.repeat(50_000);
    const candidates = Array.from({ length: 12 }, (_, index) => ({ path: `src/file-${index}.ts` }));
    const map = vi.fn(async () => ({ summary: huge, details: { candidates } }));
    const compassRead = vi.fn(async () => ({ summary: huge }));
    const client = await connect(makeDeps({ map, compassRead }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'bounded research', maxFiles: 12, maxLinesPerFile: 240 },
    });

    expect(textOf(result).length).toBeLessThanOrEqual(32_000);
    expect(textOf(result)).toContain('[some evidence slices clipped to their per-file budget]');
  });

  it('replaces a nonexistent stale graph candidate with verified exact symbol evidence', async () => {
    const map = vi.fn(async () => ({
      summary: 'stale graph result',
      stale: true,
      details: { candidates: [{ path: 'src/removedConversationService.ts' }] },
    }));
    const search = vi.fn(async (_rootPath: string, query: string) =>
      query === 'NativeConversationService'
        ? [
            {
              file: 'src/nativeConversation/service.ts',
              line: 42,
              text: 'export class NativeConversationService',
            },
          ]
        : []
    );
    const findDefinition = vi.fn(async () => [
      {
        file: 'src/nativeConversation/service.ts',
        line: 42,
        column: 14,
        text: 'export class NativeConversationService',
      },
    ]);
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath.includes('removedConversationService')) throw new Error('ENOENT');
      return {
        text: 'export class NativeConversationService {\n  async send() {}\n}',
        lineStart: 42,
        lineEnd: 43,
        totalLines: 90,
        returnedLines: 2,
        truncated: false,
        binary: false,
        sizeBytes: 64,
      };
    });
    const compassRead = vi.fn(async () => ({
      summary: '42: export class NativeConversationService\n43:   async send() {}',
    }));
    const client = await connect(makeDeps({ map, search, findDefinition, readFile, compassRead }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'Trace `NativeConversationService` from IPC to runtime',
        mode: 'flow',
        symbols: ['NativeConversationService'],
      },
    });
    const text = textOf(result);

    expect(search).toHaveBeenCalledWith('/repo', 'NativeConversationService', expect.any(Object));
    expect(findDefinition).toHaveBeenCalledWith('/repo', 'NativeConversationService', expect.any(Number));
    expect(text).toContain('42: export class NativeConversationService');
    expect(text).not.toContain('src/removedConversationService.ts');
  });

  it('returns source and test evidence together for a distinctive bug signature', async () => {
    const errorText = 'TypeError: session.current is undefined at restoreSession';
    const search = vi.fn(async (_rootPath: string, query: string) => {
      if (query.includes('session.current')) {
        return [{ file: 'src/session/restoreSession.ts', line: 18, text: 'return session.current.id' }];
      }
      if (query === 'restoreSession') {
        return [
          { file: 'src/session/restoreSession.ts', line: 12, text: 'export function restoreSession' },
          { file: 'tests/session/restoreSession.test.ts', line: 30, text: "it('restores the active session'" },
        ];
      }
      return [];
    });
    const findDefinition = vi.fn(async () => [
      { file: 'src/session/restoreSession.ts', line: 12, column: 17, text: 'export function restoreSession' },
    ]);
    const compassRead = vi.fn(async (_rootPath: string, filePath: string) => ({
      summary:
        filePath === 'src/session/restoreSession.ts'
          ? 'SOURCE EVIDENCE: session.current is read without a null guard'
          : 'TEST EVIDENCE: missing regression for an absent current session',
    }));
    const client = await connect(
      makeDeps({
        map: vi.fn(async () => ({ summary: 'no reliable graph candidates', stale: true, details: {} })),
        search,
        findDefinition,
        compassRead,
      })
    );

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'Find the root cause and regression coverage for restoreSession',
        mode: 'bug',
        errorText,
        symbols: ['restoreSession'],
      },
    });
    const text = textOf(result);

    expect(search).toHaveBeenCalledWith('/repo', expect.stringContaining('session.current'), expect.any(Object));
    expect(text).toContain('SOURCE EVIDENCE');
    expect(text).toContain('TEST EVIDENCE');
  });

  it('surfaces cross-layer predicate contradictions in the bug root-cause gate', async () => {
    const files: Record<string, string> = {
      '/repo/src/quickTestBuffer.ts': [
        'export const isErrorEvent = (event: Event) =>',
        "  event.kind === 'network' && (event.status >= 400 || Boolean(event.error));",
      ].join('\n'),
      '/repo/src/traceContextBuilder.ts': [
        'export const mapNetwork = (ev: Event) =>',
        "  ev.kind === 'network' && (ev.status >= 500 || Boolean(ev.error));",
      ].join('\n'),
    };
    const researchExact = vi.fn(async () => ({
      hits: [
        { file: 'src/quickTestBuffer.ts', line: 2, text: 'event.status >= 400', kind: 'text' as const },
        { file: 'src/traceContextBuilder.ts', line: 2, text: 'ev.status >= 500', kind: 'text' as const },
      ],
    }));
    const readFile = vi.fn(async (filePath: string) => ({
      text: files[filePath] ?? '',
      lineStart: 1,
      lineEnd: 2,
      totalLines: 2,
      returnedLines: 2,
      truncated: false,
      binary: false,
      sizeBytes: (files[filePath] ?? '').length,
    }));
    const ide = Object.assign(
      makeService({
        map: vi.fn(async () => ({
          summary: 'quick test network pipeline',
          details: { candidates: [{ path: 'src/quickTestBuffer.ts' }, { path: 'src/traceContextBuilder.ts' }] },
        })),
        readFile,
      }),
      { researchExact }
    );
    const wikiTestIntelligence = {
      plan: vi.fn(async () => ({
        source: 'wiki+live-graph' as const,
        strategy: 'unit' as const,
        targetFiles: ['src/traceContextBuilder.ts'],
        targetSymbols: ['mapNetwork'],
        testFiles: ['tests/unit/traceContextBuilder.test.ts'],
        fixtureSymbols: ['makeTrace'],
        behaviorHints: ['Existing test evidence: maps failed requests into context'],
        testCommands: ['.: bunx vitest run'],
        typecheckCommands: ['.: bunx tsc --noEmit'],
        verificationGates: [
          'Add a failing regression and confirm it fails before editing.',
          'Rerun the identical reproduction after editing.',
        ],
        deepRuntimeRecommended: false,
        confidence: 'high' as const,
        freshness: {
          graphBuiltAt: 10,
          wikiBuiltAt: 9,
          graphFresh: true,
          wikiFresh: false,
          targetFingerprints: { 'src/traceContextBuilder.ts': 'fp' },
        },
      })),
    };
    const client = await connect({ ide, wikiTestIntelligence });

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        mode: 'bug',
        intent: 'A recorded HTTP 404 is missing from the ContextPack',
        errorText: 'GET /api/missing returned 404 but no API/service target was mapped',
        symbols: ['isErrorEvent', 'mapNetwork'],
      },
    });
    const text = textOf(result);

    expect(researchExact).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ queries: expect.arrayContaining(['status', 'network', 'firstError']) })
    );
    expect(text).toContain('## Root-cause gate');
    expect(text).toContain('CROSS-LAYER CONTRADICTION FOUND');
    expect(text).toContain('src/quickTestBuffer.ts:2 — event.status >= 400');
    expect(text).toContain('src/traceContextBuilder.ts:2 — ev.status >= 500');
    expect(text).toContain('failing reproduction before changing code');
    expect(wikiTestIntelligence.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        rootPath: '/repo',
        graphFresh: true,
        symbols: expect.arrayContaining(['isErrorEvent', 'mapNetwork']),
        targetFiles: expect.arrayContaining(['src/quickTestBuffer.ts', 'src/traceContextBuilder.ts']),
      })
    );
    expect(text).toContain('## Wiki-guided test profile');
    expect(text).toContain('tests/unit/traceContextBuilder.test.ts');
    expect(text).toContain('Deep runtime evidence: not required');
  });

  it('uses one optional exact-search batch instead of serial exact lookups', async () => {
    const researchExact = vi.fn(
      async (
        _rootPath: string,
        _request: { queries: string[]; symbols: string[]; includeTests: boolean; maxResults: number }
      ) => ({
        hits: [
          {
            file: 'src/nativeConversation/service.ts',
            line: 42,
            text: 'export class NativeConversationService',
            kind: 'definition' as const,
          },
          {
            file: 'tests/nativeConversation/service.test.ts',
            line: 18,
            text: "it('starts the runtime')",
            kind: 'text' as const,
          },
        ],
      })
    );
    const search = vi.fn(async () => []);
    const findDefinition = vi.fn(async () => []);
    const findReferences = vi.fn(async () => []);
    const ide = Object.assign(
      makeService({
        map: vi.fn(async () => ({ summary: 'stale graph', stale: true, details: {} })),
        compassRead: vi.fn(async (_rootPath: string, filePath: string) => ({
          summary: `verified evidence for ${filePath}`,
        })),
        search,
        findDefinition,
        findReferences,
      }),
      { researchExact }
    );
    const client = await connect({ ide });

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'Trace NativeConversationService and its tests',
        mode: 'flow',
        symbols: ['NativeConversationService'],
      },
    });

    expect(researchExact).toHaveBeenCalledOnce();
    expect(researchExact).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ symbols: ['NativeConversationService'], includeTests: true })
    );
    expect(search).not.toHaveBeenCalled();
    expect(findDefinition).not.toHaveBeenCalled();
    expect(findReferences).not.toHaveBeenCalled();
    expect(textOf(result)).toContain('tests/nativeConversation/service.test.ts');
  });

  it('answers a target-file purpose query from focused MTUI evidence without a repo-wide search', async () => {
    const understand = vi.fn(async () => ({
      summary: 'ROLE: owns bounded persistence and recall for one IDE session',
    }));
    const compassRead = vi.fn(async () => ({
      summary: 'SYMBOLS: createSessionMemoryStore, remember, recall, compact',
    }));
    const readFile = vi.fn(async () => ({
      text: 'export const createSessionMemoryStore = () => ({ remember, recall, compact });',
      lineStart: 1,
      lineEnd: 1,
      totalLines: 400,
      returnedLines: 1,
      truncated: true,
      binary: false,
      sizeBytes: 20_000,
    }));
    const search = vi.fn(async () => []);
    const context = vi.fn(async () => ({ summary: 'broad context should not be needed' }));
    const map = vi.fn(async () => ({ summary: 'broad map should not be needed' }));
    const client = await connect(makeDeps({ understand, compassRead, readFile, search, context, map }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'What is this file for?',
        mode: 'purpose',
        targetFile: 'src/memory/sessionMemoryStore.ts',
      },
    });
    const text = textOf(result);

    expect(understand).toHaveBeenCalledWith('/repo', 'src/memory/sessionMemoryStore.ts', 'file', true);
    expect(text).toContain('ROLE: owns bounded persistence and recall');
    expect(search).not.toHaveBeenCalled();
    expect(context).not.toHaveBeenCalled();
    expect(map).not.toHaveBeenCalled();
  });

  it('does not claim a file purpose was resolved when only current source was verified', async () => {
    const understand = vi.fn(async () => ({ summary: 'stale role', stale: true }));
    const compassRead = vi.fn(async () => ({ summary: 'stale symbols', stale: true }));
    const readFile = vi.fn(async () => ({
      text: 'export const currentSource = true;',
      lineStart: 1,
      lineEnd: 1,
      totalLines: 1,
      returnedLines: 1,
      truncated: false,
      binary: false,
      sizeBytes: 34,
    }));
    const client = await connect(makeDeps({ understand, compassRead, readFile }));

    const result = await client.callTool({
      name: 'ide_research',
      arguments: {
        rootPath: '/repo',
        intent: 'What is this file for?',
        mode: 'purpose',
        targetFile: 'src/current.ts',
      },
    });
    const text = textOf(result);

    expect(text).toContain('Status: target source verified; semantic purpose evidence unavailable.');
    expect(text).not.toContain('target purpose resolved');
    expect(text).toContain('Stale Understand role rejected.');
    expect(text).toContain('Stale Compass evidence rejected.');
  });

  it('keeps a bounded partial pack when an optional exact-search dependency fails', async () => {
    const researchExact = vi.fn(async () => {
      throw new Error('exact index temporarily unavailable');
    });
    const huge = 'x'.repeat(50_000);
    const compassRead = vi.fn(async () => ({ summary: `VERIFIED COMPASS EVIDENCE\n${huge}` }));
    const ide = Object.assign(
      makeService({
        map: vi.fn(async () => ({
          summary: huge,
          details: { candidates: [{ path: 'src/current.ts' }] },
        })),
        compassRead,
      }),
      { researchExact }
    );
    const client = await connect({ ide });

    const result = await client.callTool({
      name: 'ide_research',
      arguments: { rootPath: '/repo', intent: 'trace CurrentService', symbols: ['CurrentService'] },
    });
    const text = textOf(result);

    expect(result.isError).not.toBe(true);
    expect(text.length).toBeLessThanOrEqual(32_000);
    expect(text).toContain('VERIFIED COMPASS EVIDENCE');
    expect(text).toContain('exact index temporarily unavailable');
  });

  it('exposes the neutral tomny_* tool layer and routes aliases to IDE services', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const names = (await client.listTools()).tools
      .map((tool) => tool.name)
      .filter((name) => name.startsWith('tomny_'))
      .toSorted();

    expect(names).toEqual([
      'tomny_analyze',
      'tomny_analyze_image',
      'tomny_command',
      'tomny_compact',
      'tomny_context',
      'tomny_glob',
      'tomny_map',
      'tomny_read',
      'tomny_search',
      'tomny_visual_analyze',
    ]);

    const read = await client.callTool({
      name: 'tomny_read',
      arguments: { filePath: '/repo/src/a.ts', all: null, maxLines: 20 },
    });
    expect(deps.ide.readFile).toHaveBeenCalledWith('/repo/src/a.ts', {
      all: undefined,
      from: undefined,
      to: undefined,
      maxLines: 20,
      maxBytes: undefined,
      lineNumbers: undefined,
    });
    expect(textOf(read)).toContain('file contents');
  });

  it('publishes executable schemas with required Tomny workspace arguments', async () => {
    const client = await connect(makeDeps());
    const tools = (await client.listTools()).tools;
    const requiredFor = (name: string): string[] => {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as { required?: string[] } | undefined;
      return schema?.required ?? [];
    };

    expect(requiredFor('tomny_read')).toEqual(['filePath']);
    expect(requiredFor('tomny_glob')).toEqual(expect.arrayContaining(['dir', 'pattern']));
    expect(requiredFor('tomny_search')).toEqual(expect.arrayContaining(['rootPath', 'query']));
    expect(requiredFor('tomny_context')).toEqual(expect.arrayContaining(['rootPath', 'intent']));
    expect(requiredFor('tomny_command')).toEqual(expect.arrayContaining(['rootPath', 'command']));
  });

  it('publishes required legacy IDE arguments and rejects blank values', async () => {
    const client = await connect(makeDeps());
    const tools = (await client.listTools()).tools;
    const requiredFor = (name: string): string[] =>
      (tools.find((tool) => tool.name === name)?.inputSchema as { required?: string[] } | undefined)?.required ?? [];

    expect(requiredFor('ide_read_file')).toEqual(['filePath']);
    expect(requiredFor('ide_search')).toEqual(expect.arrayContaining(['rootPath', 'query']));
    expect(requiredFor('ide_grep')).toEqual(expect.arrayContaining(['rootPath', 'pattern']));
    expect(requiredFor('ide_find_definition')).toEqual(expect.arrayContaining(['rootPath', 'name']));

    const blankRead = await client.callTool({ name: 'ide_read_file', arguments: { filePath: '   ' } });
    expect(blankRead.isError).toBe(true);
  });

  it('rejects a null required Tomny argument at the MCP schema boundary', async () => {
    const client = await connect(makeDeps());
    const result = await client.callTool({ name: 'tomny_read', arguments: { filePath: null } });

    expect(result.isError).toBe(true);
  });

  it('exposes ide_quick_test when a Quick Test runner is injected', async () => {
    const runSession = vi.fn(async () => ({
      trace: {
        platform: 'web',
        events: [
          { kind: 'network', at: 100, method: 'GET', url: '/api/missing', status: 404 },
          { kind: 'console', at: 120, level: 'error', text: 'request failed' },
        ],
        firstError: { kind: 'network', at: 100, status: 404 },
        startedAt: 0,
        stoppedAt: 1000,
      },
      contextPack: { slices: [{ path: 'src/a.ts', layer: 'ui' }], renderedContext: '## trace' },
      screenshotPath: '/repo/.tomni/quick-test/agent-evidence/quick-test-1.png',
    }));
    const client = await connect({ ide: makeService(), quickTest: { runSession } });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('ide_quick_test');

    const result = await client.callTool({
      name: 'ide_quick_test',
      arguments: { platform: 'web', rootPath: '/repo', durationMs: 1000 },
    });
    expect(runSession).toHaveBeenCalledWith({
      platform: 'web',
      rootPath: '/repo',
      target: undefined,
      durationMs: 1000,
      captureScreenshot: undefined,
    });
    expect(textOf(result)).toContain('src/a.ts');
    expect(textOf(result)).toContain('"eventCount": 2');
    expect(textOf(result)).toContain('"network": 1');
    expect(textOf(result)).toContain('"console": 1');
    expect(textOf(result)).toContain('quick-test-1.png');
  });

  it('exposes all saved Quick Test scenario tools only when their service is injected', async () => {
    const client = await connect({ ide: makeService(), quickTestScenarios: makeQuickTestScenarios() });
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'ide_quick_test_list',
        'ide_quick_test_describe',
        'ide_quick_test_run',
        'ide_quick_test_status',
        'ide_quick_test_cancel',
        'ide_quick_test_compare',
      ])
    );
  });

  it('starts a saved scenario with bounded defaults and ephemeral input overrides', async () => {
    const quickTestScenarios = makeQuickTestScenarios();
    const client = await connect({ ide: makeService(), quickTestScenarios });
    const result = await client.callTool({
      name: 'ide_quick_test_run',
      arguments: {
        rootPath: '/repo',
        scenarioId: 'scenario-1',
        inputOverrides: { 'step-password': 'secret-from-memory' },
      },
    });

    expect(quickTestScenarios.run).toHaveBeenCalledWith({
      rootPath: '/repo',
      scenarioId: 'scenario-1',
      tabId: undefined,
      mode: { kind: 'full' },
      timeoutMs: 120_000,
      inputOverrides: { 'step-password': 'secret-from-memory' },
    });
    expect(JSON.parse(textOf(result))).toMatchObject({ ok: true, data: { status: 'queued' } });
    expect(textOf(result)).not.toContain('secret-from-memory');
  });

  it('routes saved-scenario status, cancellation and comparison by run id', async () => {
    const quickTestScenarios = makeQuickTestScenarios();
    const client = await connect({ ide: makeService(), quickTestScenarios });

    await client.callTool({ name: 'ide_quick_test_status', arguments: { rootPath: '/repo', runId: 'run-1' } });
    await client.callTool({ name: 'ide_quick_test_cancel', arguments: { rootPath: '/repo', runId: 'run-1' } });
    await client.callTool({
      name: 'ide_quick_test_compare',
      arguments: { rootPath: '/repo', baselineRunId: 'run-bad', currentRunId: 'run-fixed' },
    });

    expect(quickTestScenarios.status).toHaveBeenCalledWith({ rootPath: '/repo', runId: 'run-1' });
    expect(quickTestScenarios.cancel).toHaveBeenCalledWith({ rootPath: '/repo', runId: 'run-1' });
    expect(quickTestScenarios.compare).toHaveBeenCalledWith({
      rootPath: '/repo',
      baselineRunId: 'run-bad',
      currentRunId: 'run-fixed',
    });
  });

  it('returns a structured MCP error when saved-scenario execution fails', async () => {
    const quickTestScenarios = makeQuickTestScenarios();
    quickTestScenarios.describe = vi.fn(async () => {
      throw new Error('Scenario was not found.');
    });
    const client = await connect({ ide: makeService(), quickTestScenarios });
    const result = await client.callTool({
      name: 'ide_quick_test_describe',
      arguments: { rootPath: '/repo', scenarioId: 'missing' },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      ok: false,
      error: { code: 'quick_test_error', message: 'Scenario was not found.' },
    });
  });

  it('does not execute a saved scenario when the external tool guard denies it', async () => {
    const quickTestScenarios = makeQuickTestScenarios();
    const toolGuard = vi.fn(() => ({ allow: false as const, reason: 'Quick Test execution is not allowed.' }));
    const client = await connect({ ide: makeService(), quickTestScenarios, toolGuard });
    const result = await client.callTool({
      name: 'ide_quick_test_run',
      arguments: { rootPath: '/repo', scenarioId: 'scenario-1', sessionId: 'session-1' },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(toolGuard).toHaveBeenCalledWith('ide_quick_test_run', expect.objectContaining({ sessionId: 'session-1' }));
    expect(quickTestScenarios.run).not.toHaveBeenCalled();
  });

  it('rejects oversized saved-scenario input overrides before invoking the runner', async () => {
    const quickTestScenarios = makeQuickTestScenarios();
    const client = await connect({ ide: makeService(), quickTestScenarios });
    const inputOverrides = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`step-${index}`, 'value']));
    const result = await client.callTool({
      name: 'ide_quick_test_run',
      arguments: { rootPath: '/repo', scenarioId: 'scenario-1', inputOverrides },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(quickTestScenarios.run).not.toHaveBeenCalled();
  });

  it('ide_list_dir renders dirs and files', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const result = await client.callTool({ name: 'ide_list_dir', arguments: { dir: '/repo' } });
    expect(deps.ide.listDir).toHaveBeenCalledWith('/repo', {
      glob: undefined,
      maxResults: undefined,
      recursive: undefined,
    });
    expect(textOf(result)).toContain('[dir] src');
    expect(textOf(result)).toContain('readme.md');
  });

  it('ide_read_file forwards the path + optional maxBytes', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_read_file',
      arguments: { filePath: '/repo/a.ts', maxBytes: 100 },
    });
    expect(deps.ide.readFile).toHaveBeenCalledWith('/repo/a.ts', expect.objectContaining({ maxBytes: 100 }));
    expect(textOf(result)).toContain('file contents');
  });

  it('ide_read_file redacts detected secrets and returns metadata without plaintext', async () => {
    const plaintext = 'unregistered-file-secret';
    const deps = makeDeps({
      readFile: vi.fn(async () => ({
        text: `1: PAYMENTS_API_KEY=${plaintext}\n2: SAFE_MODE=true`,
        lineStart: 1,
        lineEnd: 2,
        totalLines: 2,
        returnedLines: 2,
        truncated: false,
        binary: false,
        sizeBytes: 64,
      })),
    });
    const client = await connect(deps);

    const result = await client.callTool({ name: 'ide_read_file', arguments: { filePath: '/repo/.env' } });
    const text = textOf(result);

    expect(text).toContain('PAYMENTS_API_KEY=[REDACTED]');
    expect(text).toContain('"type": "api-key"');
    expect(text).not.toContain(plaintext);
  });

  it('ide_analyze_image runs only when the agent explicitly calls the VisualArtifact tool', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_analyze_image',
      arguments: { filePath: '/repo/screen.png', mimeType: 'image/png' },
    });
    expect(deps.ide.analyzeImage).toHaveBeenCalledWith('/repo/screen.png', 'image/png');
    const text = textOf(result);
    expect(text).toContain('semanticText');
    expect(text).toContain('Image: 10x20');
    expect(text).toContain('mockUi');
  });

  it('ide_command runs a command and renders status + output', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'echo hi', cwd: '/repo/sub' },
    });
    expect(deps.ide.runCommand).toHaveBeenCalledWith('/repo', 'echo hi', { cwd: '/repo/sub', timeoutMs: undefined });
    const text = textOf(result);
    expect(text).toContain('exit 0');
    expect(text).toContain('ok');
  });

  it('ide_test_script uses encoded Python and enforces reproduce/post-fix gates', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        code: 10,
        stdout: '',
        stderr: '[TOMNY_REPRODUCED] expected 404 mapping',
        timedOut: false,
        durationMs: 7,
      })
      .mockResolvedValueOnce({ code: 0, stdout: 'verified', stderr: '', timedOut: false, durationMs: 6 });
    const client = await connect(makeDeps({ runCommand }));
    const script = "assert 404 >= 500, 'expected 404 mapping'";

    const reproduced = await client.callTool({
      name: 'ide_test_script',
      arguments: { rootPath: '/repo', script, phase: 'reproduce' },
    });
    const fixed = await client.callTool({
      name: 'ide_test_script',
      arguments: { rootPath: '/repo', script, phase: 'post-fix' },
    });

    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand.mock.calls[0]?.[1]).toMatch(/^python -c /);
    expect(runCommand.mock.calls[0]?.[1]).not.toContain(script);
    expect(textOf(reproduced)).toContain('"gateSatisfied": true');
    expect(textOf(reproduced)).toContain('"classification": "failure-reproduced"');
    expect(textOf(reproduced)).toContain('"mode": "direct"');
    expect(textOf(fixed)).toContain('"gateSatisfied": true');
    expect(textOf(fixed)).toContain('"classification": "passed"');
    expect(textOf(fixed)).toContain('"mode": "complete"');
  });

  it('ide_test_script tries bounded online experience before backtracking', async () => {
    const failed = {
      code: 10,
      stdout: '',
      stderr: '[TOMNY_REPRODUCED] same failure fingerprint',
      timedOut: false,
      durationMs: 5,
    };
    const runCommand = vi.fn().mockResolvedValue(failed);
    const client = await connect(makeDeps({ runCommand }));
    const args = { rootPath: '/repo', script: "assert False, 'same failure fingerprint'" };

    await client.callTool({ name: 'ide_test_script', arguments: { ...args, phase: 'reproduce' } });
    const firstFailure = await client.callTool({
      name: 'ide_test_script',
      arguments: { ...args, phase: 'post-fix' },
    });
    const secondFailure = await client.callTool({
      name: 'ide_test_script',
      arguments: { ...args, phase: 'post-fix' },
    });
    const firstOnlineFailure = await client.callTool({
      name: 'ide_test_script',
      arguments: { ...args, phase: 'post-fix' },
    });
    const secondOnlineFailure = await client.callTool({
      name: 'ide_test_script',
      arguments: { ...args, phase: 'post-fix' },
    });

    expect(textOf(firstFailure)).toContain('"mode": "reassess"');
    expect(textOf(secondFailure)).toContain('"mode": "online-search"');
    expect(textOf(secondFailure)).toContain('Online experience required');
    expect(textOf(firstOnlineFailure)).toContain('"mode": "online-search"');
    expect(textOf(secondOnlineFailure)).toContain('"mode": "backtrack"');
    expect(textOf(secondOnlineFailure)).toContain('Keep at most three independent hypotheses');
  });

  it('ide_test_script never treats a broken verification script as a reproduced bug', async () => {
    const client = await connect(
      makeDeps({
        runCommand: vi.fn(async () => ({
          code: 20,
          stdout: '',
          stderr: '[TOMNY_SCRIPT_ERROR]\nNameError',
          timedOut: false,
          durationMs: 4,
        })),
      })
    );

    const result = await client.callTool({
      name: 'ide_test_script',
      arguments: { rootPath: '/repo', script: 'missing_name()', phase: 'reproduce' },
    });

    expect(textOf(result)).toContain('"gateSatisfied": false');
    expect(textOf(result)).toContain('"classification": "script-error"');
  });

  it('ide_command redacts secrets discovered outside declared Secret Context aliases', async () => {
    const plaintext = 'postgres://admin:password@example.test/app';
    const deps = makeDeps({
      runCommand: vi.fn(async () => ({
        code: 0,
        stdout: `DATABASE_URL=${plaintext}`,
        stderr: '',
        timedOut: false,
        durationMs: 1,
      })),
    });
    const client = await connect(deps);

    const result = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'printenv DATABASE_URL' },
    });
    const text = textOf(result);

    expect(text).toContain('DATABASE_URL=[REDACTED]');
    expect(text).toContain('"type": "connection-string"');
    expect(text).not.toContain(plaintext);
  });

  it('ide_command surfaces a timeout as a clear status', async () => {
    const deps = makeDeps({
      runCommand: vi.fn(async () => ({ code: -1, stdout: '', stderr: '', timedOut: true, durationMs: 60000 })),
    });
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'sleep 999' },
    });
    expect(textOf(result)).toContain('TIMED OUT');
  });

  it('injects a Secret Context alias only into the child environment and redacts its output', async () => {
    const deps = makeDeps({
      runCommand: vi.fn(async () => ({
        code: 0,
        stdout: 'token=top-secret-value',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      })),
    });
    const repoSecrets = {
      list: vi.fn(async () => []),
      listCombos: vi.fn(async () => []),
      declare: vi.fn(async () => ({
        alias: 'PAYMENTS_API_KEY',
        description: 'Payments',
        status: 'needs_value' as const,
        updatedAt: 1,
      })),
      resolveEnvironment: vi.fn(async () => ({ PAYMENTS_API_KEY: 'top-secret-value' })),
      redact: vi.fn((text: string, values: Record<string, string>) =>
        text.replace(values.PAYMENTS_API_KEY, '[REDACTED]')
      ),
    };
    deps.repoSecrets = repoSecrets;
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'node smoke.js', secretAliases: ['PAYMENTS_API_KEY'] },
    });
    expect(repoSecrets.resolveEnvironment).toHaveBeenCalledWith('/repo', ['PAYMENTS_API_KEY'], []);
    expect(deps.ide.runCommand).toHaveBeenCalledWith('/repo', 'node smoke.js', {
      cwd: undefined,
      timeoutMs: undefined,
      env: { PAYMENTS_API_KEY: 'top-secret-value' },
    });
    expect(textOf(result)).toContain('[REDACTED]');
    expect(textOf(result)).not.toContain('top-secret-value');
  });

  it('injects every key in a Secret Context Combo through one combo id', async () => {
    const deps = makeDeps({
      runCommand: vi.fn(async () => ({
        code: 0,
        stdout: 'user=octocat token=combo-token',
        stderr: '',
        timedOut: false,
        durationMs: 1,
      })),
    });
    const repoSecrets = {
      list: vi.fn(async () => []),
      listCombos: vi.fn(async () => []),
      declare: vi.fn(),
      resolveEnvironment: vi.fn(async () => ({
        GITHUB_USERNAME: 'octocat',
        GITHUB_TOKEN: 'combo-token',
      })),
      redact: vi.fn((text: string, values: Record<string, string>) =>
        Object.values(values).reduce((result, value) => result.replace(value, '[REDACTED]'), text)
      ),
    };
    deps.repoSecrets = repoSecrets;
    const client = await connect(deps);

    const result = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'node release.js', secretComboIds: ['github-account'] },
    });

    expect(repoSecrets.resolveEnvironment).toHaveBeenCalledWith('/repo', [], ['github-account']);
    expect(deps.ide.runCommand).toHaveBeenCalledWith('/repo', 'node release.js', {
      cwd: undefined,
      timeoutMs: undefined,
      env: { GITHUB_USERNAME: 'octocat', GITHUB_TOKEN: 'combo-token' },
    });
    expect(textOf(result)).not.toContain('combo-token');
  });

  it('guides the agent to return a local-render marker without exposing a Secret Context value', async () => {
    const repoSecrets = {
      list: vi.fn(async () => [{ alias: 'TEST', description: 'Test fixture', status: 'set' as const, updatedAt: 1 }]),
      listCombos: vi.fn(async () => [
        {
          comboId: 'github-account',
          comboLabel: 'GitHub account',
          description: 'Release credentials',
          keys: [{ key: 'TOKEN', alias: 'GITHUB_TOKEN', status: 'set' as const, updatedAt: 1 }],
          updatedAt: 1,
        },
      ]),
      declare: vi.fn(async () => ({
        alias: 'TEST',
        description: 'Test fixture',
        status: 'needs_value' as const,
        updatedAt: 1,
      })),
      resolveEnvironment: vi.fn(async () => ({ TEST: 'actual-secret-value' })),
      redact: vi.fn((text: string) => text),
    };
    const client = await connect({ ide: makeService(), repoSecrets });

    const result = await client.callTool({
      name: 'ide_secret_context_list',
      arguments: { repository: '/repo' },
    });

    const output = textOf(result);
    expect(output).toContain('TEST');
    expect(output).toContain('{{secret:TEST}}');
    expect(output).toContain('github-account');
    expect(output).not.toContain('actual-secret-value');
  });

  it('exposes db_* tools when a Database accessor is injected and describes a table fully', async () => {
    const db = {
      listConnections: vi.fn(async () => [{ config: { id: 'c1', name: 'Dev', kind: 'postgres', readOnly: true } }]),
      connect: vi.fn(async () => undefined),
      listTables: vi.fn(async () => [{ schema: 'public', name: 'users', type: 'table' }]),
      getColumns: vi.fn(async () => []),
      getTableDetail: vi.fn(async () => ({
        columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
        indexes: [{ name: 'users_pkey', columns: ['id'], unique: true, primary: true }],
        foreignKeys: [{ name: 'fk_org', columns: ['org_id'], referencedTable: 'orgs', referencedColumns: ['id'] }],
      })),
      query: vi.fn(async () => ({ columns: ['id'], rows: [[1]], durationMs: 2, truncated: false })),
      profileTable: vi.fn(async () => ({
        schema: 'public',
        table: 'users',
        rowCount: 100,
        sampled: false,
        columns: [
          {
            column: 'id',
            type: 'integer',
            total: 100,
            nulls: 0,
            distinct: 100,
            min: 1,
            max: 100,
            avg: 50.5,
            sampled: false,
            topValues: [],
          },
          {
            column: 'status',
            type: 'text',
            total: 100,
            nulls: 4,
            distinct: 3,
            sampled: false,
            topValues: [{ value: 'active', count: 80 }],
          },
        ],
      })),
    };
    const client = await connect({ ide: makeService(), db });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'db_list_connections',
        'db_list_tables',
        'db_describe_table',
        'db_query',
        'db_profile_table',
      ])
    );

    const described = await client.callTool({ name: 'db_describe_table', arguments: { id: 'c1', table: 'users' } });
    expect(db.connect).toHaveBeenCalledWith('c1');
    const text = textOf(described);
    expect(text).toContain('## Columns');
    expect(text).toContain('id integer NOT NULL PK');
    expect(text).toContain('## Indexes');
    expect(text).toContain('users_pkey (id) UNIQUE PRIMARY');
    expect(text).toContain('## Foreign keys');
    expect(text).toContain('org_id -> orgs(id)');

    const queried = await client.callTool({ name: 'db_query', arguments: { id: 'c1', sql: 'SELECT 1' } });
    expect(textOf(queried)).toContain('"rowCount": 1');

    const profiled = await client.callTool({ name: 'db_profile_table', arguments: { id: 'c1', table: 'users' } });
    expect(db.profileTable).toHaveBeenCalledWith('c1', 'users', undefined);
    const profileText = textOf(profiled);
    expect(profileText).toContain('"rowCount": 100');
    expect(profileText).toContain('"fillRate": 1'); // id is fully populated
    expect(profileText).toContain('"topValues"'); // status is low-cardinality
  });

  it('exposes team_* tools when a Team Edit coordinator is injected and guards writes', async () => {
    const claim = vi.fn(() => ({
      ok: true as const,
      lease: { relPath: 'src/a.ts', agentId: 'agent-a', expiresAt: 9_999, intent: 'refactor' },
      renewed: false,
    }));
    const write = vi.fn(async () => ({ ok: true as const, bytes: 12 }));
    const release = vi.fn(() => true);
    const snapshot = vi.fn(() => ({
      participants: [{ agentId: 'agent-a', label: 'Agent A', isUser: false }],
      leases: [{ relPath: 'src/a.ts', agentId: 'agent-a', expiresAt: 9_999 }],
    }));
    const editReplace = vi.fn(async () => ({ ok: true as const, matches: 1 }));
    const teamEdit = { claim, write, release, snapshot, editReplace };
    const client = await connect({ ide: makeService(), teamEdit });
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'team_claim_file',
        'team_write_file',
        'team_edit_file',
        'team_release_file',
        'team_status',
        'tomny_team_claim',
        'tomny_team_write',
        'tomny_team_edit',
        'tomny_team_release',
        'tomny_team_status',
      ])
    );
    const tomnyEditSchema = tools.find((tool) => tool.name === 'tomny_team_edit')?.inputSchema as
      | { required?: string[] }
      | undefined;
    expect(tomnyEditSchema?.required).toEqual(
      expect.arrayContaining(['rootPath', 'agentId', 'relPath', 'oldText', 'newText'])
    );

    const tomnyStatus = await client.callTool({ name: 'tomny_team_status', arguments: { rootPath: '/repo' } });
    expect(textOf(tomnyStatus)).toContain('Agent A');

    const tomnyEdit = await client.callTool({
      name: 'tomny_team_edit',
      arguments: { rootPath: '/repo', agentId: 'agent-a', relPath: 'src/a.ts', oldText: 'before', newText: '' },
    });
    expect(editReplace).toHaveBeenCalledWith('/repo', 'agent-a', 'src/a.ts', 'before', '');
    expect(textOf(tomnyEdit)).toContain('Edited src/a.ts');

    const claimed = await client.callTool({
      name: 'team_claim_file',
      arguments: { rootPath: '/repo', agentId: 'agent-a', relPath: 'src/a.ts', intent: 'refactor' },
    });
    expect(claim).toHaveBeenCalledWith('/repo', 'agent-a', 'src/a.ts', 'refactor');
    expect(textOf(claimed)).toContain('Claimed src/a.ts');

    const wrote = await client.callTool({
      name: 'team_write_file',
      arguments: { rootPath: '/repo', agentId: 'agent-a', relPath: 'src/a.ts', content: 'hello world!' },
    });
    expect(write).toHaveBeenCalledWith('/repo', 'agent-a', 'src/a.ts', 'hello world!');
    expect(textOf(wrote)).toContain('12 bytes');

    const status = await client.callTool({ name: 'team_status', arguments: { rootPath: '/repo' } });
    expect(textOf(status)).toContain('Agent A');
    expect(textOf(status)).toContain('src/a.ts — held by agent-a');

    const edited = await client.callTool({
      name: 'team_edit_file',
      arguments: { rootPath: '/repo', agentId: 'agent-a', relPath: 'src/a.ts', oldText: 'foo', newText: 'bar' },
    });
    expect(editReplace).toHaveBeenCalledWith('/repo', 'agent-a', 'src/a.ts', 'foo', 'bar');
    expect(textOf(edited)).toContain('Edited src/a.ts');
  });

  it('team_write_file reports a conflict instead of overwriting', async () => {
    const teamEdit = {
      claim: vi.fn(() => ({ ok: true as const, lease: { relPath: 'x', agentId: 'a', expiresAt: 1 }, renewed: false })),
      write: vi.fn(async () => ({
        ok: false as const,
        reason: 'held' as const,
        lease: { relPath: 'src/a.ts', agentId: 'agent-b', expiresAt: 9_999 },
      })),
      editReplace: vi.fn(async () => ({ ok: true as const, matches: 1 })),
      release: vi.fn(() => true),
      snapshot: vi.fn(() => ({ participants: [], leases: [] })),
    };
    const client = await connect({ ide: makeService(), teamEdit });
    const result = await client.callTool({
      name: 'team_write_file',
      arguments: { rootPath: '/repo', agentId: 'agent-a', relPath: 'src/a.ts', content: 'x' },
    });
    expect(textOf(result)).toContain('CONFLICT');
    expect(textOf(result)).toContain('agent-b');
  });

  it('team_edit_file reports a stale anchor so the agent re-reads instead of clobbering', async () => {
    const teamEdit = {
      claim: vi.fn(() => ({ ok: true as const, lease: { relPath: 'x', agentId: 'a', expiresAt: 1 }, renewed: false })),
      write: vi.fn(async () => ({ ok: true as const, bytes: 1 })),
      editReplace: vi.fn(async () => ({
        ok: false as const,
        reason: 'stale' as const,
        detail: 'Text not found in src/a.ts',
      })),
      release: vi.fn(() => true),
      snapshot: vi.fn(() => ({ participants: [], leases: [] })),
    };
    const client = await connect({ ide: makeService(), teamEdit });
    const result = await client.callTool({
      name: 'team_edit_file',
      arguments: { rootPath: '/repo', agentId: 'agent-a', relPath: 'src/a.ts', oldText: 'gone', newText: 'x' },
    });
    expect(textOf(result)).toContain('STALE');
    expect(textOf(result)).toContain('Re-read');
  });

  it('ide_search forwards options and renders file:line hits', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_search',
      arguments: { rootPath: '/repo', query: 'x', regex: true, maxResults: 50 },
    });
    expect(deps.ide.search).toHaveBeenCalledWith('/repo', 'x', {
      regex: true,
      wholeWord: undefined,
      caseSensitive: undefined,
      maxResults: 50,
    });
    expect(textOf(result)).toContain('src/a.ts:10: const x = 1');
  });

  it('ide_grep aliases the search engine and renders file:line hits', async () => {
    const deps = makeDeps();
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_grep',
      arguments: { rootPath: '/repo', pattern: 'x', regex: true, glob: '*.ts', maxResults: 50 },
    });
    expect(deps.ide.search).toHaveBeenCalledWith('/repo', 'x', {
      glob: '*.ts',
      regex: true,
      wholeWord: undefined,
      caseSensitive: undefined,
      maxResults: 50,
    });
    expect(textOf(result)).toContain('src/a.ts:10: const x = 1');
  });

  it('ide_glob lists only files matching the pattern (recursive by default)', async () => {
    const deps = makeDeps({
      listDir: vi.fn(async () => [
        { name: 'src', fullPath: '/repo/src', isDir: true, relativePath: 'src' },
        { name: 'a.ts', fullPath: '/repo/src/a.ts', isDir: false, relativePath: 'src/a.ts' },
        { name: 'b.ts', fullPath: '/repo/src/b.ts', isDir: false, relativePath: 'src/b.ts' },
      ]),
    });
    const client = await connect(deps);
    const result = await client.callTool({
      name: 'ide_glob',
      arguments: { dir: '/repo', pattern: '**/*.ts' },
    });
    expect(deps.ide.listDir).toHaveBeenCalledWith('/repo', { glob: '**/*.ts', recursive: true, maxResults: undefined });
    const text = textOf(result);
    expect(text).toContain('src/a.ts');
    expect(text).toContain('src/b.ts');
    expect(text).not.toContain('[dir]');
  });

  it('ide_find_definition / ide_find_references render symbol hits', async () => {
    const client = await connect(makeDeps());
    const def = await client.callTool({ name: 'ide_find_definition', arguments: { rootPath: '/repo', name: 'x' } });
    expect(textOf(def)).toContain('src/a.ts:1:7');
    const refs = await client.callTool({ name: 'ide_find_references', arguments: { rootPath: '/repo', name: 'x' } });
    expect(textOf(refs)).toContain('src/b.ts:5:3');
  });

  it('ide_scan_repo renders a compact summary', async () => {
    const client = await connect(makeDeps());
    const result = await client.callTool({ name: 'ide_scan_repo', arguments: { rootPath: '/repo' } });
    expect(textOf(result)).toContain('Files: 3');
    expect(textOf(result)).toContain('Import edges: 2');
    expect(textOf(result)).toContain('src: 3 file(s)');
  });

  it('surfaces a service error as an MCP error result', async () => {
    const deps = makeDeps({
      readFile: vi.fn(async () => {
        throw new Error('ENOENT: no such file');
      }),
    });
    const client = await connect(deps);
    const result = await client.callTool({ name: 'ide_read_file', arguments: { filePath: '/nope' } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('ENOENT');
  });
});

describe('ideServer — exp_* (ExpBase agent plane)', () => {
  const makeExperience = () => ({
    search: vi.fn(async () => [
      {
        entryId: 'exp-1',
        score: 0.91,
        kind: 'successful_fix' as const,
        symptom: 'TypeScript build fails',
        lesson: 'Regenerate the generated types before typecheck.',
        whyRelevant: ['same command'],
        caution: [],
        suggestedChecks: ['bunx tsc --noEmit'],
      },
    ]),
    record: vi.fn(async () => ({ action: 'created' as const, entry: { id: 'exp-2' } })),
    recordFeedback: vi.fn(async () => true),
    verifyOutcome: vi.fn(async () => ({
      decision: { shouldRetrieve: false, failureCount: 1, reason: 'below-threshold-2' },
      suggestions: [],
    })),
  });

  it('exposes ExpBase tools only when the existing service is injected', async () => {
    const without = await connect(makeDeps());
    expect((await without.listTools()).tools.map((tool) => tool.name)).not.toContain('exp_search');

    const experience = makeExperience();
    const withExp = await connect({ ide: makeService(), experience });
    expect((await withExp.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['exp_search', 'exp_record', 'exp_feedback', 'exp_verify'])
    );
  });

  it('searches the existing project ExpBase and returns compact lessons', async () => {
    const experience = makeExperience();
    const client = await connect({ ide: makeService(), experience });
    const result = await client.callTool({
      name: 'exp_search',
      arguments: { projectRoot: '/repo', symptom: 'tsc fails', files: ['src/auth.ts'], limit: 3 },
    });

    expect(experience.search).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ symptom: 'tsc fails', files: ['src/auth.ts'] }),
      { topK: 3 }
    );
    expect(textOf(result)).toContain('Regenerate the generated types');
  });

  it('reports verification outcomes through the conditional ExpBase trigger', async () => {
    const experience = makeExperience();
    const client = await connect({ ide: makeService(), experience });
    const result = await client.callTool({
      name: 'exp_verify',
      arguments: { projectRoot: '/repo', outcome: 'failed', command: 'bunx tsc --noEmit', errorText: 'TS2322' },
    });

    expect(experience.verifyOutcome).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ command: 'bunx tsc --noEmit', errorText: 'TS2322' }),
      'failed'
    );
    expect(textOf(result)).toContain('below-threshold-2');
  });
});

describe('ideServer — automatic ExpBase command observation', () => {
  it('surfaces an existing lesson when a repeated command failure triggers retrieval', async () => {
    const verifyOutcome = vi
      .fn()
      .mockResolvedValueOnce({
        decision: { shouldRetrieve: false, failureCount: 1, reason: 'below-threshold-2' },
        suggestions: [],
      })
      .mockResolvedValueOnce({
        decision: { shouldRetrieve: true, failureCount: 2, reason: 'reached-threshold-2' },
        suggestions: [
          {
            entryId: 'exp-1',
            score: 0.91,
            kind: 'successful_fix',
            symptom: 'TypeScript build fails',
            lesson: 'Regenerate generated types before retrying.',
            whyRelevant: [],
            caution: [],
            suggestedChecks: ['bun run i18n:types'],
          },
        ],
      });
    const experience = {
      search: vi.fn(async () => []),
      record: vi.fn(async () => ({ action: 'created' as const, entryId: 'exp-2' })),
      recordFeedback: vi.fn(async () => true),
      verifyOutcome,
    };
    const runCommand = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'TS2322',
      timedOut: false,
      durationMs: 5,
    }));
    const client = await connect({ ide: makeService({ runCommand }), experience });

    await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'bunx tsc --noEmit' },
    });
    const repeated = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'bunx tsc --noEmit' },
    });

    expect(verifyOutcome).toHaveBeenCalledTimes(2);
    expect(textOf(repeated)).toContain('Regenerate generated types before retrying.');
  });
});

describe('ideServer — ExpBase observation resilience', () => {
  it('keeps command output when ExpBase observation fails', async () => {
    const experience = {
      search: vi.fn(async () => []),
      record: vi.fn(async () => ({ action: 'created' as const, entryId: 'exp-2' })),
      recordFeedback: vi.fn(async () => true),
      verifyOutcome: vi.fn(async () => {
        throw new Error('ExpBase unavailable');
      }),
    };
    const runCommand = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'TS2322',
      timedOut: false,
      durationMs: 5,
    }));
    const client = await connect({ ide: makeService({ runCommand }), experience });
    const result = await client.callTool({
      name: 'ide_command',
      arguments: { rootPath: '/repo', command: 'bunx tsc --noEmit' },
    });

    expect(textOf(result)).toContain('TS2322');
    expect((result as { isError?: boolean }).isError).not.toBe(true);
  });
});

describe('ideServer — ide_memory_* (session super-memory)', () => {
  it('exposes the memory tools only when a memory store is injected', async () => {
    const without = await connect(makeDeps());
    expect((await without.listTools()).tools.map((t) => t.name)).not.toContain('ide_memory_remember');

    const memory = createSessionMemoryStore({ summarizer: async () => 'summary' });
    const withMem = await connect({ ide: makeService(), memory });
    const names = (await withMem.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'ide_memory_remember',
        'ide_memory_recall',
        'ide_memory_forget',
        'ide_memory_set_secret',
        'ide_memory_status',
      ])
    );
  });

  it('remembers then recalls a note for the same sessionId', async () => {
    const memory = createSessionMemoryStore({ summarizer: async () => 'summary' });
    const client = await connect({ ide: makeService(), memory });

    const saved = await client.callTool({
      name: 'ide_memory_remember',
      arguments: { sessionId: 's1', text: 'Auth lives in src/auth.ts', kind: 'fact' },
    });
    expect(textOf(saved)).toContain('Saved note');

    const recall = await client.callTool({ name: 'ide_memory_recall', arguments: { sessionId: 's1' } });
    expect(textOf(recall)).toContain('Auth lives in src/auth.ts');
  });

  it('stores a session secret without leaking its value in status', async () => {
    const memory = createSessionMemoryStore({ summarizer: async () => 'summary' });
    const client = await connect({ ide: makeService(), memory });

    await client.callTool({
      name: 'ide_memory_set_secret',
      arguments: { sessionId: 's1', key: 'OPENAI_API_KEY', value: 'sk-secret-123' },
    });
    const status = await client.callTool({ name: 'ide_memory_status', arguments: { sessionId: 's1' } });
    const text = textOf(status);
    expect(text).toContain('OPENAI_API_KEY');
    expect(text).not.toContain('sk-secret-123');
  });

  it('forgets a note by id through the MCP tool', async () => {
    const memory = createSessionMemoryStore({ summarizer: async () => 'summary' });
    const client = await connect({ ide: makeService(), memory });
    const saved = await client.callTool({ name: 'ide_memory_remember', arguments: { sessionId: 's1', text: 'temp' } });
    const id = textOf(saved).match(/Saved note (\w+)/)?.[1];
    expect(id).toBeTruthy();
    const forgotten = await client.callTool({ name: 'ide_memory_forget', arguments: { sessionId: 's1', id } });
    expect(textOf(forgotten)).toContain(`Forgot note ${id}`);
    const recall = await client.callTool({ name: 'ide_memory_recall', arguments: { sessionId: 's1' } });
    expect(textOf(recall)).toContain('Session memory is empty');
  });

  it('reports a merged duplicate write through the MCP tool', async () => {
    const memory = createSessionMemoryStore({ summarizer: async () => 'summary' });
    const client = await connect({ ide: makeService(), memory });
    await client.callTool({ name: 'ide_memory_remember', arguments: { sessionId: 's1', text: 'cache uses redis' } });
    const dup = await client.callTool({
      name: 'ide_memory_remember',
      arguments: { sessionId: 's1', text: 'cache uses redis with a 60s ttl' },
    });
    expect(textOf(dup)).toContain('Merged into an existing');
  });
});
