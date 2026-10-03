import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  ACCOUNT_SESSION_NATIVE_CHANNELS,
  type AccountDiagnosticsConsentNativeResult,
  type AccountSessionNativeSignInResult,
  type AccountSessionNativeSupabaseSession,
  type AccountSessionNativeSupabaseSessionResult,
} from '@/common/types/platform/electron';
import type { AccountSessionService } from './accountSessionService';

export type AccountAuthBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  accountSession: AccountSessionService;
  verifySender(event: IpcMainInvokeEvent): boolean;
  /** Main-owned, device-local telemetry preference. The renderer cannot supply account identity. */
  diagnosticsConsent: Readonly<{
    get: () => boolean;
    set: (granted: boolean) => void;
  }>;
  /** Main-only OIDC composition. Until configured, sign-in must fail closed. */
  beginSignIn?: () => Promise<AccountSessionNativeSignInResult>;
  /** Main verifies the short-lived Supabase token against its configured project before persistence. */
  admitSupabaseSession?: (
    session: AccountSessionNativeSupabaseSession
  ) => Promise<AccountSessionNativeSupabaseSessionResult>;
}>;

const unavailable: AccountSessionNativeSignInResult = Object.freeze({
  started: false,
  code: 'ACCOUNT_SIGN_IN_NOT_CONFIGURED',
});

const parseDiagnosticsConsentRequest = (value: unknown): boolean | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && Object.hasOwn(record, 'granted') && typeof record.granted === 'boolean'
    ? record.granted
    : undefined;
};

const parseSupabaseSession = (value: unknown): AccountSessionNativeSupabaseSession | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const accessToken = typeof record.accessToken === 'string' ? record.accessToken : '';
  const refreshToken = typeof record.refreshToken === 'string' ? record.refreshToken : undefined;
  if (
    Object.keys(record).some((key) => key !== 'accessToken' && key !== 'refreshToken') ||
    accessToken.length === 0 ||
    accessToken.length > 32_768 ||
    (refreshToken !== undefined && (refreshToken.length === 0 || refreshToken.length > 32_768))
  ) {
    return undefined;
  }
  return refreshToken === undefined ? { accessToken } : { accessToken, refreshToken };
};

/**
 * Narrow account IPC. No renderer payload can supply an account ID, issuer,
 * token, or publisher identity. Diagnostics consent additionally requires a
 * currently online-validated account; all handlers require the trusted top-level UI.
 */
export const registerAccountAuthBridge = (options: AccountAuthBridgeOptions): (() => void) => {
  const requireTrustedSender = (event: IpcMainInvokeEvent): void => {
    if (!options.verifySender(event)) throw new Error('ACCOUNT_SESSION_SENDER_UNTRUSTED');
  };
  const diagnosticsUnauthorized = (event: IpcMainInvokeEvent): AccountDiagnosticsConsentNativeResult =>
    options.verifySender(event)
      ? { ok: false, code: 'ACCOUNT_DIAGNOSTICS_CONSENT_ACCOUNT_REQUIRED' }
      : { ok: false, code: 'ACCOUNT_DIAGNOSTICS_CONSENT_SENDER_UNTRUSTED' };
  const hasTrustedOnlineSession = (event: IpcMainInvokeEvent): boolean => {
    if (!options.verifySender(event)) return false;
    try {
      options.accountSession.requireOnlineSession();
      return true;
    } catch {
      return false;
    }
  };

  options.ipcMain.handle(ACCOUNT_SESSION_NATIVE_CHANNELS.getStatus, async (event) => {
    requireTrustedSender(event);
    return options.accountSession.restore();
  });
  options.ipcMain.handle(ACCOUNT_SESSION_NATIVE_CHANNELS.beginSignIn, async (event) => {
    requireTrustedSender(event);
    return options.beginSignIn === undefined ? unavailable : options.beginSignIn();
  });
  options.ipcMain.handle(ACCOUNT_SESSION_NATIVE_CHANNELS.admitSupabaseSession, async (event, raw: unknown) => {
    requireTrustedSender(event);
    if (options.admitSupabaseSession === undefined) {
      return { ok: false, code: 'ACCOUNT_SUPABASE_NOT_CONFIGURED', message: 'Supabase account is not configured.' };
    }
    const session = parseSupabaseSession(raw);
    if (session === undefined) {
      return { ok: false, code: 'ACCOUNT_SUPABASE_SESSION_INVALID', message: 'Supabase session is invalid.' };
    }
    try {
      return await options.admitSupabaseSession(session);
    } catch {
      return {
        ok: false,
        code: 'ACCOUNT_SUPABASE_SESSION_INVALID',
        message: 'Supabase session could not be verified.',
      };
    }
  });
  options.ipcMain.handle(ACCOUNT_SESSION_NATIVE_CHANNELS.signOut, async (event) => {
    requireTrustedSender(event);
    await options.accountSession.signOut();
  });
  options.ipcMain.handle(
    ACCOUNT_SESSION_NATIVE_CHANNELS.getDiagnosticsConsent,
    async (event): Promise<AccountDiagnosticsConsentNativeResult> => {
      if (!hasTrustedOnlineSession(event)) return diagnosticsUnauthorized(event);
      try {
        return { ok: true, granted: options.diagnosticsConsent.get() };
      } catch {
        return { ok: false, code: 'ACCOUNT_DIAGNOSTICS_CONSENT_UNAVAILABLE' };
      }
    }
  );
  options.ipcMain.handle(
    ACCOUNT_SESSION_NATIVE_CHANNELS.setDiagnosticsConsent,
    async (event, raw: unknown): Promise<AccountDiagnosticsConsentNativeResult> => {
      if (!hasTrustedOnlineSession(event)) return diagnosticsUnauthorized(event);
      const granted = parseDiagnosticsConsentRequest(raw);
      if (granted === undefined) return { ok: false, code: 'ACCOUNT_DIAGNOSTICS_CONSENT_REQUEST_INVALID' };
      try {
        options.diagnosticsConsent.set(granted);
        return { ok: true, granted };
      } catch {
        return { ok: false, code: 'ACCOUNT_DIAGNOSTICS_CONSENT_UNAVAILABLE' };
      }
    }
  );

  return () => {
    options.ipcMain.removeHandler(ACCOUNT_SESSION_NATIVE_CHANNELS.getStatus);
    options.ipcMain.removeHandler(ACCOUNT_SESSION_NATIVE_CHANNELS.beginSignIn);
    options.ipcMain.removeHandler(ACCOUNT_SESSION_NATIVE_CHANNELS.admitSupabaseSession);
    options.ipcMain.removeHandler(ACCOUNT_SESSION_NATIVE_CHANNELS.signOut);
    options.ipcMain.removeHandler(ACCOUNT_SESSION_NATIVE_CHANNELS.getDiagnosticsConsent);
    options.ipcMain.removeHandler(ACCOUNT_SESSION_NATIVE_CHANNELS.setDiagnosticsConsent);
  };
};
