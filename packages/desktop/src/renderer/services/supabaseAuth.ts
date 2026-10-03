/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

export type SupabaseUser = Readonly<{
  id: string;
  email: string;
  user_metadata?: Readonly<Record<string, unknown>>;
  created_at?: string;
}>;

export type SupabaseSession = Readonly<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: SupabaseUser;
}>;

export type SupabaseAuthSuccess = Readonly<{
  success: true;
  session?: SupabaseSession;
  user: SupabaseUser;
}>;

export type AuthErrorSource = 'supabase' | 'local' | 'network' | 'validation';

export type SupabaseAuthFailure = Readonly<{
  success: false;
  message: string;
  code?: string;
  source?: AuthErrorSource;
  endpoint?: string;
  statusCode?: number;
  rawDetails?: string;
  actionHint?: string;
}>;

export type SupabaseAuthResult = SupabaseAuthSuccess | SupabaseAuthFailure;

export type TomProfile = Readonly<{
  id: string;
  email: string;
  username?: string;
  full_name?: string;
  company_name?: string;
  tier?: 'free' | 'pro' | 'enterprise';
  role?: 'member' | 'manager' | 'admin';
  balance_tom: number;
  currency: string;
}>;

export type TomTransaction = Readonly<{
  id: string;
  user_id: string;
  amount: number;
  type: 'bonus' | 'spend' | 'topup' | 'redeem';
  description: string;
  balance_after: number;
  created_at: string;
}>;

const STORAGE_URL_KEY = 'tomni_supabase_url';
const STORAGE_ANON_KEY = 'tomni_supabase_anon_key';
const STORAGE_SESSION_KEY = 'tomni_supabase_session';
const LOCAL_TRANSACTIONS_PREFIX = 'tomni_local_tx_';

let envOverride: { url?: string; anonKey?: string } | null = null;

export const setSupabaseEnvOverrideForTesting = (override: { url?: string; anonKey?: string } | null): void => {
  envOverride = override;
};

const getStorage = (): Storage | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
};

export const getSupabaseConfig = (): { url: string; anonKey: string } | null => {
  const storage = getStorage();

  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
  const envUrl =
    envOverride?.url !== undefined ? envOverride.url : env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const envKey =
    envOverride?.anonKey !== undefined
      ? envOverride.anonKey
      : env.VITE_SUPABASE_ANON_KEY ||
        env.VITE_SUPABASE_PUBLISHABLE_KEY ||
        env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const storedUrl = storage?.getItem(STORAGE_URL_KEY);
  const storedKey = storage?.getItem(STORAGE_ANON_KEY);

  const url = (envUrl || storedUrl || '').trim();
  const anonKey = (envKey || storedKey || '').trim();

  if (!url || !anonKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { url: url.replace(/\/+$/u, ''), anonKey };
  } catch {
    return null;
  }
};

export const isSupabaseConfigured = (): boolean => getSupabaseConfig() !== null;

export const setSupabaseConfig = (url: string, anonKey: string): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_URL_KEY, url.trim());
  storage.setItem(STORAGE_ANON_KEY, anonKey.trim());
};

export const clearSupabaseConfig = (): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(STORAGE_URL_KEY);
  storage.removeItem(STORAGE_ANON_KEY);
  storage.removeItem(STORAGE_SESSION_KEY);
};

export const normalizeExpiresAtMs = (rawExpiresAt?: number, rawExpiresIn?: number): number => {
  if (typeof rawExpiresAt === 'number' && rawExpiresAt > 0) {
    return rawExpiresAt < 1e12 ? rawExpiresAt * 1000 : rawExpiresAt;
  }
  if (typeof rawExpiresIn === 'number' && rawExpiresIn > 0) {
    return Date.now() + rawExpiresIn * 1000;
  }
  return Date.now() + 3600 * 1000;
};

export const getStoredSupabaseSession = (): SupabaseSession | null => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SupabaseSession;
    if (session && typeof session.expires_at === 'number') {
      return {
        ...session,
        expires_at: normalizeExpiresAtMs(session.expires_at),
      };
    }
    return session;
  } catch {
    return null;
  }
};

export const saveSupabaseSession = (session: SupabaseSession): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
};

export const clearSupabaseSession = (): void => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(STORAGE_SESSION_KEY);
};

export const supabaseSignUp = async (params: {
  email: string;
  password: string;
  username?: string;
  fullName?: string;
  companyName?: string;
}): Promise<SupabaseAuthResult> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase is not configured' };
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({
        email: params.email.trim(),
        password: params.password,
        data: {
          username: params.username?.trim() || params.email.trim().split('@')[0],
          full_name: params.fullName?.trim() || '',
          company_name: params.companyName?.trim() || '',
        },
      }),
    });

    const rawData = (await response.json()) as Record<string, unknown>;

    const user: SupabaseUser | undefined =
      (rawData.user as SupabaseUser | undefined) ||
      (rawData.id && typeof rawData.id === 'string'
        ? ({
            id: rawData.id as string,
            email: (rawData.email as string) || params.email.trim(),
            user_metadata: (rawData.user_metadata as Record<string, unknown>) || {},
            app_metadata: (rawData.app_metadata as Record<string, unknown>) || {},
            created_at: (rawData.created_at as string) || new Date().toISOString(),
          } as SupabaseUser)
        : undefined);

    if (!response.ok || !user) {
      const rawMsg =
        (rawData.error_description as string) || (rawData.msg as string) || (rawData.message as string) || '';
      let errorMsg = rawMsg || 'Đăng ký tài khoản không thành công.';
      let actionHint = 'Vui lòng kiểm tra lại thông tin và thử lại.';

      if (rawMsg.includes('email rate limit') || rawMsg.includes('over_email_send_rate_limit')) {
        errorMsg = 'Đã vượt quá giới hạn gửi email của Supabase (Email Rate Limit).';
        actionHint =
          'Vào Supabase Dashboard -> Authentication -> Providers -> Email và TẮT mục "Confirm email" để tạo tài khoản ngay lập tức.';
      } else if (rawMsg.includes('User already registered')) {
        errorMsg = 'Email này đã được đăng ký tài khoản trên Supabase.';
        actionHint = 'Vui lòng chuyển sang tab "Đăng nhập" hoặc sử dụng một địa chỉ email khác.';
      } else if (rawMsg.includes('Email address is invalid') || rawMsg.includes('invalid email')) {
        errorMsg = 'Địa chỉ email không hợp lệ hoặc tên miền không tồn tại.';
        actionHint = 'Vui lòng nhập đúng định dạng email thực tế (ví dụ: name@gmail.com).';
      } else if (rawMsg.includes('Password should be at least')) {
        errorMsg = 'Mật khẩu quá ngắn.';
        actionHint = 'Supabase yêu cầu mật khẩu có tối thiểu 6 ký tự.';
      }

      return {
        success: false,
        message: errorMsg,
        code: (rawData.code as string) || (rawData.error_code as string) || String(response.status),
        source: 'supabase',
        endpoint: `${config.url}/auth/v1/signup`,
        statusCode: response.status,
        rawDetails: JSON.stringify(rawData),
        actionHint,
      };
    }

    const accessToken = typeof rawData.access_token === 'string' ? rawData.access_token : undefined;
    const session: SupabaseSession | undefined = accessToken
      ? {
          access_token: accessToken,
          refresh_token: (rawData.refresh_token as string) || '',
          expires_at: normalizeExpiresAtMs(
            rawData.expires_at as number | undefined,
            rawData.expires_in as number | undefined
          ),
          user,
        }
      : undefined;

    if (session) {
      saveSupabaseSession(session);
    }

    return {
      success: true,
      session,
      user,
    };
  } catch (error) {
    console.error('[SupabaseAuth] Sign up error:', error);
    return {
      success: false,
      message: (error as Error).message || 'Lỗi mạng khi kết nối đến Supabase.',
      source: 'network',
      endpoint: `${config.url}/auth/v1/signup`,
      rawDetails: (error as Error).stack || (error as Error).message,
      actionHint: 'Vui lòng kiểm tra kết nối mạng Internet hoặc cấu hình VITE_SUPABASE_URL.',
    };
  }
};

export const supabaseSignInWithPassword = async (params: {
  email: string;
  password: string;
}): Promise<SupabaseAuthResult> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase is not configured' };
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({
        email: params.email.trim(),
        password: params.password,
      }),
    });

    const data = (await response.json()) as {
      user?: SupabaseUser;
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      error_description?: string;
      msg?: string;
      message?: string;
    };

    if (!response.ok || !data.user || !data.access_token) {
      const rawMsg = data.error_description || data.msg || data.message || '';
      let errorMsg = rawMsg || 'Đăng nhập không thành công.';
      let actionHint = 'Vui lòng kiểm tra lại thông tin đăng nhập.';

      if (rawMsg.includes('Invalid login credentials')) {
        errorMsg = 'Email hoặc mật khẩu không chính xác.';
        actionHint = 'Kiểm tra lại tài khoản, mật khẩu hoặc chuyển sang tab Đăng ký nếu chưa có tài khoản.';
      } else if (rawMsg.includes('Email not confirmed')) {
        errorMsg = 'Email chưa được xác nhận trên Supabase.';
        actionHint =
          'Vui lòng kiểm tra hòm thư để kích hoạt hoặc vào Supabase Dashboard -> Authentication -> Providers -> Email để TẮT "Confirm email".';
      }

      return {
        success: false,
        message: errorMsg,
        code: data.msg || data.error_description || String(response.status),
        source: 'supabase',
        endpoint: `${config.url}/auth/v1/token?grant_type=password`,
        statusCode: response.status,
        rawDetails: JSON.stringify(data),
        actionHint,
      };
    }

    const session: SupabaseSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_at: normalizeExpiresAtMs(data.expires_at, (data as unknown as { expires_in?: number }).expires_in),
      user: data.user,
    };

    saveSupabaseSession(session);

    return {
      success: true,
      session,
      user: data.user,
    };
  } catch (error) {
    console.error('[SupabaseAuth] Sign in error:', error);
    return {
      success: false,
      message: (error as Error).message || 'Lỗi mạng khi kết nối đến Supabase.',
      source: 'network',
      endpoint: `${config.url}/auth/v1/token?grant_type=password`,
      rawDetails: (error as Error).stack || (error as Error).message,
      actionHint: 'Vui lòng kiểm tra kết nối mạng Internet hoặc cấu hình VITE_SUPABASE_URL.',
    };
  }
};

export const supabaseRefreshToken = async (refreshToken?: string): Promise<SupabaseAuthResult> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase is not configured' };
  }

  const token = (refreshToken || getStoredSupabaseSession()?.refresh_token || '').trim();
  if (!token) {
    return {
      success: false,
      message: 'Không tìm thấy refresh token.',
      source: 'validation',
    };
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({
        refresh_token: token,
      }),
    });

    const data = (await response.json()) as {
      user?: SupabaseUser;
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      expires_in?: number;
      error_description?: string;
      msg?: string;
      message?: string;
    };

    if (!response.ok || !data.user || !data.access_token) {
      const rawMsg = data.error_description || data.msg || data.message || '';
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        clearSupabaseSession();
      }

      return {
        success: false,
        message: rawMsg || 'Làm mới token không thành công.',
        code: data.msg || data.error_description || String(response.status),
        source: 'supabase',
        endpoint: `${config.url}/auth/v1/token?grant_type=refresh_token`,
        statusCode: response.status,
        rawDetails: JSON.stringify(data),
      };
    }

    const session: SupabaseSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || token,
      expires_at: normalizeExpiresAtMs(data.expires_at, data.expires_in),
      user: data.user,
    };

    saveSupabaseSession(session);

    return {
      success: true,
      session,
      user: data.user,
    };
  } catch (error) {
    console.error('[SupabaseAuth] Refresh token error:', error);
    return {
      success: false,
      message: (error as Error).message || 'Lỗi mạng khi làm mới token Supabase.',
      source: 'network',
      endpoint: `${config.url}/auth/v1/token?grant_type=refresh_token`,
      rawDetails: (error as Error).stack || (error as Error).message,
      actionHint: 'Vui lòng kiểm tra kết nối mạng Internet hoặc cấu hình VITE_SUPABASE_URL.',
    };
  }
};

export const supabaseResetPasswordForEmail = async (email: string): Promise<SupabaseAuthResult> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase is not configured' };
  }

  const cleanEmail = email.trim();
  try {
    const response = await fetch(`${config.url}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({ email: cleanEmail }),
    });

    const rawData = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const rawMsg =
        (rawData.error_description as string) || (rawData.msg as string) || (rawData.message as string) || '';
      let errorMsg = rawMsg || 'Không thể gửi yêu cầu đặt lại mật khẩu.';
      let actionHint = 'Vui lòng kiểm tra lại địa chỉ email.';
      if (rawMsg.includes('rate limit') || rawMsg.includes('over_email_send_rate_limit')) {
        errorMsg = 'Đã vượt quá hạn mức gửi email của Supabase (Rate limit).';
        actionHint = 'Vui lòng đợi vài phút hoặc cấu hình custom SMTP trên Supabase Dashboard.';
      }
      return {
        success: false,
        message: errorMsg,
        code: (rawData.code as string) || String(response.status),
        source: 'supabase',
        endpoint: `${config.url}/auth/v1/recover`,
        statusCode: response.status,
        rawDetails: JSON.stringify(rawData),
        actionHint,
      };
    }

    return {
      success: true,
      user: { id: '', email: cleanEmail },
    };
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message || 'Lỗi mạng khi gửi yêu cầu khôi phục mật khẩu.',
      source: 'network',
      endpoint: `${config.url}/auth/v1/recover`,
      rawDetails: (error as Error).stack || (error as Error).message,
      actionHint: 'Vui lòng kiểm tra kết nối mạng Internet.',
    };
  }
};

export const supabaseResendVerification = async (email: string): Promise<SupabaseAuthResult> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase is not configured' };
  }

  const cleanEmail = email.trim();
  try {
    const response = await fetch(`${config.url}/auth/v1/resend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({
        type: 'signup',
        email: cleanEmail,
      }),
    });

    const rawData = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const rawMsg =
        (rawData.error_description as string) || (rawData.msg as string) || (rawData.message as string) || '';
      let errorMsg = rawMsg || 'Không thể gửi lại email xác thực.';
      let actionHint = 'Vui lòng thử lại sau hoặc tắt xác thực email trên Supabase.';
      if (rawMsg.includes('rate limit') || rawMsg.includes('over_email_send_rate_limit')) {
        errorMsg = 'Đã vượt quá giới hạn gửi email của Supabase (Rate limit).';
        actionHint =
          'Vào Supabase Dashboard -> Authentication -> Providers -> Email và TẮT "Confirm email", hoặc xác nhận tài khoản thủ công trong mục Users.';
      }
      return {
        success: false,
        message: errorMsg,
        code: (rawData.code as string) || String(response.status),
        source: 'supabase',
        endpoint: `${config.url}/auth/v1/resend`,
        statusCode: response.status,
        rawDetails: JSON.stringify(rawData),
        actionHint,
      };
    }

    return {
      success: true,
      user: { id: '', email: cleanEmail },
    };
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message || 'Lỗi mạng khi gửi lại email xác nhận.',
      source: 'network',
      endpoint: `${config.url}/auth/v1/resend`,
      rawDetails: (error as Error).stack || (error as Error).message,
      actionHint: 'Vui lòng kiểm tra kết nối Internet.',
    };
  }
};

export const supabaseVerifyOtp = async (params: {
  email: string;
  token: string;
  type?: 'signup' | 'recovery';
}): Promise<SupabaseAuthResult> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase is not configured' };
  }

  const cleanEmail = params.email.trim();
  const cleanToken = params.token.trim();
  const otpType = params.type || 'signup';

  try {
    const response = await fetch(`${config.url}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
      },
      body: JSON.stringify({
        type: otpType,
        email: cleanEmail,
        token: cleanToken,
      }),
    });

    const rawData = (await response.json()) as Record<string, unknown>;

    const user: SupabaseUser | undefined =
      (rawData.user as SupabaseUser | undefined) ||
      (rawData.id && typeof rawData.id === 'string'
        ? ({
            id: rawData.id as string,
            email: (rawData.email as string) || cleanEmail,
            user_metadata: (rawData.user_metadata as Record<string, unknown>) || {},
            app_metadata: (rawData.app_metadata as Record<string, unknown>) || {},
            created_at: (rawData.created_at as string) || new Date().toISOString(),
          } as SupabaseUser)
        : undefined);

    if (!response.ok || !user) {
      const rawMsg =
        (rawData.error_description as string) || (rawData.msg as string) || (rawData.message as string) || '';
      let errorMsg = rawMsg || 'Mã xác thực không hợp lệ hoặc đã hết hạn.';
      let actionHint = 'Vui lòng kiểm tra lại mã xác thực trong email hoặc yêu cầu gửi lại mã mới.';
      if (rawMsg.includes('expired')) {
        errorMsg = 'Mã xác thực đã hết hạn.';
        actionHint = 'Bấm "Gửi lại mã" để nhận mã xác thực mới.';
      }
      return {
        success: false,
        message: errorMsg,
        code: (rawData.code as string) || String(response.status),
        source: 'supabase',
        endpoint: `${config.url}/auth/v1/verify`,
        statusCode: response.status,
        rawDetails: JSON.stringify(rawData),
        actionHint,
      };
    }

    const accessToken = typeof rawData.access_token === 'string' ? rawData.access_token : undefined;
    const session: SupabaseSession | undefined = accessToken
      ? {
          access_token: accessToken,
          refresh_token: (rawData.refresh_token as string) || '',
          expires_at: normalizeExpiresAtMs(
            rawData.expires_at as number | undefined,
            rawData.expires_in as number | undefined
          ),
          user,
        }
      : undefined;

    if (session) {
      saveSupabaseSession(session);
    }

    return {
      success: true,
      session,
      user,
    };
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message || 'Lỗi kết nối khi xác thực OTP.',
      source: 'network',
      endpoint: `${config.url}/auth/v1/verify`,
      rawDetails: (error as Error).stack || (error as Error).message,
      actionHint: 'Kiểm tra lại kết nối mạng Internet.',
    };
  }
};

export const DEFAULT_SUPABASE_TIMEOUT_MS = 6000;

export type SupabaseRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & SupabaseRequestOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_SUPABASE_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;
  const controller = new AbortController();

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

export const supabaseSignOut = async (accessToken?: string): Promise<void> => {
  const config = getSupabaseConfig();
  const token = accessToken || getStoredSupabaseSession()?.access_token;
  clearSupabaseSession();

  if (!config || !token) return;

  try {
    await fetchWithTimeout(`${config.url}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
      },
      timeoutMs: 3000,
    });
  } catch (error) {
    console.error('[SupabaseAuth] Logout request error:', error);
  }
};

/**
 * Fetch profile info (balance_tom, tier, company_name) from Supabase PostgREST
 */
export const fetchTomProfile = async (
  userId: string,
  accessToken?: string,
  options?: SupabaseRequestOptions
): Promise<TomProfile | null> => {
  const config = getSupabaseConfig();
  if (!config || !userId) return null;

  const token = accessToken || getStoredSupabaseSession()?.access_token;
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const url = `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,username,full_name,company_name,tier,role,balance_tom,currency`;
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? DEFAULT_SUPABASE_TIMEOUT_MS,
    });
    if (!response.ok) return null;

    const data = (await response.json()) as Array<Record<string, unknown>>;
    if (Array.isArray(data) && data.length > 0) {
      const raw = data[0];
      return {
        id: String(raw.id || userId),
        email: String(raw.email || ''),
        username: raw.username ? String(raw.username) : undefined,
        full_name: raw.full_name ? String(raw.full_name) : undefined,
        company_name: raw.company_name ? String(raw.company_name) : undefined,
        tier: (raw.tier as 'free' | 'pro' | 'enterprise') || 'free',
        role: (raw.role as 'member' | 'manager' | 'admin') || 'member',
        balance_tom: typeof raw.balance_tom === 'number' ? raw.balance_tom : parseFloat(String(raw.balance_tom || '0')),
        currency: String(raw.currency || 'TOM'),
      };
    }
    return null;
  } catch (error) {
    console.error('[SupabaseAuth] Failed to fetch Tom profile:', error);
    return null;
  }
};

/**
 * Subscribe to realtime updates for a user's profile on Supabase
 */
export const subscribeToTomBalanceRealtime = (
  userId: string,
  onUpdate: (updated: Partial<TomProfile>) => void
): (() => void) => {
  const config = getSupabaseConfig();
  if (!config || !userId || typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    return () => {};
  }

  let socket: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;

  const connect = () => {
    if (isClosed) return;
    try {
      const wsUrl = `${config.url.replace(/^http/i, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(config.anonKey)}&vsn=1.0.0`;
      socket = new WebSocket(wsUrl);

      socket.addEventListener('open', () => {
        socket?.send(
          JSON.stringify({
            topic: `realtime:public:profiles:id=eq.${userId}`,
            event: 'phx_join',
            payload: {
              config: {
                postgres_changes: [
                  {
                    event: '*',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${userId}`,
                  },
                ],
              },
            },
            ref: '1',
          })
        );

        heartbeatTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(
              JSON.stringify({
                topic: 'phoenix',
                event: 'heartbeat',
                payload: {},
                ref: 'heartbeat',
              })
            );
          }
        }, 25000);
      });

      socket.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          const record = msg.payload?.data?.record || msg.payload?.record;
          if (record && (record.id === userId || !record.id)) {
            onUpdate({
              balance_tom:
                typeof record.balance_tom === 'number'
                  ? record.balance_tom
                  : parseFloat(String(record.balance_tom || '0')),
              currency: String(record.currency || 'TOM'),
              tier: record.tier,
              company_name: record.company_name,
              full_name: record.full_name,
            });
          }
        } catch {
          // ignore malformed ws message
        }
      });

      socket.addEventListener('error', () => {
        // quiet error
      });

      socket.addEventListener('close', () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (!isClosed) {
          setTimeout(connect, 6000);
        }
      });
    } catch (err) {
      console.warn('[SupabaseRealtime] Connection error:', err);
    }
  };

  connect();

  return () => {
    isClosed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close();
    }
  };
};

export const getLocalTomTransactions = (userId: string): TomTransaction[] => {
  const storage = getStorage();
  if (!storage || !userId) return [];
  try {
    const raw = storage.getItem(`${LOCAL_TRANSACTIONS_PREFIX}${userId}`);
    if (!raw) return [];
    return JSON.parse(raw) as TomTransaction[];
  } catch {
    return [];
  }
};

export const saveLocalTomTransaction = (userId: string, tx: TomTransaction): void => {
  const storage = getStorage();
  if (!storage || !userId) return;
  try {
    const current = getLocalTomTransactions(userId);
    const updated = [tx, ...current].slice(0, 50);
    storage.setItem(`${LOCAL_TRANSACTIONS_PREFIX}${userId}`, JSON.stringify(updated));
  } catch {
    // quiet
  }
};

/**
 * Update user's profile info (full_name, company_name)
 */
export const updateTomProfile = async (
  userId: string,
  data: { full_name?: string; company_name?: string },
  accessToken?: string,
  options?: SupabaseRequestOptions
): Promise<{ success: boolean; message?: string }> => {
  const config = getSupabaseConfig();
  if (!config || !userId) {
    return { success: false, message: 'Supabase chưa được cấu hình hoặc thiếu User ID.' };
  }

  const token = accessToken || getStoredSupabaseSession()?.access_token;
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const url = `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? DEFAULT_SUPABASE_TIMEOUT_MS,
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, message: `Lỗi cập nhật hồ sơ (${response.status}): ${err}` };
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tomni:balance:refresh'));
    }
    return { success: true };
  } catch (error) {
    return { success: false, message: (error as Error).message || 'Lỗi mạng khi cập nhật hồ sơ.' };
  }
};

/**
 * Change password via Supabase Auth PUT /auth/v1/user
 */
export const changeSupabasePassword = async (
  newPassword: string,
  accessToken?: string,
  options?: SupabaseRequestOptions
): Promise<{ success: boolean; message: string }> => {
  const config = getSupabaseConfig();
  if (!config) {
    return { success: false, message: 'Supabase chưa được cấu hình.' };
  }

  const token = accessToken || getStoredSupabaseSession()?.access_token;
  if (!token) {
    return { success: false, message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' };
  }

  try {
    const url = `${config.url}/auth/v1/user`;
    const response = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ password: newPassword }),
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? DEFAULT_SUPABASE_TIMEOUT_MS,
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const msg =
        (data.msg as string) ||
        (data.message as string) ||
        (data.error_description as string) ||
        'Đổi mật khẩu thất bại.';
      return { success: false, message: msg };
    }

    return { success: true, message: 'Mật khẩu đã được cập nhật thành công!' };
  } catch (error) {
    return { success: false, message: (error as Error).message || 'Lỗi mạng khi đổi mật khẩu.' };
  }
};

/**
 * Fetch tom transactions for a user
 */
export const fetchTomTransactions = async (
  userId: string,
  accessToken?: string,
  options?: SupabaseRequestOptions
): Promise<TomTransaction[]> => {
  const localList = getLocalTomTransactions(userId);
  const config = getSupabaseConfig();
  if (!config || !userId) {
    return localList.length > 0
      ? localList
      : [
          {
            id: 'initial-signup-bonus',
            user_id: userId,
            amount: 5.0,
            type: 'bonus',
            description: 'Cộng tiền thưởng đăng ký (+5.00 TOM)',
            balance_after: 5.0,
            created_at: new Date().toISOString(),
          },
        ];
  }

  const token = accessToken || getStoredSupabaseSession()?.access_token;
  const headers: Record<string, string> = {
    apikey: config.anonKey,
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const url = `${config.url}/rest/v1/tom_transactions?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&select=*`;
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? DEFAULT_SUPABASE_TIMEOUT_MS,
    });
    if (response.ok) {
      const data = (await response.json()) as Array<Record<string, unknown>>;
      if (Array.isArray(data) && data.length > 0) {
        const remoteList: TomTransaction[] = data.map((d) => ({
          id: String(d.id || Math.random()),
          user_id: String(d.user_id || userId),
          amount: typeof d.amount === 'number' ? d.amount : parseFloat(String(d.amount || '0')),
          type: (d.type as 'bonus' | 'spend' | 'topup' | 'redeem') || 'bonus',
          description: String(d.description || 'Giao dịch TOM'),
          balance_after:
            typeof d.balance_after === 'number' ? d.balance_after : parseFloat(String(d.balance_after || '0')),
          created_at: String(d.created_at || new Date().toISOString()),
        }));
        const existingIds = new Set(remoteList.map((x) => x.id));
        const unmerged = localList.filter((x) => !existingIds.has(x.id));
        return [...unmerged, ...remoteList];
      }
    }
  } catch {
    // quiet fallback
  }

  if (localList.length > 0) {
    return localList;
  }

  return [
    {
      id: 'initial-signup-bonus',
      user_id: userId,
      amount: 5.0,
      type: 'bonus',
      description: 'Cộng tiền thưởng đăng ký (+5.00 TOM)',
      balance_after: 5.0,
      created_at: new Date().toISOString(),
    },
  ];
};

/**
 * Top up TOM balance (test simulation & remote sync)
 */
export const topUpTomBalance = async (
  userId: string,
  amount: number,
  description = 'Nạp thử nghiệm TOM'
): Promise<{ success: boolean; newBalance: number; message?: string }> => {
  if (amount <= 0) {
    return { success: false, newBalance: 0, message: 'Số tiền nạp phải lớn hơn 0.' };
  }

  const profile = await fetchTomProfile(userId);
  const current = profile?.balance_tom ?? 5.0;
  const newBalance = Number((current + amount).toFixed(4));

  const config = getSupabaseConfig();
  const token = getStoredSupabaseSession()?.access_token;

  const txRecord: TomTransaction = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    amount,
    type: 'topup',
    description: `${description} (+${amount.toFixed(2)} TOM)`,
    balance_after: newBalance,
    created_at: new Date().toISOString(),
  };

  saveLocalTomTransaction(userId, txRecord);

  if (config) {
    const headers: Record<string, string> = {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      await fetch(`${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ balance_tom: newBalance }),
      });

      await fetch(`${config.url}/rest/v1/tom_transactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          amount,
          type: 'topup',
          description: txRecord.description,
          balance_after: newBalance,
        }),
      });
    } catch {
      // quiet fallback
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tomni:balance:refresh'));
  }

  return { success: true, newBalance };
};

/**
 * Redeem promo code for TOM
 */
export const redeemTomCode = async (
  userId: string,
  rawCode: string
): Promise<{ success: boolean; amount: number; message: string }> => {
  const code = rawCode.trim().toUpperCase();
  const PROMO_CODES: Record<string, { amount: number; label: string }> = {
    TOMNI2026: { amount: 20.0, label: 'Mã chào mừng TomniHubOS 2026' },
    WELCOME50: { amount: 50.0, label: 'Quà tặng thành viên mới' },
    TOMDEV: { amount: 10.0, label: 'Gói hỗ trợ nhà phát triển' },
    PROTEST: { amount: 100.0, label: 'Thử nghiệm gói Pro' },
  };

  const promo = PROMO_CODES[code];
  if (!promo) {
    return { success: false, amount: 0, message: 'Mã quà tặng không hợp lệ hoặc đã hết hạn.' };
  }

  const storage = getStorage();
  const redeemedKey = `tomni_redeemed_${userId}_${code}`;
  if (storage?.getItem(redeemedKey)) {
    return { success: false, amount: 0, message: 'Bạn đã sử dụng mã quà tặng này rồi.' };
  }

  const result = await topUpTomBalance(userId, promo.amount, `Đổi mã: ${promo.label}`);
  if (result.success) {
    storage?.setItem(redeemedKey, 'true');
    return {
      success: true,
      amount: promo.amount,
      message: `Đổi mã thành công! Bạn nhận được +${promo.amount.toFixed(2)} TOM.`,
    };
  }

  return { success: false, amount: 0, message: result.message || 'Lỗi khi nạp TOM.' };
};
