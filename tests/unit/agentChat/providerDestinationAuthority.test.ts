import { describe, expect, it, vi } from 'vitest';

import {
  createProviderDestinationAuthority,
  ProviderDestinationAuthorityError,
} from '@process/services/security/providerExecution/providerDestinationAuthority';

describe('ProviderDestinationAuthority', () => {
  it('binds destination evidence to the live Main account and saved provider revision', async () => {
    let accountId = 'account-1';
    const source = {
      getDestinationBinding: vi.fn(async () => ({
        providerId: 'provider-1',
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        isFullUrl: true,
        version: 4,
      })),
    };
    const authority = createProviderDestinationAuthority({ actorId: () => accountId, providerStore: source });

    const admission = await authority.admit('provider-1');
    expect(admission).toMatchObject({
      accountId: 'account-1',
      providerId: 'provider-1',
      hostname: '127.0.0.1',
      version: 4,
    });
    await expect(authority.assertCurrent(admission)).resolves.toBeUndefined();

    accountId = 'account-2';
    await expect(authority.assertCurrent(admission)).rejects.toBeInstanceOf(ProviderDestinationAuthorityError);
    await expect(authority.admit('provider-1')).rejects.toBeInstanceOf(ProviderDestinationAuthorityError);
  });

  it('fails closed after the saved endpoint revision changes or a destination is revoked', async () => {
    let binding = {
      providerId: 'provider-1',
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      isFullUrl: true,
      version: 1,
    };
    const authority = createProviderDestinationAuthority({
      actorId: () => 'account-1',
      providerStore: { getDestinationBinding: vi.fn(async () => binding) },
    });
    const admission = await authority.admit('provider-1');

    binding = { ...binding, endpoint: 'http://127.0.0.1:11435/v1/chat/completions', version: 2 };
    await expect(authority.assertCurrent(admission)).rejects.toBeInstanceOf(ProviderDestinationAuthorityError);

    binding = { ...binding, endpoint: 'http://127.0.0.1:11434/v1/chat/completions', version: 1 };
    authority.revoke(admission);
    await expect(authority.admit('provider-1')).rejects.toBeInstanceOf(ProviderDestinationAuthorityError);
  });

  it('denies legacy or missing saved destination evidence', async () => {
    const authority = createProviderDestinationAuthority({
      actorId: () => 'account-1',
      providerStore: { getDestinationBinding: vi.fn(async () => undefined) },
    });

    await expect(authority.admit('provider-1')).rejects.toBeInstanceOf(ProviderDestinationAuthorityError);
  });

  it('expires authority evidence instead of turning a saved host into a permanent allowlist', async () => {
    let now = 100;
    const authority = createProviderDestinationAuthority({
      actorId: () => 'account-1',
      now: () => now,
      evidenceTtlMs: 10,
      providerStore: {
        getDestinationBinding: vi.fn(async () => ({
          providerId: 'provider-1',
          endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
          isFullUrl: true,
          version: 1,
        })),
      },
    });
    const admission = await authority.admit('provider-1');

    expect(
      authority.allowsProviderExecution({ accountId: 'account-1', providerId: 'provider-1', hostname: '127.0.0.1' })
    ).toBe(true);
    now = 110;
    expect(
      authority.allowsProviderExecution({ accountId: 'account-1', providerId: 'provider-1', hostname: '127.0.0.1' })
    ).toBe(false);
    await expect(authority.assertCurrent(admission)).rejects.toBeInstanceOf(ProviderDestinationAuthorityError);
  });
});
