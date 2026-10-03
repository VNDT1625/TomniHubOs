import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  isSupabaseConfigured,
  getSupabaseConfig,
  supabaseSignInWithPassword,
  supabaseSignUp,
  supabaseSignOut,
  supabaseRefreshToken,
  clearSupabaseSession,
  getStoredSupabaseSession,
  supabaseResetPasswordForEmail,
  supabaseResendVerification,
  supabaseVerifyOtp,
  type SupabaseAuthFailure,
  type SupabaseSession,
} from '@/renderer/services/supabaseAuth';

// M6: CSRF removed with legacy webserver — stub functions for compatibility, re-implement in M7
const withCsrfToken = <T extends Record<string, unknown>>(data: T): T => data;
const hasValidCsrfToken = (): boolean => true;
const clearCookie = (_name: string, _path?: string): void => {};
const CSRF_COOKIE_NAME = 'csrf-token';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
}

interface LoginParams {
  username: string;
  password: string;
  remember?: boolean;
}

type LoginErrorCode =
  | 'invalidCredentials'
  | 'tooManyAttempts'
  | 'serverError'
  | 'networkError'
  | 'csrfError'
  | 'unknown';

export type AuthErrorSource = 'supabase' | 'local' | 'network' | 'validation';

export interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
  shouldClearCache?: boolean;
  source?: AuthErrorSource;
  endpoint?: string;
  statusCode?: number;
  rawDetails?: string;
  actionHint?: string;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  isSupabaseConfigured: boolean;
  login: (params: LoginParams) => Promise<LoginResult>;
  register: (params: { username: string; password: string }) => Promise<LoginResult>;
  forgotPassword: (email: string) => Promise<LoginResult>;
  resendVerification: (email: string) => Promise<LoginResult>;
  verifyOtp: (params: { email: string; token: string; type?: 'signup' | 'recovery' }) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearAuthCache: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';
const REMEMBER_ME_KEY = 'rememberMe';
const REMEMBERED_USERNAME_KEY = 'rememberedUsername';
const REMEMBERED_PASSWORD_KEY = 'rememberedPassword';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

// Clear expired auth cache including cookies and localStorage
// 清除过期的认证缓存，包括 Cookie 和 localStorage
function clearAuthCache(): void {
  if (typeof window === 'undefined') return;

  try {
    // Clear CSRF cookie
    clearCookie(CSRF_COOKIE_NAME);
    clearCookie(CSRF_COOKIE_NAME, '/');

    // Clear localStorage auth-related items
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('auth') || key.includes('csrf') || key.includes('token'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(REMEMBER_ME_KEY);
    localStorage.removeItem(REMEMBERED_USERNAME_KEY);
    localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
  } catch (error) {
    console.error('Failed to clear auth cache:', error);
  }
}

async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const response = await fetch(AUTH_USER_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      success: boolean;
      user?: AuthUser;
    };
    if (data.success && data.user) {
      return data.user;
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null;
    }
    console.error('Failed to fetch current user:', error);
  }

  return null;
}

const admitSupabaseSessionToDesktop = async (session: SupabaseSession): Promise<boolean> => {
  if (!isDesktopRuntime) return true;
  const result = await window.electronAPI?.accountSession?.admitSupabaseSession({
    accessToken: session.access_token,
    ...(session.refresh_token ? { refreshToken: session.refresh_token } : {}),
  });
  return result?.ok === true;
};

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const authStateVersionRef = useRef(0);

  const supabaseEnabled = isSupabaseConfigured();

  const refresh = useCallback(async () => {
    const operationVersion = ++authStateVersionRef.current;
    const isCurrentOperation = (): boolean => authStateVersionRef.current === operationVersion;

    if (authStateVersionRef.current !== operationVersion) return;

    if (isSupabaseConfigured()) {
      const storedSupabase = getStoredSupabaseSession();
      if (storedSupabase) {
        const expiresAtMs =
          storedSupabase.expires_at < 1e12 ? storedSupabase.expires_at * 1000 : storedSupabase.expires_at;
        if (expiresAtMs > Date.now()) {
          if (await admitSupabaseSessionToDesktop(storedSupabase)) {
            if (authStateVersionRef.current !== operationVersion) return;
            setUser({
              id: storedSupabase.user.id,
              username: storedSupabase.user.email || storedSupabase.user.id,
            });
            setStatus('authenticated');
            setReady(true);
            return;
          }
          clearSupabaseSession();
        } else if (storedSupabase.refresh_token) {
          const refreshResult = await supabaseRefreshToken(storedSupabase.refresh_token);
          if (authStateVersionRef.current !== operationVersion) return;
          if (refreshResult.success) {
            const authedUser = refreshResult.user || refreshResult.session?.user;
            if (authedUser && refreshResult.session && (await admitSupabaseSessionToDesktop(refreshResult.session))) {
              if (!isCurrentOperation()) return;
              setUser({
                id: authedUser.id,
                username: authedUser.email || authedUser.id,
              });
              setStatus('authenticated');
              setReady(true);
              return;
            }
            clearSupabaseSession();
          } else if ((refreshResult as SupabaseAuthFailure).source === 'supabase') {
            clearSupabaseSession();
          }
        }
      }
    }

    if (isDesktopRuntime) {
      setStatus('checking');
      try {
        const snapshot = await window.electronAPI?.accountSession?.getStatus();
        if (authStateVersionRef.current !== operationVersion) return;
        if (snapshot?.phase === 'authenticated' && snapshot.accountId) {
          setStatus('authenticated');
          setUser({ id: snapshot.accountId, username: snapshot.displayName ?? snapshot.accountId });
        } else {
          setStatus('unauthenticated');
          setUser(null);
        }
      } catch {
        setStatus('unauthenticated');
        setUser(null);
      }
      setReady(true);
      return;
    }

    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('checking');

    const currentUser = await fetchCurrentUser(controller.signal);
    if (authStateVersionRef.current !== operationVersion) return;
    if (currentUser) {
      setUser(currentUser);
      setStatus('authenticated');
    } else {
      setUser(null);
      setStatus('unauthenticated');
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  const login = useCallback(
    async ({ username, password, remember }: LoginParams): Promise<LoginResult> => {
      try {
        // If Supabase is configured and username is an email or Supabase is preferred
        if (isSupabaseConfigured()) {
          const email = username.trim();
          const sbResult = await supabaseSignInWithPassword({ email, password });
          if (!sbResult.success) {
            const failure = sbResult as SupabaseAuthFailure;
            return {
              success: false,
              message: failure.message,
              source: failure.source,
              endpoint: failure.endpoint,
              statusCode: failure.statusCode,
              rawDetails: failure.rawDetails,
              actionHint: failure.actionHint,
              code: 'invalidCredentials',
            };
          }

          if (sbResult.session === undefined || !(await admitSupabaseSessionToDesktop(sbResult.session))) {
            return {
              success: false,
              message: 'Supabase đăng nhập thành công nhưng Core không xác minh được phiên.',
              source: 'supabase',
              code: 'unknown',
            };
          }
          setUser({ id: sbResult.user.id, username: sbResult.user.email });
          setStatus('authenticated');
          setReady(true);
          return { success: true };
        }

        if (isDesktopRuntime) {
          const result = await window.electronAPI?.accountSession?.beginSignIn();
          setReady(true);
          if (result?.started === true) {
            await refresh();
            return { success: true };
          }
          return {
            success: false,
            code: 'unknown',
          };
        }

        // Check CSRF token availability before login
        const csrfTokenValid = hasValidCsrfToken();
        if (!csrfTokenValid) {
          console.warn('CSRF token missing or invalid, clearing cache');
          clearAuthCache();
        }

        const response = await fetch('/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(withCsrfToken({ username, password, remember })),
        });

        const data = (await response.json()) as {
          success: boolean;
          message?: string;
          user?: AuthUser;
        };

        if (!response.ok || !data.success || !data.user) {
          let code: LoginErrorCode = 'unknown';
          let message = data?.message ?? 'Login failed';
          let shouldClearCache = false;

          if (response.status === 401) {
            code = 'invalidCredentials';
          } else if (response.status === 403) {
            code = 'csrfError';
            message = 'Security token expired. Please try again.';
            shouldClearCache = true;
          } else if (response.status === 429) {
            code = 'tooManyAttempts';
          } else if (response.status >= 500) {
            code = 'serverError';
          } else if (!csrfTokenValid) {
            code = 'csrfError';
            message = 'Login failed due to cached data. Please clear your browser cache and try again.';
            shouldClearCache = true;
          }

          if (shouldClearCache) {
            clearAuthCache();
          }

          return {
            success: false,
            message,
            code,
            shouldClearCache,
          };
        }

        setUser(data.user);
        setStatus('authenticated');
        setReady(true);

        const reconnect = (window as Window & { __websocketReconnect?: unknown }).__websocketReconnect;
        if (typeof reconnect === 'function') {
          reconnect();
        }

        return { success: true };
      } catch (error) {
        console.error('Login request failed:', error);

        const errorMessage = (error as Error).message;
        if (errorMessage?.includes('parse') || errorMessage?.includes('csrf') || errorMessage?.includes('cookie')) {
          clearAuthCache();
          return {
            success: false,
            message: 'Login failed due to cached data. Please clear your browser cache and try again.',
            code: 'csrfError',
            shouldClearCache: true,
          };
        }

        return {
          success: false,
          message: 'Network error. Please try again.',
          code: 'networkError',
        };
      }
    },
    [refresh]
  );

  const register = useCallback(
    async ({ username, password }: { username: string; password: string }): Promise<LoginResult> => {
      try {
        if (isSupabaseConfigured()) {
          const trimmed = username.trim();
          if (!trimmed.includes('@')) {
            return {
              success: false,
              message: 'Vui lòng nhập địa chỉ email hợp lệ (ví dụ: yourname@gmail.com) để đăng ký tài khoản Supabase.',
              code: 'unknown',
            };
          }
          const email = trimmed;
          const sbResult = await supabaseSignUp({
            email,
            password,
            username: email.split('@')[0],
          });
          if (!sbResult.success) {
            const failure = sbResult as SupabaseAuthFailure;
            return {
              success: false,
              message: failure.message,
              source: failure.source,
              endpoint: failure.endpoint,
              statusCode: failure.statusCode,
              rawDetails: failure.rawDetails,
              actionHint: failure.actionHint,
              code: 'unknown',
            };
          }

          if (!sbResult.session) {
            return {
              success: false,
              message: 'Tài khoản đã tạo thành công trên Supabase nhưng đang chờ xác nhận email.',
              source: 'supabase',
              endpoint: `${getSupabaseConfig()?.url}/auth/v1/signup`,
              statusCode: 200,
              actionHint:
                'Vui lòng kiểm tra hộp thư để bấm link kích hoạt, hoặc vào Supabase Dashboard -> Authentication -> Providers -> Email và TẮT mục "Confirm email" rồi đăng nhập ngay.',
              rawDetails: JSON.stringify(sbResult.user),
              code: 'unknown',
            };
          }

          if (sbResult.session === undefined || !(await admitSupabaseSessionToDesktop(sbResult.session))) {
            return {
              success: false,
              message: 'Supabase đăng nhập thành công nhưng Core không xác minh được phiên.',
              source: 'supabase',
              code: 'unknown',
            };
          }
          setUser({ id: sbResult.user.id, username: sbResult.user.email });
          setStatus('authenticated');
          setReady(true);
          return { success: true };
        }

        if (isDesktopRuntime) {
          const result = await window.electronAPI?.accountSession?.beginSignIn();
          setReady(true);
          if (result?.started === true) {
            await refresh();
            return { success: true };
          }
          return {
            success: false,
            code: 'unknown',
          };
        }

        const response = await fetch('/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(withCsrfToken({ username, password })),
        });

        const data = (await response.json()) as {
          success: boolean;
          message?: string;
          user?: AuthUser;
        };

        if (!response.ok || !data.success || !data.user) {
          return {
            success: false,
            message: data?.message ?? 'Registration failed',
            code: 'unknown',
          };
        }

        setUser(data.user);
        setStatus('authenticated');
        setReady(true);
        return { success: true };
      } catch (error) {
        console.error('Registration request failed:', error);
        return {
          success: false,
          message: 'Network error. Please try again.',
          code: 'networkError',
        };
      }
    },
    [refresh]
  );

  const forgotPassword = useCallback(async (email: string): Promise<LoginResult> => {
    if (!isSupabaseConfigured()) {
      return { success: false, message: 'Supabase chưa được cấu hình.', code: 'unknown' };
    }
    const result = await supabaseResetPasswordForEmail(email);
    if (!result.success) {
      const failure = result as SupabaseAuthFailure;
      return {
        success: false,
        message: failure.message,
        source: failure.source,
        endpoint: failure.endpoint,
        statusCode: failure.statusCode,
        rawDetails: failure.rawDetails,
        actionHint: failure.actionHint,
        code: 'unknown',
      };
    }
    return { success: true, message: 'Đã gửi hướng dẫn khôi phục mật khẩu vào hộp thư của bạn.' };
  }, []);

  const resendVerification = useCallback(async (email: string): Promise<LoginResult> => {
    if (!isSupabaseConfigured()) {
      return { success: false, message: 'Supabase chưa được cấu hình.', code: 'unknown' };
    }
    const result = await supabaseResendVerification(email);
    if (!result.success) {
      const failure = result as SupabaseAuthFailure;
      return {
        success: false,
        message: failure.message,
        source: failure.source,
        endpoint: failure.endpoint,
        statusCode: failure.statusCode,
        rawDetails: failure.rawDetails,
        actionHint: failure.actionHint,
        code: 'unknown',
      };
    }
    return { success: true, message: 'Đã gửi lại email xác nhận. Vui lòng kiểm tra hòm thư của bạn.' };
  }, []);

  const verifyOtp = useCallback(
    async (params: { email: string; token: string; type?: 'signup' | 'recovery' }): Promise<LoginResult> => {
      if (!isSupabaseConfigured()) {
        return { success: false, message: 'Supabase chưa được cấu hình.', code: 'unknown' };
      }
      const result = await supabaseVerifyOtp(params);
      if (!result.success) {
        const failure = result as SupabaseAuthFailure;
        return {
          success: false,
          message: failure.message,
          source: failure.source,
          endpoint: failure.endpoint,
          statusCode: failure.statusCode,
          rawDetails: failure.rawDetails,
          actionHint: failure.actionHint,
          code: 'unknown',
        };
      }
      if (result.user && result.session) {
        if (!(await admitSupabaseSessionToDesktop(result.session))) {
          return {
            success: false,
            message: 'Supabase xác thực thành công nhưng Core không xác minh được phiên.',
            source: 'supabase',
            code: 'unknown',
          };
        }
        setUser({ id: result.user.id, username: result.user.email });
        setStatus('authenticated');
        setReady(true);
      }
      return { success: true, message: 'Xác thực tài khoản thành công!' };
    },
    []
  );

  const logout = useCallback(async () => {
    ++authStateVersionRef.current;
    setUser(null);
    setStatus('unauthenticated');
    setReady(true);

    if (isSupabaseConfigured()) {
      await supabaseSignOut();
    }

    if (isDesktopRuntime) {
      await window.electronAPI?.accountSession?.signOut();
      clearAuthCache();
      return;
    }

    try {
      await fetch('/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(withCsrfToken({})),
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      setUser(null);
      setStatus('unauthenticated');
      clearAuthCache();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      isSupabaseConfigured: supabaseEnabled,
      login,
      register,
      forgotPassword,
      resendVerification,
      verifyOtp,
      logout,
      refresh,
      clearAuthCache,
    }),
    [
      login,
      register,
      forgotPassword,
      resendVerification,
      verifyOtp,
      logout,
      ready,
      refresh,
      status,
      supabaseEnabled,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
