import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreWorkspaceServer,
  registerCoreWorkspaceLibrarySearchPort,
  type CoreLibrarySearchPort,
} from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import { createCoreContextComposer, registerCoreRulesContextProvider } from '@process/agentRuntime/contextComposer';
import type { ContextStore } from '@process/agentRuntime/contextStore';
import type { AgentContext } from '@process/agentRuntime/contextTypes';
import { registerPackageContextPorts } from '@process/integrations/packageContext/agentPorts';
import { createKnowledgeIndex, type KnowledgeIndexPort } from '@process/integrations/packageContext/knowledgeIndex';
import {
  createCoreLibrarySearchPort,
  MAX_RESULT_CHARS,
} from '@process/integrations/packageContext/knowledgeSearchPort';

const WORKSPACE = path.resolve(os.tmpdir(), 'tomny-ws-ports');
const REQUEST = '## Current user request';

const agent: AgentContext = {
  id: 'tomny',
  name: 'Tomny',
  role: 'assistant',
  identity: 'A surface-aware agent',
  traits: [],
  capabilities: [],
  instructions: ['Respect user intent.'],
  updatedAt: 0,
};

const store = (withAgent = true): ContextStore => ({
  getAgent: async () => (withAgent ? structuredClone(agent) : undefined),
  getPersonal: async () => undefined,
  upsertAgent: async () => undefined,
  upsertPersonal: async () => undefined,
  learnPersonalFact: async () => false,
});

const input = (workspace?: string) => ({
  agentId: 'tomny',
  personalId: 'default',
  surface: 'chat',
  prompt: 'Fix the bug.',
  ...(workspace === undefined ? {} : { workspace }),
});

afterEach(() => {
  registerCoreRulesContextProvider(undefined);
  registerCoreWorkspaceLibrarySearchPort(undefined);
});

describe('context composer: package rules block', () => {
  it('builds the prompt exactly as before when no provider is registered or the workspace has no rules', async () => {
    const composer = createCoreContextComposer(store());
    const baseline = await composer.composePrompt(input(WORKSPACE));
    expect(baseline).toContain(REQUEST);

    const provider = vi.fn(async (): Promise<string | undefined> => undefined);
    registerCoreRulesContextProvider(provider);
    expect(await composer.composePrompt(input(WORKSPACE))).toBe(baseline);
    expect(provider).toHaveBeenCalledWith({ workspace: WORKSPACE });

    // Nothing to ask about without a workspace.
    provider.mockClear();
    expect(await composer.composePrompt(input())).toBe(baseline);
    expect(provider).not.toHaveBeenCalled();
  });

  it('adds the rules of the workspace after the profile and before the request, and only for that workspace', async () => {
    const composer = createCoreContextComposer(store());
    registerCoreRulesContextProvider(async ({ workspace }) =>
      workspace === WORKSPACE ? '### House style\nAlways write tests first.' : undefined
    );

    const withRules = await composer.composePrompt(input(WORKSPACE));
    const agentAt = withRules.indexOf('## Agent');
    const rulesAt = withRules.indexOf('## Package rules');
    const requestAt = withRules.indexOf(REQUEST);
    expect(agentAt).toBeGreaterThanOrEqual(0);
    expect(rulesAt).toBeGreaterThan(agentAt);
    expect(requestAt).toBeGreaterThan(rulesAt);
    expect(withRules).toContain('Always write tests first.');
    expect(withRules).toContain('grant no permission');
    expect(withRules.endsWith('Fix the bug.')).toBe(true);

    expect(await composer.composePrompt(input(path.resolve(os.tmpdir(), 'another')))).not.toContain('Package rules');
  });

  it('still adds the rules when there is no agent or profile text, and keeps a 16 KB block whole', async () => {
    const composer = createCoreContextComposer(store(false));
    const rules = `${'r'.repeat(16 * 1024)}`;
    registerCoreRulesContextProvider(async () => rules);
    const prompt = await composer.composePrompt(input(WORKSPACE));
    expect(prompt).toContain(rules);
    expect(prompt.endsWith('Fix the bug.')).toBe(true);
  });

  it('treats a failing provider or blank text as no rules and never fails the turn', async () => {
    const composer = createCoreContextComposer(store());
    const baseline = await composer.composePrompt(input(WORKSPACE));
    registerCoreRulesContextProvider(async () => {
      throw new Error('registry unavailable');
    });
    expect(await composer.composePrompt(input(WORKSPACE))).toBe(baseline);
    registerCoreRulesContextProvider(async () => '  \n ');
    expect(await composer.composePrompt(input(WORKSPACE))).toBe(baseline);
  });
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const connect = async (deps: Partial<Parameters<typeof createCoreWorkspaceServer>[0]> = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-libtool-'));
  roots.push(root);
  const server = createCoreWorkspaceServer({ workspace: root, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'library-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};
const textOf = (value: unknown): string =>
  ((value as { content?: Array<{ text?: string }> }).content ?? []).map((item) => item.text ?? '').join('\n');
const isError = (value: unknown): boolean => (value as { isError?: boolean }).isError === true;

const indexWith = async (files: Record<string, string>): Promise<KnowledgeIndexPort> => {
  const index = createKnowledgeIndex({ readText: async (_owner, documentPath) => files[documentPath] });
  await index.replaceCollection(
    { packageId: 'com.community.awesome', collectionId: 'docs' },
    {
      title: 'Guides',
      documents: Object.keys(files).map((documentPath) => ({ path: documentPath, title: documentPath })),
    }
  );
  return index;
};

describe('tomny_library_search', () => {
  it('is offered by the read-only server too, and takes a query and a count but no path', async () => {
    const client = await connect({ readOnly: true });
    const tool = (await client.listTools()).tools.find((candidate) => candidate.name === 'tomny_library_search');
    expect(tool).toBeDefined();
    expect(
      Object.keys(
        (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
      ).toSorted()
    ).toEqual(['limit', 'query']);
    await client.close();
  });

  it('stays unavailable without a port', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'tomny_library_search', arguments: { query: 'anything' } });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toContain('CORE_WORKSPACE_LIBRARY_UNAVAILABLE');
    await client.close();
  });

  it('returns the best passages with their package and path, through the registered port', async () => {
    const index = await indexWith({
      'source/docs/install.md': 'Run the installer, then the quickstart command.',
      'source/docs/other.md': 'Nothing relevant.',
    });
    registerCoreWorkspaceLibrarySearchPort(createCoreLibrarySearchPort(index));
    const client = await connect();
    const result = await client.callTool({ name: 'tomny_library_search', arguments: { query: 'quickstart' } });
    expect(isError(result)).toBe(false);
    const text = textOf(result);
    expect(text).toContain('com.community.awesome');
    expect(text).toContain('path: source/docs/install.md');
    expect(text).toContain('quickstart command');
    expect(text).not.toContain('other.md');

    const none = await client.callTool({ name: 'tomny_library_search', arguments: { query: 'zzzzzz' } });
    expect(textOf(none)).toContain('No document in the Library matches');

    // A count above the limit and an empty query are refused before the port is asked.
    const port = vi.fn<CoreLibrarySearchPort['search']>(async () => ({ ok: true, message: 'x' }));
    const guarded = await connect({ librarySearch: { search: port } });
    expect(
      isError(await guarded.callTool({ name: 'tomny_library_search', arguments: { query: 'a', limit: 21 } }))
    ).toBe(true);
    expect(isError(await guarded.callTool({ name: 'tomny_library_search', arguments: { query: '' } }))).toBe(true);
    expect(port).not.toHaveBeenCalled();
    await client.close();
    await guarded.close();
  });

  it('caps the answer and masks a secret that a document happens to contain', async () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const index = await indexWith({
      'source/docs/keys.md': `deploy key ${secret} for needle`,
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, item) => [`source/docs/long${item}.md`, `needle ${'filler '.repeat(60)}`])
      ),
    });
    const port = createCoreLibrarySearchPort(index);
    const answer = await port.search({ query: 'needle', limit: 20 });
    expect(answer.ok).toBe(true);
    expect(answer.message).not.toContain(secret);
    expect(answer.message.length).toBeLessThanOrEqual(MAX_RESULT_CHARS + 40);
  });

  it('withholds an answer that the outbound check blocks', async () => {
    const index = await indexWith({ 'source/docs/a.md': 'needle' });
    const port = createCoreLibrarySearchPort(index, {
      inspect: async (request) => ({
        schemaVersion: 1,
        requestId: request.requestId,
        decision: 'block',
        safeParts: [],
        findings: [],
        reasonCode: 'secret_detected',
        requiresUserDecision: false,
        receipt: {} as never,
      }),
    });
    expect(await port.search({ query: 'needle' })).toEqual({
      ok: false,
      message: 'The results were withheld by the outbound text check.',
    });
  });
});

describe('registerPackageContextPorts', () => {
  it('hands the rules and the search to the agent runtime and takes them back', async () => {
    const index = await indexWith({ 'source/docs/a.md': 'needle in a haystack' });
    const rules = {
      contextFor: vi.fn(async () => ({ text: 'Rule text.', sources: [], truncated: false })),
    } as unknown as Parameters<typeof registerPackageContextPorts>[0]['rules'];
    const unregister = registerPackageContextPorts({ rules, knowledge: index });

    const composer = createCoreContextComposer(store());
    expect(await composer.composePrompt(input(WORKSPACE))).toContain('Rule text.');
    const client = await connect();
    expect(textOf(await client.callTool({ name: 'tomny_library_search', arguments: { query: 'needle' } }))).toContain(
      'source/docs/a.md'
    );

    unregister();
    expect(await composer.composePrompt(input(WORKSPACE))).not.toContain('Rule text.');
    expect(isError(await client.callTool({ name: 'tomny_library_search', arguments: { query: 'needle' } }))).toBe(true);
    await client.close();
  });
});
