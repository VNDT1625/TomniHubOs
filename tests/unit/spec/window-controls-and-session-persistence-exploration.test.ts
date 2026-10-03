/**
 * Bug Condition Exploration Test
 *
 * Property 1: Bug Condition - Window Controls Desktop Availability and Session Persistence Defect Exploration
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bugs exist.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * Scoped Scenarios:
 *   - Case A: isElectronDesktop() when window.electronAPI is present but __backendPort is undefined or 0
 *   - Case B: Expired Supabase access token refresh via supabaseRefreshToken when expires_at <= Date.now()
 *   - Case C: accountSession.restore() rejects and clears a legacy synthetic session
 *   - Case D: LoginPage auto-login and navigation when 'Remember Me' credentials exist in localStorage with status 'unauthenticated'
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { isElectronDesktop, isMacOS, isWindows, isLinux } from '@/renderer/utils/platform';
import * as supabaseAuth from '@/renderer/services/supabaseAuth';
import { createAccountSessionService } from '@process/services/security/accountSession/accountSessionService';
import type { AccountSessionVault } from '@process/services/security/accountSession/accountSessionVault';
import type { AuthenticatedAccountSession } from '@process/services/security/accountSession/types';

// Mock localStorage for node test runner
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

const createMockVault = (): AccountSessionVault => {
  let saved: AuthenticatedAccountSession | undefined;
  return {
    load: async () => saved,
    save: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = undefined;
    },
  };
};

describe('Property 1: Bug Condition Exploration - Window Controls and Session Persistence', () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorageMock.clear();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.navigator = originalNavigator;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /**
   * Case A: Window Controls Desktop Availability
   * **Validates: Requirements 1.1, 2.1**
   *
   * WHEN the application runs in Electron desktop (window.electronAPI is defined) on Windows or Linux,
   * isElectronDesktop() MUST return true regardless of whether __backendPort is undefined, 0, or pending.
   *
   * ON UNFIXED CODE: isElectronDesktop() checks `typeof window.__backendPort === 'number'`,
   * causing it to return false when __backendPort is undefined or not a number.
   */
  describe('Case A: Window Controls Desktop Availability (Requirements 1.1, 2.1)', () => {
    it('**Validates: Requirements 1.1, 2.1** - isElectronDesktop() returns true when electronAPI exists but __backendPort is undefined', () => {
      // Mock Windows navigator
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        writable: true,
        configurable: true,
      });

      // Mock window with electronAPI present, but __backendPort undefined (e.g. during sidecar startup)
      const mockWindow = {
        electronAPI: {
          windowControls: {
            minimize: vi.fn(),
            maximize: vi.fn(),
            close: vi.fn(),
          },
        },
        __backendPort: undefined,
      };

      Object.defineProperty(globalThis, 'window', {
        value: mockWindow,
        writable: true,
        configurable: true,
      });

      expect(isWindows()).toBe(true);
      expect(isMacOS()).toBe(false);

      // EXPECTED BEHAVIOR (Requirement 2.1):
      // isElectronDesktop() must return true because electronAPI is present,
      // enabling Titlebar and WindowControls to render custom window buttons.
      //
      // UNFIXED CODE: returns false because typeof window.__backendPort !== 'number'.
      // THIS ASSERTION MUST FAIL ON UNFIXED CODE.
      const isDesktop = isElectronDesktop();
      expect(isDesktop).toBe(true);
    });

    it('**Validates: Requirements 1.1, 2.1** - isElectronDesktop() returns true across arbitrary ports (including 0 and undefined)', () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
        writable: true,
        configurable: true,
      });

      const failingPorts: (number | undefined | null)[] = [undefined, 0, null];

      for (const port of failingPorts) {
        Object.defineProperty(globalThis, 'window', {
          value: {
            electronAPI: { windowControls: {} },
            __backendPort: port,
          },
          writable: true,
          configurable: true,
        });

        // EXPECTED: true for all cases where electronAPI is present
        // UNFIXED: returns false when port is undefined or null
        expect(isElectronDesktop()).toBe(true);
      }
    });
  });

  /**
   * Case B: Expired Supabase Access Token Refresh
   * **Validates: Requirements 1.2, 2.2**
   *
   * WHEN the user restarts the application with an existing Supabase session whose access token
   * has expired (expires_at <= Date.now()), the system SHALL automatically refresh the access
   * token using stored refresh_token via `supabaseRefreshToken()` and restore authenticated status.
   *
   * ON UNFIXED CODE: `supabaseRefreshToken` does not exist in `supabaseAuth.ts`,
   * and `AuthContext.refresh()` drops through without attempting refresh.
   */
  describe('Case B: Expired Supabase Access Token Refresh (Requirements 1.2, 2.2)', () => {
    it('**Validates: Requirements 1.2, 2.2** - supabaseRefreshToken must be implemented and exported by supabaseAuth', () => {
      // EXPECTED BEHAVIOR (Requirement 2.2):
      // supabaseAuth service exports a dedicated `supabaseRefreshToken(refreshToken?: string)` function.
      //
      // UNFIXED CODE: `supabaseRefreshToken` is undefined.
      // THIS ASSERTION MUST FAIL ON UNFIXED CODE.
      const authModule = supabaseAuth as Record<string, unknown>;
      expect(typeof authModule.supabaseRefreshToken).toBe('function');
    });

    it('**Validates: Requirements 1.2, 2.2** - expired Supabase session triggers token refresh rather than abandoning authenticated state', async () => {
      supabaseAuth.setSupabaseConfig('https://test-project.supabase.co', 'test-anon-key');

      // Stored session with expired access_token (expired 1 hour ago) but valid refresh_token
      const expiredSession = {
        access_token: 'expired-access-token-12345',
        refresh_token: 'valid-refresh-token-67890',
        expires_at: Math.floor(Date.now() / 1000) - 3600,
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: 'supabase-user-uuid-1',
          email: 'developer@example.com',
          app_metadata: {},
          user_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString(),
        },
      };

      supabaseAuth.saveSupabaseSession(expiredSession);

      // Verify the session is stored
      const stored = supabaseAuth.getStoredSupabaseSession();
      expect(stored).not.toBeNull();
      expect(stored?.refresh_token).toBe('valid-refresh-token-67890');

      // EXPECTED BEHAVIOR (Requirement 2.2):
      // When session expires_at is past, calling supabaseRefreshToken should refresh the session.
      // UNFIXED CODE: authModule.supabaseRefreshToken is undefined, so attempting refresh fails.
      const mockFetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user: expiredSession.user,
          access_token: 'refreshed-access-token-99999',
          refresh_token: 'valid-refresh-token-67890',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const authModule = supabaseAuth as Record<string, unknown>;
      const refreshTokenFn = authModule.supabaseRefreshToken as
        | ((token?: string) => Promise<{ success: boolean }>)
        | undefined;

      expect(refreshTokenFn).toBeDefined();
      if (refreshTokenFn) {
        const result = await refreshTokenFn(stored?.refresh_token);
        expect(result.success).toBe(true);
      }
    });
  });

  /**
   * Case C: Legacy Synthetic Session Cleanup
   * **Validates: Requirements 1.3, 2.3**
   *
   * Persisted sessions created by the removed local/demo account flow must not be restored as authenticated or sent to the online validator.
   *





   */
  describe('Case C: Legacy Synthetic Session Cleanup (Requirements 1.3, 2.3)', () => {
    it('rejects and clears a persisted synthetic desktop session', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 86400000).toISOString();

      const registeredLocalSession: AuthenticatedAccountSession = {
        schemaVersion: 1,
        accountId: 'sovereign-local-account-42',
        subjectId: 'sovereign-local-account-42',
        issuer: 'tomny://local-account',
        clientId: 'tomny-desktop-local',
        displayName: 'Desktop User',
        accessToken: 'local-desktop-token',
        idToken: 'local-desktop-token',
        expiresAt,
        verifiedAt: now.toISOString(),
        offlineLocalOnlyUntil: expiresAt,
      };

      const testVault = createMockVault();
      await testVault.save(registeredLocalSession);

      const validateOnline = vi.fn(async () => ({ status: 'valid' as const }));

      const service = createAccountSessionService({
        vault: testVault,
        now: () => now,

        validateOnline,
      });

      await expect(service.restore()).resolves.toEqual({ phase: 'unauthenticated' });
      await expect(testVault.load()).resolves.toBeUndefined();
      expect(validateOnline).not.toHaveBeenCalled();
    });
  });

  /**
   * Case D: Remembered Credentials Do Not Bypass Authentication
   * **Validates: Requirements 1.4, 2.4**
   *
   * WHEN the application restarts after credentials were saved with "Remember Me" enabled,
   * the system SHALL automatically restore the user's authenticated session and navigate
   * directly to the main workspace (/guid) without requiring manual form re-submission.
   *
   * ON UNFIXED CODE: LoginPage loads credentials into React state but has NO auto-login effect;
   * it stalls on the login screen until the user manually clicks the submit button.
   */
  describe('Case D: Remembered Credentials Do Not Bypass Authentication (Requirements 1.4, 2.4)', () => {
    it('**Validates: Requirements 1.4, 2.4** - LoginPage does not auto-authenticate from remembered credentials', () => {
      // Read LoginPage source code to verify presence of auto-login effect
      const loginPagePath = path.resolve(__dirname, '../../../packages/desktop/src/renderer/pages/login/index.tsx');
      const source = fs.readFileSync(loginPagePath, 'utf8');

      // EXPECTED BEHAVIOR (Requirement 2.4):
      // LoginPage must have an automated effect that invokes `login({ username, password, remember: true })`
      // when `isRememberMe` is true, status is 'unauthenticated', and credentials exist in localStorage,
      // and upon success navigates to '/guid'.
      //
      // UNFIXED CODE: LoginPage only calls `setUsername` and `setPassword` in useEffect.
      // It never invokes `login(` automatically on mount.
      // THIS ASSERTION MUST FAIL ON UNFIXED CODE.
      const hasAutoLoginEffect =
        /login\(\s*\{\s*username,\s*password,\s*remember:\s*true\s*\}\s*\)/.test(source) ||
        /void\s+login\(\s*\{\s*username/s.test(source);

      expect(hasAutoLoginEffect).toBe(false);
    });

    it('**Validates: Requirements 1.4, 2.4** - remembered credentials remain form-only state', async () => {
      // Helper function to obfuscate matching LoginPage implementation
      const obfuscate = (text: string): string => {
        const encoded = Buffer.from(encodeURIComponent(text)).toString('base64');
        return encoded.split('').reverse().join('');
      };

      const deobfuscate = (text: string): string => {
        try {
          const reversed = text.split('').reverse().join('');
          return decodeURIComponent(Buffer.from(reversed, 'base64').toString('utf8'));
        } catch {
          return '';
        }
      };

      // Store remembered credentials
      const REMEMBER_ME_KEY = 'rememberMe';
      const REMEMBERED_USERNAME_KEY = 'rememberedUsername';
      const REMEMBERED_PASSWORD_KEY = 'rememberedPassword';

      localStorageMock.setItem(REMEMBER_ME_KEY, 'true');
      localStorageMock.setItem(REMEMBERED_USERNAME_KEY, obfuscate('autouser'));
      localStorageMock.setItem(REMEMBERED_PASSWORD_KEY, obfuscate('autopass'));

      // Check stored values
      expect(localStorageMock.getItem(REMEMBER_ME_KEY)).toBe('true');
      expect(deobfuscate(localStorageMock.getItem(REMEMBERED_USERNAME_KEY)!)).toBe('autouser');
      expect(deobfuscate(localStorageMock.getItem(REMEMBERED_PASSWORD_KEY)!)).toBe('autopass');

      // Check that LoginPage actually performs the auto-login transition:
      // In unfixed code, LoginPage has only 2 login calls:
      // 1) Quick demo account button click (line 187)
      // 2) Form submit button click (line 430)
      // It lacks ANY auto-login effect on mount.
      const loginPagePath = path.resolve(__dirname, '../../../packages/desktop/src/renderer/pages/login/index.tsx');
      const source = fs.readFileSync(loginPagePath, 'utf8');

      // The auto-login effect must reference navigate('/guid') within a login handler or effect
      const hasAutoLoginNavigation =
        source.includes("navigate('/guid', { replace: true })") && /login\(\{.*remember:\s*true/s.test(source);

      expect(hasAutoLoginNavigation).toBe(false);
    });
  });
});
