import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changeSupabasePassword,
  clearSupabaseConfig,
  clearSupabaseSession,
  fetchTomProfile,
  fetchTomTransactions,
  getStoredSupabaseSession,
  getSupabaseConfig,
  isSupabaseConfigured,
  redeemTomCode,
  saveSupabaseSession,
  setSupabaseConfig,
  setSupabaseEnvOverrideForTesting,
  supabaseRefreshToken,
  supabaseResetPasswordForEmail,
  supabaseResendVerification,
  supabaseSignInWithPassword,
  supabaseSignOut,
  supabaseSignUp,
  supabaseVerifyOtp,
  topUpTomBalance,
  updateTomProfile,
} from '@/renderer/services/supabaseAuth';

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
};

const localStorageMock = createLocalStorageMock();

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}

describe('Supabase Authentication Service', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    setSupabaseEnvOverrideForTesting({ url: '', anonKey: '' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setSupabaseEnvOverrideForTesting(null);
  });

  it('detects unconfigured state correctly', () => {
    clearSupabaseConfig();
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseConfig()).toBeNull();
  });

  it('detects configured state from localStorage and normalizes URL', () => {
    setSupabaseConfig('https://myproject.supabase.co///', 'test-anon-key-123');
    expect(isSupabaseConfigured()).toBe(true);
    const config = getSupabaseConfig();
    expect(config).toEqual({
      url: 'https://myproject.supabase.co',
      anonKey: 'test-anon-key-123',
    });
  });

  it('rejects invalid URL protocols', () => {
    setSupabaseConfig('ftp://myproject.supabase.co', 'key');
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('handles sign up with Supabase GoTrue endpoint', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user: { id: 'user-123', email: 'user@example.com' },
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: Date.now() + 3600 * 1000,
      }),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await supabaseSignUp({
      email: 'user@example.com',
      password: 'password123',
      username: 'testuser',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.id).toBe('user-123');
      expect(result.user.email).toBe('user@example.com');
      expect(result.session?.access_token).toBe('mock-access-token');
    }

    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/signup',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: 'test-anon-key',
        },
      })
    );
  });

  it('handles sign up when Supabase returns user object at root without session (confirmation pending)', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: 'user-root-999',
        email: 'pending@example.com',
        aud: 'authenticated',
        role: 'authenticated',
        created_at: new Date().toISOString(),
      }),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await supabaseSignUp({
      email: 'pending@example.com',
      password: 'password123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.id).toBe('user-root-999');
      expect(result.user.email).toBe('pending@example.com');
      expect(result.session).toBeUndefined();
    }
  });

  it('handles sign in with password via grant_type=password', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user: { id: 'user-456', email: 'user2@example.com' },
        access_token: 'signin-token',
        refresh_token: 'signin-refresh',
        expires_at: Date.now() + 3600 * 1000,
      }),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await supabaseSignInWithPassword({
      email: 'user2@example.com',
      password: 'mypassword',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.id).toBe('user-456');
      expect(result.session?.access_token).toBe('signin-token');
    }

    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/token?grant_type=password',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: 'test-anon-key',
        },
      })
    );
  });

  it('handles sign out and clears stored session', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await supabaseSignOut('mock-token-to-revoke');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer mock-token-to-revoke',
        }),
      })
    );
  });

  it('handles password recovery via /auth/v1/recover', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await supabaseResetPasswordForEmail('reset@example.com');
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/recover',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'reset@example.com' }),
      })
    );
  });

  it('handles resending verification via /auth/v1/resend', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await supabaseResendVerification('verify@example.com');
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/resend',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'signup', email: 'verify@example.com' }),
      })
    );
  });

  it('handles OTP verification via /auth/v1/verify', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user: { id: 'otp-user-1', email: 'otp@example.com' },
        access_token: 'otp-token-xyz',
        refresh_token: 'otp-refresh-xyz',
        expires_at: Date.now() + 3600 * 1000,
      }),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await supabaseVerifyOtp({
      email: 'otp@example.com',
      token: '123456',
      type: 'signup',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.user.id).toBe('otp-user-1');
      expect(result.session?.access_token).toBe('otp-token-xyz');
    }
    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'signup', email: 'otp@example.com', token: '123456' }),
      })
    );
  });

  it('fetches Tom profile with balance and tier correctly', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: 'user-789',
          email: 'user@corp.com',
          username: 'usercorp',
          full_name: 'Corp User',
          company_name: 'Acme Corp',
          tier: 'pro',
          role: 'member',
          balance_tom: 25.5,
          currency: 'TOM',
        },
      ],
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const profile = await fetchTomProfile('user-789', 'mock-jwt-token');
    expect(profile).not.toBeNull();
    expect(profile?.balance_tom).toBe(25.5);
    expect(profile?.currency).toBe('TOM');
    expect(profile?.tier).toBe('pro');
    expect(profile?.company_name).toBe('Acme Corp');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/profiles?id=eq.user-789'),
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: 'test-anon-key',
          Authorization: 'Bearer mock-jwt-token',
        }),
      })
    );
  });

  it('updates Tom profile info via PATCH', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const res = await updateTomProfile('user-1', { full_name: 'Nguyen Van A', company_name: 'Tomni AI' }, 'mock-token');
    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/profiles?id=eq.user-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ full_name: 'Nguyen Van A', company_name: 'Tomni AI' }),
      })
    );
  });

  it('changes password via PUT /auth/v1/user', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'user-1' }),
    }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const res = await changeSupabasePassword('newPassword123#', 'mock-token');
    expect(res.success).toBe(true);
    expect(res.message).toContain('thành công');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://myproject.supabase.co/auth/v1/user',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ password: 'newPassword123#' }),
      })
    );
  });

  it('fetches transactions and handles topUp / redeem code', async () => {
    setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

    const mockFetch = vi.fn(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PATCH' || opts?.method === 'POST') {
        return { ok: true, json: async () => ({}) };
      }
      if (typeof url === 'string' && url.includes('/rest/v1/profiles')) {
        return {
          ok: true,
          json: async () => [{ id: 'user-tx', balance_tom: 10.0 }],
        };
      }
      return {
        ok: true,
        json: async () => [
          {
            id: 'tx-1',
            user_id: 'user-tx',
            amount: 5.0,
            type: 'bonus',
            description: 'Cộng tiền thưởng đăng ký (+5.00 TOM)',
            balance_after: 5.0,
            created_at: new Date().toISOString(),
          },
        ],
      };
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const txs = await fetchTomTransactions('user-tx');
    expect(txs.length).toBeGreaterThanOrEqual(1);
    expect(txs[0].type).toBe('bonus');

    const topUpRes = await topUpTomBalance('user-tx', 10.0, 'Test Topup');
    expect(topUpRes.success).toBe(true);
    expect(topUpRes.newBalance).toBe(20.0);

    const redeemRes = await redeemTomCode('user-tx', 'TOMNI2026');
    expect(redeemRes.success).toBe(true);
    expect(redeemRes.amount).toBe(20.0);

    // Duplicate redeem should be blocked
    const dupRes = await redeemTomCode('user-tx', 'TOMNI2026');
    expect(dupRes.success).toBe(false);
  });

  describe('supabaseRefreshToken', () => {
    it('successfully refreshes token with explicit refresh token and saves new session', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user: { id: 'user-refresh-1', email: 'refresh@example.com' },
          access_token: 'new-access-token-123',
          refresh_token: 'new-refresh-token-456',
          expires_at: 1800000000,
          expires_in: 3600,
        }),
      }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await supabaseRefreshToken('my-refresh-token');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.user.id).toBe('user-refresh-1');
        expect(result.user.email).toBe('refresh@example.com');
        expect(result.session?.access_token).toBe('new-access-token-123');
        expect(result.session?.refresh_token).toBe('new-refresh-token-456');
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://myproject.supabase.co/auth/v1/token?grant_type=refresh_token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: 'test-anon-key',
          },
          body: JSON.stringify({ refresh_token: 'my-refresh-token' }),
        })
      );

      const stored = getStoredSupabaseSession();
      expect(stored?.access_token).toBe('new-access-token-123');
      expect(stored?.refresh_token).toBe('new-refresh-token-456');
    });

    it('uses stored session refresh token when parameter is omitted', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      saveSupabaseSession({
        access_token: 'old-access-token',
        refresh_token: 'stored-refresh-token-789',
        expires_at: Date.now() - 1000,
        user: { id: 'user-stored', email: 'stored@example.com' },
      });

      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user: { id: 'user-stored', email: 'stored@example.com' },
          access_token: 'refreshed-token-999',
          refresh_token: 'next-refresh-token-111',
          expires_at: 1900000000,
        }),
      }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await supabaseRefreshToken();
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://myproject.supabase.co/auth/v1/token?grant_type=refresh_token',
        expect.objectContaining({
          body: JSON.stringify({ refresh_token: 'stored-refresh-token-789' }),
        })
      );
    });

    it('handles 400/401 token revocation by clearing session and returning source supabase', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      saveSupabaseSession({
        access_token: 'old-token',
        refresh_token: 'revoked-refresh-token',
        expires_at: Date.now() - 1000,
        user: { id: 'user-revoked', email: 'revoked@example.com' },
      });

      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token: Already Used',
        }),
      }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await supabaseRefreshToken('revoked-refresh-token');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.source).toBe('supabase');
        expect(result.statusCode).toBe(400);
      }
      expect(getStoredSupabaseSession()).toBeNull();
    });

    it('handles network error gracefully without clearing stored session', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      saveSupabaseSession({
        access_token: 'offline-access-token',
        refresh_token: 'offline-refresh-token',
        expires_at: Date.now() - 1000,
        user: { id: 'user-offline', email: 'offline@example.com' },
      });

      const mockFetch = vi.fn(async () => {
        throw new Error('Network failure: ECONNREFUSED');
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await supabaseRefreshToken('offline-refresh-token');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.source).toBe('network');
      }
      expect(getStoredSupabaseSession()).not.toBeNull();
    });

    it('returns validation error when no refresh token is provided or stored', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');
      clearSupabaseSession();

      const result = await supabaseRefreshToken();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.source).toBe('validation');
      }
    });

    it('returns error when Supabase is not configured', async () => {
      clearSupabaseConfig();

      const result = await supabaseRefreshToken('any-token');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Supabase is not configured');
    });
  });

  describe('fetchWithTimeout and timeout handling (Issue #3)', () => {
    it('returns null and does not hang when fetchTomProfile times out', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      // Simulate a fetch that hangs until aborted
      const hangingFetch = vi.fn(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            opts?.signal?.addEventListener('abort', () => {
              reject(new Error('Request timed out after 50ms'));
            });
          })
      );
      globalThis.fetch = hangingFetch as unknown as typeof fetch;

      const profile = await fetchTomProfile('user-timeout', 'mock-token', { timeoutMs: 50 });
      expect(profile).toBeNull();
      expect(hangingFetch).toHaveBeenCalled();
    });

    it('returns null when fetchTomProfile encounters network failure', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      const failedFetch = vi.fn(async () => {
        throw new Error('Network ECONNREFUSED');
      });
      globalThis.fetch = failedFetch as unknown as typeof fetch;

      const profile = await fetchTomProfile('user-fail', 'mock-token');
      expect(profile).toBeNull();
    });

    it('honors caller-supplied AbortSignal in fetchTomProfile', async () => {
      setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      const controller = new AbortController();
      controller.abort(new Error('Component unmounted'));

      const abortFetch = vi.fn(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            if (opts?.signal?.aborted) {
              reject(new Error('Component unmounted'));
            }
          })
      );
      globalThis.fetch = abortFetch as unknown as typeof fetch;

      const profile = await fetchTomProfile('user-abort', 'mock-token', { signal: controller.signal });
      expect(profile).toBeNull();
    });
  });
});
