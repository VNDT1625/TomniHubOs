import type { TokenChannelTransport } from './tokenAdapter';

type SlackAuth = { ok?: boolean; user?: string; team?: string; error?: string };
type DiscordUser = { id?: string; username?: string; global_name?: string; message?: string };

export const createSlackTransport = (fetchImpl: typeof fetch = fetch): TokenChannelTransport => ({
  id: 'slack',
  name: 'Slack',
  async test(token) {
    const response = await fetchImpl('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as SlackAuth;
    if (!response.ok || body.ok !== true) throw new Error(body.error || `Slack authentication failed (${response.status}).`);
    return { identity: body.user || body.team };
  },
});

export const createDiscordTransport = (fetchImpl: typeof fetch = fetch): TokenChannelTransport => ({
  id: 'discord',
  name: 'Discord',
  async test(token) {
    const response = await fetchImpl('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${token}` },
    });
    const body = (await response.json()) as DiscordUser;
    if (!response.ok || !body.id) throw new Error(body.message || `Discord authentication failed (${response.status}).`);
    return { identity: body.username || body.global_name || body.id };
  },
});
