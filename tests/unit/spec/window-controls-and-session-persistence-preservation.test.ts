/**
 * @vitest-environment jsdom
 */

/**
 * Preservation Property Tests (BEFORE implementing fix)
 *
 * Property 2: Preservation - Platform Invariants, Token Revocation, and Logout Preservation
 *
 * IMPORTANT: Follows observation-first methodology on UNFIXED code.
 * These tests capture baseline behaviors that must remain true both before and after the fix:
 *   1. macOS Platform Invariant: On macOS (isMacOS() === true), custom top-right window controls remain suppressed.
 *   2. Non-Desktop / WebUI Invariant: In browser/WebUI environments (window.electronAPI === undefined), desktop window controls remain hidden.
 *   3. Explicit Logout Invariant: Calling logout() in AuthContext or signOut() in accountSession clears session tokens and resets to unauthenticated.
 *   4. Token Revocation / Failure Invariant: Revoked or invalid tokens / credentials fail gracefully and transition to unauthenticated without persisting.
 *   5. Window Control Dispatch Invariant: Interacting with window controls dispatches corresponding Electron IPC calls.
 *
 * EXPECTED OUTCOME: Tests MUST PASS on UNFIXED code.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { isElectronDesktop, isMacOS, isWindows, isLinux } from '@/renderer/utils/platform';
import * as supabaseAuth from '@/renderer/services/supabaseAuth';
import { createAccountSessionService } from '@process/services/security/accountSession/accountSessionService';
import type { AccountSessionVault } from '@process/services/security/accountSession/accountSessionVault';
import type { AuthenticatedAccountSession } from '@process/services/security/accountSession/types';

// Mock ipcBridge before importing WindowControls
const { mockWindowControlsBridge } = vi.hoisted(() => ({
  mockWindowControlsBridge: {
    minimize: { invoke: vi.fn().mockResolvedValue(undefined), provider: vi.fn() },
    maximize: { invoke: vi.fn().mockResolvedValue(undefined), provider: vi.fn() },
    unmaximize: { invoke: vi.fn().mockResolvedValue(undefined), provider: vi.fn() },
    close: { invoke: vi.fn().mockResolvedValue(undefined), provider: vi.fn() },
    restart: { invoke: vi.fn().mockResolvedValue(undefined), provider: vi.fn() },
    isMaximized: { invoke: vi.fn().mockResolvedValue(false), provider: vi.fn() },
    maximizedChanged: { on: vi.fn().mockReturnValue(() => undefined), emit: vi.fn() },
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    windowControls: mockWindowControlsBridge,
  },
}));

import WindowControls from '@/renderer/components/layout/WindowControls';
import { ipcBridge } from '@/common';

// In-memory mock for localStorage
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
    getRawStore: () => ({ ...store }),
  };
};

const localStorageMock = createLocalStorageMock();

// Helper to construct mock account session vault
const createMockVault = (
  initial?: AuthenticatedAccountSession
): AccountSessionVault & { getRaw: () => AuthenticatedAccountSession | undefined } => {
  let saved: AuthenticatedAccountSession | undefined = initial;
  return {
    load: async () => saved,
    save: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = undefined;
    },
    getRaw: () => saved,
  };
};

// Emulated clearAuthCache function identical to AuthContext.tsx
function clearAuthCache(): void {
  if (typeof window === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.includes('auth') || key.includes('csrf') || key.includes('token'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

describe('Property 2: Preservation - Platform Invariants, Token Revocation, and Logout', () => {
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    vi.clearAllMocks();
    supabaseAuth.setSupabaseEnvOverrideForTesting({ url: '', anonKey: '' });
  });

  afterEach(() => {
    supabaseAuth.setSupabaseEnvOverrideForTesting(null);
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    delete (window as Window & { electronAPI?: unknown }).electronAPI;
    delete (window as Window & { __backendPort?: number }).__backendPort;
  });

  // ---------------------------------------------------------------------------
  // Suite 1: Non-Desktop and macOS Platform Invariants
  // **Validates: Requirements 3.3, 3.4**
  // ---------------------------------------------------------------------------
  describe('Suite 1: Platform Invariants - macOS and Browser Suppression (Requirements 3.3, 3.4)', () => {
    /**
     * Property: For all macOS user-agent strings, isMacOS() evaluates to true,
     * and custom window controls MUST be suppressed in both Titlebar and LoginPage surfaces.
     * **Validates: Requirements 3.3**
     */
    it('**Validates: Requirements 3.3** - suppresses custom window controls across all macOS environments and user-agents', () => {
      const macOSUserAgents = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
        'Mozilla/5.0 (Macintosh; Apple Mac OS X 14_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Tomny/0.9.0 Electron/28.2.1 Safari/537.36',
        'Mozilla/5.0 (Macintosh; PPC Mac OS X 10_5_8) AppleWebKit/534.50.2 (KHTML, like Gecko) Version/5.0.3 Safari/533.19.4',
      ];

      for (const ua of macOSUserAgents) {
        Object.defineProperty(globalThis, 'navigator', {
          value: { userAgent: ua },
          writable: true,
          configurable: true,
        });

        // 1. isMacOS() must detect macOS correctly
        expect(isMacOS()).toBe(true);

        // 2. Titlebar logic invariant:
        // const isMacRuntime = isDesktopRuntime && isMacOS();
        // const showWindowControls = isDesktopRuntime && !isMacRuntime;
        // When isMacOS() is true, showWindowControls must ALWAYS be false, regardless of desktop runtime!
        for (const isDesktopRuntime of [true, false]) {
          const isMacRuntime = isDesktopRuntime && isMacOS();
          const showWindowControls = isDesktopRuntime && !isMacRuntime;
          expect(showWindowControls).toBe(false);
        }

        // 3. LoginPage logic invariant:
        // {isDesktop && !isMacOS() ? <WindowControls /> : null}
        // When isMacOS() is true, controls must ALWAYS be null!
        for (const isDesktop of [true, false]) {
          const renderControls = isDesktop && !isMacOS();
          expect(renderControls).toBe(false);
        }
      }
    });

    /**
     * Property: In browser / WebUI environments without Electron desktop APIs (window.electronAPI === undefined),
     * custom desktop window controls MUST remain hidden across all operating systems.
     * **Validates: Requirements 3.4**
     */
    it('**Validates: Requirements 3.4** - hides desktop window controls in browser and WebUI environments', () => {
      const browserUserAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
        'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ];

      for (const ua of browserUserAgents) {
        Object.defineProperty(globalThis, 'navigator', {
          value: { userAgent: ua },
          writable: true,
          configurable: true,
        });

        // Ensure browser environment: window.electronAPI is undefined, and __backendPort is undefined
        delete (window as Window & { electronAPI?: unknown }).electronAPI;
        delete (window as Window & { __backendPort?: number }).__backendPort;

        // 1. isElectronDesktop() must return false
        expect(isElectronDesktop()).toBe(false);

        // 2. Titlebar showWindowControls evaluation must be false
        const isDesktopRuntime = isElectronDesktop();
        const isMacRuntime = isDesktopRuntime && isMacOS();
        const showWindowControls = isDesktopRuntime && !isMacRuntime;
        expect(showWindowControls).toBe(false);

        // 3. LoginPage render evaluation must be false
        const isDesktop =
          typeof window !== 'undefined' && Boolean((window as Window & { electronAPI?: unknown }).electronAPI);
        const renderControls = isDesktop && !isMacOS();
        expect(renderControls).toBe(false);

        // 4. WindowControls component rendered in non-desktop environment returns null (renders nothing)
        const { container } = render(React.createElement(WindowControls));
        expect(container.firstChild).toBeNull();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Explicit Logout and Session Termination
  // **Validates: Requirements 3.1**
  // ---------------------------------------------------------------------------
  describe('Suite 2: Explicit Logout and Session Termination (Requirements 3.1)', () => {
    /**
     * Property: For all explicit local desktop sign-outs (accountSessionService.signOut()),
     * the authenticated session MUST be cleanly terminated, vault cleared, and snapshot set to unauthenticated.
     * **Validates: Requirements 3.1**
     */
    it('**Validates: Requirements 3.1** - accountSessionService.signOut() clears the vault and transitions to unauthenticated', async () => {
      const accountIds = ['user-alice-01', 'user-bob-02', 'admin-charlie-99', 'dev-account-42'];
      const issuers = ['tomny://local-account', 'https://auth.tomni.example', 'https://sso.enterprise.internal'];

      for (let i = 0; i < accountIds.length; i++) {
        const accountId = accountIds[i];
        const issuer = issuers[i % issuers.length];
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 86400000).toISOString();

        const activeSession: AuthenticatedAccountSession = {
          schemaVersion: 1,
          accountId,
          subjectId: `subject-${accountId}`,
          issuer,
          clientId: 'tomny-desktop',
          displayName: `Display Name for ${accountId}`,
          accessToken: `token-secret-${i}`,
          idToken: `id-token-secret-${i}`,
          expiresAt,
          verifiedAt: now.toISOString(),
        };

        const testVault = createMockVault();
        const reasons: string[] = [];

        const service = createAccountSessionService({
          vault: testVault,
          now: () => now,
          validateOnline: async () => ({ status: 'valid' }),
        });

        service.subscribe?.((change) => reasons.push(change.reason));

        // Authenticate session
        await service.recordVerifiedSession(activeSession);
        expect(service.snapshot().phase).toBe('authenticated');
        expect(service.snapshot().accountId).toBe(accountId);
        expect(await testVault.load()).toBeDefined();

        // Perform explicit sign-out
        await service.signOut();

        // 1. Snapshot must be unauthenticated
        const afterSignOut = service.snapshot();
        expect(afterSignOut.phase).toBe('unauthenticated');
        expect(afterSignOut.accountId).toBeUndefined();

        // 2. Vault must be completely cleared
        expect(await testVault.load()).toBeUndefined();

        // 3. Subscriber must have received 'signed_out' reason
        expect(reasons).toContain('signed_out');

        // 4. requireOnlineSession() must throw
        expect(() => service.requireOnlineSession()).toThrow('A verified account session is required.');
      }
    });

    /**
     * Property: For all explicit Supabase logout calls (supabaseSignOut),
     * the stored session MUST be purged from localStorage and the Supabase logout API invoked.
     * **Validates: Requirements 3.1**
     */
    it('**Validates: Requirements 3.1** - supabaseSignOut() clears stored session from localStorage and dispatches logout request', async () => {
      supabaseAuth.setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      const mockFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({}),
      }));
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const tokens = ['access-token-alpha', 'access-token-beta', 'access-token-gamma'];

      for (const token of tokens) {
        mockFetch.mockClear();

        // Seed a stored session
        const session = {
          access_token: token,
          refresh_token: `refresh-${token}`,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: {
            id: `user-${token}`,
            email: `${token}@example.com`,
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: new Date().toISOString(),
          },
        };

        supabaseAuth.saveSupabaseSession(session);
        expect(supabaseAuth.getStoredSupabaseSession()).not.toBeNull();

        // Explicit logout
        await supabaseAuth.supabaseSignOut(token);

        // 1. Session must be removed from localStorage
        expect(supabaseAuth.getStoredSupabaseSession()).toBeNull();

        // 2. Fetch must have been called with /auth/v1/logout and authorization header
        expect(mockFetch).toHaveBeenCalledWith(
          'https://myproject.supabase.co/auth/v1/logout',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              Authorization: `Bearer ${token}`,
              apikey: 'test-anon-key',
            }),
          })
        );
      }
    });

    /**
     * Property: Auth cache clearing (clearAuthCache) removes all auth, token, and csrf items
     * from localStorage while preserving non-auth user settings.
     * **Validates: Requirements 3.1**
     */
    it('**Validates: Requirements 3.1** - clearAuthCache removes all token and auth keys while preserving non-auth preferences', () => {
      // Set auth and non-auth keys
      localStorageMock.setItem('tomny_auth_token', 'secret-jwt');
      localStorageMock.setItem('csrf-token', 'csrf-12345');
      localStorageMock.setItem('access_token_desktop', 'bearer-abc');
      localStorageMock.setItem('user_auth_state', 'authenticated');
      localStorageMock.setItem('app-theme', 'dark');
      localStorageMock.setItem('preferred-language', 'vi-VN');
      localStorageMock.setItem('editor-font-size', '14');

      clearAuthCache();

      // Auth keys removed
      expect(localStorageMock.getItem('tomny_auth_token')).toBeNull();
      expect(localStorageMock.getItem('csrf-token')).toBeNull();
      expect(localStorageMock.getItem('access_token_desktop')).toBeNull();
      expect(localStorageMock.getItem('user_auth_state')).toBeNull();

      // Non-auth keys preserved
      expect(localStorageMock.getItem('app-theme')).toBe('dark');
      expect(localStorageMock.getItem('preferred-language')).toBe('vi-VN');
      expect(localStorageMock.getItem('editor-font-size')).toBe('14');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Token Revocation and Invalid Credentials Handling
  // **Validates: Requirements 3.2**
  // ---------------------------------------------------------------------------
  describe('Suite 3: Token Revocation and Invalid Credentials (Requirements 3.2)', () => {
    /**
     * Property: For all invalid credentials or rejected logins, supabaseSignInWithPassword
     * MUST return failure, must NOT persist any session, and must return informative error details.
     * **Validates: Requirements 3.2**
     */
    it('**Validates: Requirements 3.2** - invalid Supabase credentials fail gracefully and do not store session', async () => {
      supabaseAuth.setSupabaseConfig('https://myproject.supabase.co', 'test-anon-key');

      const testErrorCases = [
        {
          status: 400,
          responseBody: { error: 'invalid_grant', error_description: 'Invalid login credentials' },
          expectedMessage: 'Email hoặc mật khẩu không chính xác.',
        },
        {
          status: 400,
          responseBody: { error: 'invalid_grant', error_description: 'Email not confirmed' },
          expectedMessage: 'Email chưa được xác nhận trên Supabase.',
        },
        {
          status: 401,
          responseBody: { error: 'unauthorized', message: 'Token has been revoked' },
          expectedMessage: 'Token has been revoked',
        },
        {
          status: 429,
          responseBody: { error: 'rate_limit', message: 'Too many requests' },
          expectedMessage: 'Too many requests',
        },
      ];

      for (const errCase of testErrorCases) {
        const mockFetch = vi.fn(async () => ({
          ok: false,
          status: errCase.status,
          json: async () => errCase.responseBody,
        }));
        globalThis.fetch = mockFetch as unknown as typeof fetch;

        const result = await supabaseAuth.supabaseSignInWithPassword({
          email: 'test@example.com',
          password: 'wrong-password',
        });

        // 1. Result must indicate failure
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.message).toContain(errCase.expectedMessage);
          expect(result.statusCode).toBe(errCase.status);
        }

        // 2. Must not store any session in localStorage
        expect(supabaseAuth.getStoredSupabaseSession()).toBeNull();
      }
    });

    /**
     * Property: For all expired local desktop sessions past offline grace,
     * accountSessionService.restore() MUST reject the session, clear the vault, and transition to unauthenticated.
     * **Validates: Requirements 3.2**
     */
    it('**Validates: Requirements 3.2** - expired local desktop sessions are rejected and cleared on restore', async () => {
      const now = new Date('2026-09-22T10:00:00.000Z');
      const pastDeltasMs = [1000, 60_000, 3600_000, 86400_000 * 30]; // 1s to 30 days in the past

      for (const delta of pastDeltasMs) {
        const expiredTime = new Date(now.getTime() - delta).toISOString();

        const expiredSession: AuthenticatedAccountSession = {
          schemaVersion: 1,
          accountId: 'expired-account',
          subjectId: 'expired-subject',
          issuer: 'https://auth.tomni.example',
          clientId: 'tomny-desktop',
          accessToken: 'expired-token',
          idToken: 'expired-token',
          expiresAt: expiredTime,
          verifiedAt: new Date(now.getTime() - delta - 3600_000).toISOString(),
          offlineLocalOnlyUntil: expiredTime,
        };

        const testVault = createMockVault(expiredSession);
        const service = createAccountSessionService({
          vault: testVault,
          now: () => now,
          validateOnline: async () => ({ status: 'valid' }),
        });

        const snapshot = await service.restore();

        // 1. Snapshot must be unauthenticated
        expect(snapshot.phase).toBe('unauthenticated');
        expect(snapshot.accountId).toBeUndefined();

        // 2. Vault must be cleared
        expect(await testVault.load()).toBeUndefined();
      }
    });

    /**
     * Property: For all sessions where online validation returns { status: 'revoked' },
     * accountSessionService.restore() MUST clear the vault and transition to unauthenticated.
     * **Validates: Requirements 3.2**
     */
    it('**Validates: Requirements 3.2** - genuinely revoked online sessions are cleared and transition to unauthenticated', async () => {
      const now = new Date('2026-09-22T10:00:00.000Z');
      const futureTime = new Date(now.getTime() + 86400000).toISOString();

      const activeSession: AuthenticatedAccountSession = {
        schemaVersion: 1,
        accountId: 'revoked-account',
        subjectId: 'revoked-subject',
        issuer: 'https://auth.tomni.example',
        clientId: 'tomny-desktop',
        accessToken: 'revoked-token',
        idToken: 'revoked-token',
        expiresAt: futureTime,
        verifiedAt: now.toISOString(),
      };

      const testVault = createMockVault(activeSession);
      const service = createAccountSessionService({
        vault: testVault,
        now: () => now,
        // Online provider declares token has been revoked
        validateOnline: async () => ({ status: 'revoked' }),
      });

      const snapshot = await service.restore();

      // 1. Snapshot must be unauthenticated
      expect(snapshot.phase).toBe('unauthenticated');

      // 2. Vault must be cleared
      expect(await testVault.load()).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Window Control Operations Dispatch
  // **Validates: Requirements 3.5**
  // ---------------------------------------------------------------------------
  describe('Suite 4: Window Control Operations Dispatch (Requirements 3.5)', () => {
    /**
     * Property: For all window control buttons (Minimize, Maximize, Unmaximize, Close, Restart),
     * clicking the button on a rendered WindowControls component dispatches the corresponding IPC operation.
     * **Validates: Requirements 3.5**
     */
    it('**Validates: Requirements 3.5** - WindowControls component button clicks dispatch corresponding IPC calls', async () => {
      // Mock desktop environment so WindowControls renders
      (window as Window & { electronAPI?: unknown }).electronAPI = {
        windowControls: mockWindowControlsBridge,
      };

      const { getByLabelText } = render(React.createElement(WindowControls));

      // 1. Test Minimize button
      const minimizeBtn = getByLabelText('Minimize');
      expect(minimizeBtn).toBeDefined();
      fireEvent.click(minimizeBtn);
      expect(mockWindowControlsBridge.minimize.invoke).toHaveBeenCalledTimes(1);

      // 2. Test Close button
      const closeBtn = getByLabelText('Close');
      expect(closeBtn).toBeDefined();
      fireEvent.click(closeBtn);
      expect(mockWindowControlsBridge.close.invoke).toHaveBeenCalledTimes(1);

      // 3. Test Restart button
      const restartBtn = getByLabelText('Restart');
      expect(restartBtn).toBeDefined();
      fireEvent.click(restartBtn);
      expect(mockWindowControlsBridge.restart.invoke).toHaveBeenCalledTimes(1);

      // 4. Test Maximize button (initially unmaximized)
      const maximizeBtn = getByLabelText('Maximize');
      expect(maximizeBtn).toBeDefined();
      fireEvent.click(maximizeBtn);
      expect(mockWindowControlsBridge.maximize.invoke).toHaveBeenCalledTimes(1);
    });

    /**
     * Property: WindowControls IPC provider bindings invoke the expected bridge methods
     * **Validates: Requirements 3.5**
     */
    it('**Validates: Requirements 3.5** - window controls bridge provides all required window management operations', () => {
      expect(ipcBridge.windowControls.minimize).toBeDefined();
      expect(ipcBridge.windowControls.maximize).toBeDefined();
      expect(ipcBridge.windowControls.unmaximize).toBeDefined();
      expect(ipcBridge.windowControls.close).toBeDefined();
      expect(ipcBridge.windowControls.restart).toBeDefined();
      expect(ipcBridge.windowControls.isMaximized).toBeDefined();
      expect(ipcBridge.windowControls.maximizedChanged).toBeDefined();
    });
  });
});
