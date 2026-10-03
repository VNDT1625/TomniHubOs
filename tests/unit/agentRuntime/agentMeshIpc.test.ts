import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMeshService } from '@/process/agentRuntime/agentMesh/service';
import {
  AGENT_MESH_CHANNELS,
  registerAgentMeshBridge,
  type AgentMeshResult,
} from '@/process/agentRuntime/agentMesh/ipc';

type RegisteredProvider = (request: unknown) => Promise<unknown>;

const registered = new Map<string, RegisteredProvider>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: RegisteredProvider) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
  },
}));

const AUTH_REQUIRED = 'ACCOUNT_SESSION_ONLINE_REQUIRED';

const getProvider = (channel: string): RegisteredProvider => {
  const provider = registered.get(channel);
  if (provider === undefined) throw new Error(`Missing Agent Mesh provider: ${channel}`);
  return provider;
};

const createServiceProbe = (method: ReturnType<typeof vi.fn>): AgentMeshService =>
  new Proxy({}, { get: () => method }) as AgentMeshService;

describe('Agent Mesh account authority', () => {
  beforeEach(() => registered.clear());

  it('rejects every provider before accessing the mesh service when the Main account guard rejects', async () => {
    const serviceAccess = vi.fn();
    const requireAuthenticatedAccount = vi.fn(() => {
      throw new Error(AUTH_REQUIRED);
    });
    registerAgentMeshBridge(createServiceProbe(serviceAccess), { requireAuthenticatedAccount });

    const channels = Object.values(AGENT_MESH_CHANNELS);
    expect(registered.size).toBe(channels.length);

    await Promise.all(
      channels.map(async (channel) => {
        const provider = getProvider(channel);
        if (channel === AGENT_MESH_CHANNELS.sessions) {
          await expect(provider(undefined)).rejects.toThrow(AUTH_REQUIRED);
        } else {
          await expect(provider(undefined)).resolves.toEqual({ ok: false, error: AUTH_REQUIRED });
        }
      })
    );

    expect(requireAuthenticatedAccount).toHaveBeenCalledTimes(channels.length);
    expect(serviceAccess).not.toHaveBeenCalled();
  });

  it('allows an authenticated request to reach the service exactly once', async () => {
    const discoverSessions = vi.fn(async () => ['session-1']);
    const requireAuthenticatedAccount = vi.fn();
    registerAgentMeshBridge(createServiceProbe(discoverSessions), { requireAuthenticatedAccount });

    await expect(getProvider(AGENT_MESH_CHANNELS.sessions)(undefined)).resolves.toEqual(['session-1']);
    expect(requireAuthenticatedAccount).toHaveBeenCalledOnce();
    expect(discoverSessions).toHaveBeenCalledOnce();
  });

  it('preserves the existing result envelope for authenticated requests', async () => {
    const create = vi.fn(() => undefined);
    registerAgentMeshBridge(createServiceProbe(create));

    const result = (await getProvider(AGENT_MESH_CHANNELS.create)({
      sessionId: 'session-1',
    })) as AgentMeshResult<string>;
    expect(result).toEqual({ ok: true, data: 'session-1' });
    expect(create).toHaveBeenCalledWith('session-1');
  });
});
