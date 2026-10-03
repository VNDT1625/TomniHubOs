import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAutomationStore } from '@process/automation/automationStore';
import type {
  AutomationChatRequest,
  AutomationChatResult,
  AutomationChatReply,
} from '@process/automation/automationChatBridge';

type RegisteredProvider = (request: AutomationChatRequest) => Promise<AutomationChatResult<AutomationChatReply>>;

const registered = new Map<string, RegisteredProvider>();
const mocks = vi.hoisted(() => ({
  providerChat: vi.fn(),
  runAgentChatMessages: vi.fn(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: RegisteredProvider) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
  },
}));

vi.mock('@process/services/agentChat', () => ({
  createProviderChat: () => mocks.providerChat,
  runAgentChatMessages: mocks.runAgentChatMessages,
}));

vi.mock('@process/automation/automationBridge', () => ({
  getSharedAutomationServices: vi.fn(),
}));

const request: AutomationChatRequest = {
  model: 'model-1',
  messages: [{ role: 'user', content: 'Create a workflow.' }],
};

const getChatHandler = (): RegisteredProvider => {
  const handler = registered.get('automation.chat');
  if (handler === undefined) throw new Error('Automation chat provider was not registered.');
  return handler;
};

describe('Automation Chat account authority', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    registered.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    mocks.providerChat.mockReset();
    mocks.runAgentChatMessages.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('denies a signed-out request before provider selection or provider egress', async () => {
    const { AUTOMATION_CHAT_ACCOUNT_REQUIRED, registerAutomationChatBridge } =
      await import('@process/automation/automationChatBridge');
    const requireAuthenticatedAccount = vi.fn(() => {
      throw new Error('ACCOUNT_SESSION_ONLINE_REQUIRED');
    });

    registerAutomationChatBridge({
      store: {} as IAutomationStore,
      requireAuthenticatedAccount,
      egressAuthority: { authorizeExternalEgress: () => undefined },
    });

    await expect(getChatHandler()(request)).resolves.toEqual({
      ok: false,
      error: AUTOMATION_CHAT_ACCOUNT_REQUIRED,
      code: 'error',
    });
    expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.runAgentChatMessages).not.toHaveBeenCalled();
    expect(mocks.providerChat).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the Main account guard before an admitted request reaches provider egress', async () => {
    const { registerAutomationChatBridge } = await import('@process/automation/automationChatBridge');
    const requireAuthenticatedAccount = vi.fn();
    mocks.providerChat.mockResolvedValue('Workflow advice.');
    mocks.runAgentChatMessages.mockImplementation(async (...args: unknown[]) => {
      const runProvider = args[0] as (model: string, messages: unknown[], signal?: AbortSignal) => Promise<string>;
      return await runProvider('model-1', []);
    });

    registerAutomationChatBridge({
      store: {} as IAutomationStore,
      requireAuthenticatedAccount,
      egressAuthority: { authorizeExternalEgress: () => undefined },
    });

    await expect(getChatHandler()(request)).resolves.toEqual({ ok: true, data: { reply: 'Workflow advice.' } });
    expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.runAgentChatMessages).toHaveBeenCalledOnce();
    expect(mocks.providerChat).toHaveBeenCalledWith({ model: 'model-1', messages: [], signal: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed before provider selection when the Main egress authority is absent', async () => {
    const { AUTOMATION_CHAT_EGRESS_DENIED, registerAutomationChatBridge } =
      await import('@process/automation/automationChatBridge');
    const requireAuthenticatedAccount = vi.fn();

    registerAutomationChatBridge({ store: {} as IAutomationStore, requireAuthenticatedAccount });

    await expect(getChatHandler()(request)).resolves.toEqual({
      ok: false,
      error: AUTOMATION_CHAT_EGRESS_DENIED,
      code: 'error',
    });
    expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(mocks.runAgentChatMessages).not.toHaveBeenCalled();
    expect(mocks.providerChat).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
