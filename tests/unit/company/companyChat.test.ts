import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  runAgentChatMessages: vi.fn(),
  createProviderChat: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@process/services/tomnyProviderBridge', () => ({
  getReadyProviderStore: vi.fn(async () => ({ list: mocks.list })),
}));
vi.mock('@process/services/agentChat', () => ({
  isCliModelId: (model: string) => model.startsWith('cli:'),
  runAgentChatMessages: mocks.runAgentChatMessages,
  createProviderChat: mocks.createProviderChat,
}));

import { createCompanyChat } from '@process/company/companyChat';

const provider = {
  id: 'provider-1',
  platform: 'openai',
  name: 'Provider',
  base_url: 'https://models.example/v1',
  api_key: 'secret',
  models: ['model-1'],
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([provider]);
  mocks.createProviderChat.mockImplementation(
    (broker?: { execute: typeof mocks.execute }) => async (request: unknown) => {
      if (!broker) throw new Error('PROVIDER_EXECUTION_BROKER_REQUIRED');
      return (await broker.execute(request)).content;
    }
  );
  mocks.runAgentChatMessages.mockImplementation(
    (
      providerRun: (model: string, messages: unknown[], signal?: AbortSignal) => Promise<string>,
      model: string,
      messages: unknown[],
      signal?: AbortSignal
    ) => providerRun(model, messages, signal)
  );
  mocks.execute.mockResolvedValue({ content: 'planned', evidenceRef: 'provider-egress:opaque' });
});

describe('Company chat provider execution boundary', () => {
  it('uses the injected Main broker and never fetches or serializes a provider secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'planned' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createCompanyChat({ providerExecutionBroker: { execute: mocks.execute } as never })({
      model: 'model-1',
      messages: [{ role: 'user', content: 'Plan release' }],
    });

    expect(result).toBe('planned');
    expect(mocks.execute).toHaveBeenCalledWith({
      model: 'model-1',
      messages: [{ role: 'user', content: 'Plan release' }],
      signal: undefined,
    });
    expect(mocks.execute.mock.calls[0]?.[0]).not.toHaveProperty('apiKey');
    expect(mocks.execute.mock.calls[0]?.[0]).not.toHaveProperty('baseUrl');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes CLI assignments through the direct Tomny agent service without reading the provider store', async () => {
    mocks.runAgentChatMessages.mockResolvedValue('cli result');

    const result = await createCompanyChat()({
      model: 'cli:codex',
      messages: [{ role: 'user', content: 'Review' }],
    });

    expect(result).toBe('cli result');
    expect(mocks.runAgentChatMessages).toHaveBeenCalledOnce();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('fails closed without a configured Main broker before direct egress', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createCompanyChat({ resolveModelId: async () => 'model-1' })({ messages: [{ role: 'user', content: 'Plan' }] })
    ).rejects.toThrow('PROVIDER_EXECUTION_BROKER_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
