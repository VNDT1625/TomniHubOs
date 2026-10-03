import { app, shell } from 'electron';
import path from 'node:path';

import type { AccountSessionService } from '../accountSession/accountSessionService';
import { createProviderOAuthClient, type ProviderOAuthClient } from './providerOAuthClient';
import { createProviderOAuthLoopbackTransport } from './providerOAuthLoopbackTransport';
import { createProviderOAuthVault } from './providerOAuthVault';

const OPENAI_PROVIDER_ID = 'openai-oauth';
const OPENAI_REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
const OPENAI_AUTHORIZATION_ENDPOINT = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';
const OPENAI_CLIENT_ID = '';

/** Builds the optional real provider OAuth client from Main-only configuration. */
export const createConfiguredProviderOAuthClients = (
  accountSession: AccountSessionService
): ReadonlyMap<string, ProviderOAuthClient> => {
  const clientId = process.env.TOMNY_OPENAI_OAUTH_CLIENT_ID?.trim() || OPENAI_CLIENT_ID;
  if (!clientId) return new Map();
  const clientSecret = process.env.TOMNY_OPENAI_OAUTH_CLIENT_SECRET?.trim();

  const vault = createProviderOAuthVault({
    rootDir: path.join(app.getPath('userData'), 'tomny-security'),
    actorId: () => accountSession.requireOnlineSession().accountId,
  });
  const transport = createProviderOAuthLoopbackTransport(async (url) => {
    await shell.openExternal(url);
  });
  const client = createProviderOAuthClient(
    {
      providerId: OPENAI_PROVIDER_ID,
      authorizationEndpoint: OPENAI_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: OPENAI_TOKEN_ENDPOINT,
      clientId,
      ...(clientSecret === undefined ? {} : { clientSecret }),
      redirectUri: OPENAI_REDIRECT_URI,
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      authorizationParameters: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
      },
    },
    vault,
    transport
  );
  return new Map([[OPENAI_PROVIDER_ID, client]]);
};

export { OPENAI_PROVIDER_ID };
