import type { IChannelPluginStatus, IChannelSession } from '@/common/types/channel/channel';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import type { NativeChannelAdapter, NativeChannelTestResult } from './registry';

export type TokenChannelState = {
  secretHandle?: string;
  enabled: boolean;
  identity?: string;
  sessions: IChannelSession[];
};
export type TokenChannelStatePort = {
  load: (id: string) => Promise<TokenChannelState | undefined>;
  save: (id: string, state: TokenChannelState) => Promise<void>;
};
export type TokenChannelTransport = {
  id: 'slack' | 'discord';
  name: string;
  test: (token: string) => Promise<{ identity?: string }>;
};

const tokenFrom = (config: Record<string, unknown>): string => {
  const credentials = config.credentials;
  return credentials && typeof credentials === 'object' && typeof (credentials as { token?: unknown }).token === 'string'
    ? (credentials as { token: string }).token.trim()
    : '';
};

export const createTokenChannelAdapter = (input: {
  transport: TokenChannelTransport;
  vault: SecretVault;
  state: TokenChannelStatePort;
}): NativeChannelAdapter => {
  let cached: TokenChannelState | undefined;
  const current = async (): Promise<TokenChannelState> =>
    (cached ??= (await input.state.load(input.transport.id)) ?? { enabled: false, sessions: [] });
  const resolveToken = async (state: TokenChannelState): Promise<string> => {
    if (!state.secretHandle) throw new Error(`${input.transport.name} token is not configured.`);
    const secret = await input.vault.resolve({
      handle: state.secretHandle,
      surface: input.transport.id,
      purpose: 'channel-transport',
      target: input.transport.id,
      fields: ['token'],
    });
    return secret.token;
  };
  return {
    id: input.transport.id,
    async status(): Promise<IChannelPluginStatus> {
      const state = await current();
      return {
        id: input.transport.id,
        type: input.transport.id,
        name: input.transport.name,
        enabled: state.enabled,
        connected: state.enabled && Boolean(state.identity),
        status: state.enabled ? 'running' : 'disabled',
        activeUsers: state.sessions.length,
        botUsername: state.identity,
        hasToken: Boolean(state.secretHandle),
      };
    },
    async test(token: string): Promise<NativeChannelTestResult> {
      try {
        const result = await input.transport.test(token.trim());
        return { success: true, bot_username: result.identity };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async enable(config): Promise<void> {
      const state = await current();
      const supplied = tokenFrom(config);
      const token = supplied || (await resolveToken(state));
      const tested = await input.transport.test(token);
      if (supplied) {
        if (state.secretHandle) await input.vault.remove(state.secretHandle);
        const descriptor = await input.vault.put(
          {
            label: `${input.transport.name} Bot Token`,
            kind: 'token',
            fields: ['token'],
            binding: {
              surfaces: [input.transport.id],
              purposes: ['channel-transport'],
              targets: [input.transport.id],
            },
          },
          { token }
        );
        state.secretHandle = descriptor.handle;
      }
      state.enabled = true;
      state.identity = tested.identity;
      await input.state.save(input.transport.id, state);
    },
    async disable(): Promise<void> {
      const state = await current();
      state.enabled = false;
      await input.state.save(input.transport.id, state);
    },
    async sessions(): Promise<IChannelSession[]> {
      return structuredClone((await current()).sessions);
    },
  };
};
