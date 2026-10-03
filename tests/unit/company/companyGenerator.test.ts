import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProviderChat: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@process/services/agentChat', () => ({
  createProviderChat: mocks.createProviderChat,
}));

import { createCompanyGenerator } from '@process/company/companyGenerator';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createProviderChat.mockImplementation(
    (broker?: { execute: typeof mocks.execute }) => async (request: unknown) => {
      if (!broker) throw new Error('PROVIDER_EXECUTION_BROKER_REQUIRED');
      return (await broker.execute(request)).content;
    }
  );
  mocks.execute.mockResolvedValue({ content: '{"roles":[]}', evidenceRef: 'provider-egress:opaque' });
});

describe('Company generator provider execution boundary', () => {
  it('delegates only model/messages to the Main broker and never directly fetches', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await createCompanyGenerator({
      providerExecutionBroker: { execute: mocks.execute } as never,
      resolveModelId: async () => 'model-1',
    })('Design a release company');

    expect(result).toBe('{"roles":[]}');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'model-1',
        messages: [{ role: 'user', content: 'Design a release company' }],
      })
    );
    expect(mocks.execute.mock.calls[0]?.[0]).not.toHaveProperty('apiKey');
    expect(mocks.execute.mock.calls[0]?.[0]).not.toHaveProperty('baseUrl');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed without a Main broker before any provider egress', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createCompanyGenerator({ resolveModelId: async () => 'model-1' })('Design')).rejects.toThrow(
      'PROVIDER_EXECUTION_BROKER_REQUIRED'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
