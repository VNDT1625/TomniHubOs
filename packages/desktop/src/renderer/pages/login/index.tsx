/**
 * @license
 * Copyright 2025-2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { changeLanguage } from '@/renderer/services/i18n';
import AppLoader from '@renderer/components/layout/AppLoader';
import WindowControls from '@renderer/components/layout/WindowControls';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { ipcBridge } from '@/common';
import { isMacOS } from '@/renderer/utils/platform';
import loginLogo from '@renderer/assets/logos/brand/app.png';
import './LoginPage.css';
import type { AuthErrorSource } from '@/renderer/hooks/context/AuthContext';

type MessageState = {
  type: 'error' | 'success';
  text: string;
  source?: AuthErrorSource;
  endpoint?: string;
  statusCode?: number;
  rawDetails?: string;
  actionHint?: string;
};

type FormMode = 'login' | 'register' | 'forgot' | 'verifyOtp';

const REMEMBER_ME_KEY = 'rememberMe';
const REMEMBERED_USERNAME_KEY = 'rememberedUsername';
const REMEMBERED_PASSWORD_KEY = 'rememberedPassword';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

// Simple obfuscation for stored credentials in web local storage
const obfuscate = (text: string): string => {
  const encoded = btoa(encodeURIComponent(text));
  return encoded.split('').toReversed().join('');
};

const deobfuscate = (text: string): string => {
  try {
    const reversed = text.split('').toReversed().join('');
    return decodeURIComponent(atob(reversed));
  } catch {
    return '';
  }
};

const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status, ready, login, register, forgotPassword, resendVerification, verifyOtp, isSupabaseConfigured } =
    useAuth();

  const [mode, setMode] = useState<FormMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpToken, setOtpToken] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);

  const usernameRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const messageTimer = useRef<number | undefined>(undefined);

  const isDesktop =
    typeof window !== 'undefined' && Boolean((window as Window & { electronAPI?: unknown }).electronAPI);

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => {
      document.body.classList.remove('login-page-active');
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (mode === 'register') {
      document.title = t('login.tabRegister');
    } else if (mode === 'forgot') {
      document.title = 'Khôi phục mật khẩu - TomniHubOS';
    } else if (mode === 'verifyOtp') {
      document.title = 'Xác thực tài khoản - TomniHubOS';
    } else {
      document.title = t('login.pageTitle');
    }
  }, [mode, t]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    const isRememberMe = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (isRememberMe) {
      const storedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY);
      const storedPassword = localStorage.getItem(REMEMBERED_PASSWORD_KEY);
      if (storedUsername) setUsername(deobfuscate(storedUsername));
      if (storedPassword) setPassword(deobfuscate(storedPassword));
      setRememberMe(true);
    }
    window.setTimeout(() => {
      if (usernameRef.current && !usernameRef.current.value) {
        usernameRef.current.focus();
      } else if (passwordRef.current && !passwordRef.current.value) {
        passwordRef.current.focus();
      }
    }, 100);
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  const clearMessageLater = useCallback(() => {
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current);
    }
    messageTimer.current = window.setTimeout(() => {
      setMessage((prev) => (prev?.type === 'success' ? prev : null));
    }, 12000);
  }, []);

  const showMessage = useCallback(
    (next: MessageState) => {
      setMessage(next);
      if (next.type === 'error') {
        clearMessageLater();
      }
    },
    [clearMessageLater]
  );

  const supportedLanguages = useMemo<{ code: string; label: string }[]>(
    () => [
      { code: 'zh-CN', label: '简体中文' },
      { code: 'zh-TW', label: '繁體中文' },
      { code: 'ja-JP', label: '日本語' },
      { code: 'ko-KR', label: '한국어' },
      { code: 'tr-TR', label: 'Türkçe' },
      { code: 'uk-UA', label: 'Українська' },
      { code: 'vi-VN', label: 'Tiếng Việt' },
      { code: 'en-US', label: 'English' },
    ],
    []
  );

  const handleLanguageChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value;
    changeLanguage(nextLanguage).catch((error: Error) => {
      console.error('Failed to change language:', error);
    });
  }, []);

  const handleForgotPassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = username.trim();
      if (!trimmed || !trimmed.includes('@')) {
        showMessage({
          type: 'error',
          text: 'Vui lòng nhập địa chỉ email hợp lệ để nhận liên kết khôi phục mật khẩu.',
          source: 'validation',
          actionHint: 'Nhập đúng email bạn đã sử dụng khi đăng ký tài khoản.',
        });
        return;
      }

      setLoading(true);
      setMessage(null);

      const result = await forgotPassword(trimmed);
      if (result.success) {
        showMessage({
          type: 'success',
          text: result.message || 'Đã gửi hướng dẫn khôi phục mật khẩu vào hộp thư của bạn.',
        });
      } else {
        showMessage({
          type: 'error',
          text: result.message || 'Không thể gửi email khôi phục mật khẩu.',
          source: result.source || 'supabase',
          endpoint: result.endpoint,
          statusCode: result.statusCode,
          rawDetails: result.rawDetails,
          actionHint: result.actionHint,
        });
      }
      setLoading(false);
    },
    [forgotPassword, showMessage, username]
  );

  const handleVerifyOtp = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedEmail = username.trim();
      const trimmedToken = otpToken.trim();

      if (!trimmedEmail) {
        showMessage({
          type: 'error',
          text: 'Vui lòng nhập địa chỉ email của bạn.',
          source: 'validation',
        });
        return;
      }
      if (!trimmedToken || trimmedToken.length < 6) {
        showMessage({
          type: 'error',
          text: 'Vui lòng nhập mã xác thực OTP 6 số được gửi trong email.',
          source: 'validation',
          actionHint: 'Kiểm tra hộp thư đến hoặc thư rác (Spam) để lấy mã xác thực.',
        });
        return;
      }

      setLoading(true);
      setMessage(null);

      const result = await verifyOtp({ email: trimmedEmail, token: trimmedToken, type: 'signup' });
      if (result.success) {
        showMessage({
          type: 'success',
          text: 'Xác thực tài khoản thành công! Đang chuyển hướng...',
        });
        window.setTimeout(() => {
          void navigate('/guid', { replace: true });
        }, 800);
      } else {
        showMessage({
          type: 'error',
          text: result.message || 'Mã xác thực không hợp lệ hoặc đã hết hạn.',
          source: result.source || 'supabase',
          endpoint: result.endpoint,
          statusCode: result.statusCode,
          rawDetails: result.rawDetails,
          actionHint: result.actionHint,
        });
      }
      setLoading(false);
    },
    [navigate, otpToken, showMessage, username, verifyOtp]
  );

  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0 || isResending) return;
    const trimmedEmail = username.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      showMessage({
        type: 'error',
        text: 'Vui lòng nhập địa chỉ email hợp lệ trước khi gửi lại mã.',
        source: 'validation',
      });
      return;
    }

    setIsResending(true);
    const result = await resendVerification(trimmedEmail);
    if (result.success) {
      setResendCooldown(60);
      showMessage({
        type: 'success',
        text: result.message || 'Đã gửi lại email xác nhận. Vui lòng kiểm tra hộp thư.',
      });
    } else {
      showMessage({
        type: 'error',
        text: result.message || 'Không thể gửi lại email xác thực.',
        source: result.source || 'supabase',
        endpoint: result.endpoint,
        statusCode: result.statusCode,
        rawDetails: result.rawDetails,
        actionHint: result.actionHint,
      });
    }
    setIsResending(false);
  }, [isResending, resendCooldown, resendVerification, showMessage, username]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      if (mode === 'forgot') {
        await handleForgotPassword(event);
        return;
      }

      if (mode === 'verifyOtp') {
        await handleVerifyOtp(event);
        return;
      }

      const trimmedUsername = username.trim();

      if (mode === 'register') {
        if (!trimmedUsername || !password || !confirmPassword) {
          showMessage({
            type: 'error',
            text: t('login.errors.empty'),
            source: 'validation',
            actionHint: 'Vui lòng điền đầy đủ email và mật khẩu.',
          });
          return;
        }
        if (isSupabaseConfigured && !trimmedUsername.includes('@')) {
          showMessage({
            type: 'error',
            text: 'Vui lòng nhập địa chỉ email hợp lệ (ví dụ: yourname@gmail.com).',
            source: 'validation',
            actionHint: 'Hệ thống Supabase Cloud Auth yêu cầu định dạng email để tạo và quản lý tài khoản.',
          });
          return;
        }
        if (trimmedUsername.length < 3) {
          showMessage({
            type: 'error',
            text: t('login.errors.usernameLength'),
            source: 'validation',
            actionHint: 'Tên đăng nhập hoặc email phải có ít nhất 3 ký tự.',
          });
          return;
        }
        if (password.length < 6) {
          showMessage({
            type: 'error',
            text: t('login.errors.passwordLength'),
            source: 'validation',
            actionHint: 'Mật khẩu cần tối thiểu 6 ký tự để bảo đảm an toàn.',
          });
          return;
        }
        if (password !== confirmPassword) {
          showMessage({
            type: 'error',
            text: t('login.errors.passwordMismatch'),
            source: 'validation',
            actionHint: 'Hãy kiểm tra và nhập lại ô xác nhận mật khẩu cho trùng khớp.',
          });
          return;
        }

        setLoading(true);
        setMessage(null);

        const result = await register({ username: trimmedUsername, password });
        if (result.success) {
          showMessage({ type: 'success', text: t('login.registerSuccess') });
          window.setTimeout(() => {
            void navigate('/guid', { replace: true });
          }, 600);
        } else {
          showMessage({
            type: 'error',
            text: result.message ?? t('login.errors.unknown'),
            source: result.source || 'supabase',
            endpoint: result.endpoint,
            statusCode: result.statusCode,
            rawDetails: result.rawDetails,
            actionHint: result.actionHint,
          });
        }
        setLoading(false);
        return;
      }

      // Mode === 'login'
      if (!trimmedUsername || !password) {
        showMessage({
          type: 'error',
          text: t('login.errors.empty'),
          source: 'validation',
          actionHint: 'Vui lòng điền đầy đủ thông tin tài khoản và mật khẩu.',
        });
        return;
      }

      setLoading(true);
      setMessage(null);

      const result = await login({ username: trimmedUsername, password, remember: rememberMe });

      if (result.success) {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_ME_KEY, 'true');
          localStorage.setItem(REMEMBERED_USERNAME_KEY, obfuscate(trimmedUsername));
          localStorage.setItem(REMEMBERED_PASSWORD_KEY, obfuscate(password));
        } else {
          localStorage.removeItem(REMEMBER_ME_KEY);
          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
          localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
        }

        const successText = t('login.success');
        showMessage({ type: 'success', text: successText });

        window.setTimeout(() => {
          void navigate('/guid', { replace: true });
        }, 600);
      } else {
        const errorText = (() => {
          if (result.message) return result.message;
          switch (result.code) {
            case 'invalidCredentials':
              return t('login.errors.invalidCredentials');
            case 'tooManyAttempts':
              return t('login.errors.tooManyAttempts');
            case 'networkError':
              return t('login.errors.networkError');
            case 'serverError':
              return t('login.errors.serverError');
            case 'unknown':
            default:
              return t('login.errors.unknown');
          }
        })();

        showMessage({
          type: 'error',
          text: errorText,
          source: result.source || (isSupabaseConfigured ? 'supabase' : 'local'),
          endpoint: result.endpoint,
          statusCode: result.statusCode,
          rawDetails: result.rawDetails,
          actionHint: result.actionHint,
        });
      }

      setLoading(false);
    },
    [
      confirmPassword,
      handleForgotPassword,
      handleVerifyOtp,
      isSupabaseConfigured,
      login,
      mode,
      navigate,
      password,
      register,
      rememberMe,
      showMessage,
      t,
      username,
    ]
  );

  if (status === 'checking') {
    return <AppLoader />;
  }

  return (
    <div className='login-page'>
      {/* Top Frameless Window Bar */}
      <header className='login-page__window-bar'>
        <div className='login-page__window-title'>
          <span className='login-page__window-dot' aria-hidden='true' />
          <span>Tomni Hub Agent OS</span>
        </div>

        <div className='login-page__window-actions'>
          {/* Language Selector */}
          <div className='login-page__lang-selector'>
            <svg
              className='login-page__lang-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              aria-hidden='true'
            >
              <circle cx='12' cy='12' r='10' />
              <line x1='2' y1='12' x2='22' y2='12' />
              <path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' />
            </svg>
            <select
              id='lang-select'
              aria-label='Select language'
              className='login-page__lang-select'
              value={i18n.language}
              onChange={handleLanguageChange}
            >
              {supportedLanguages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Window Control Buttons */}
          {isDesktop && !isMacOS() ? <WindowControls /> : null}
        </div>
      </header>

      {/* Main Workspace: Asymmetric Split Architecture */}
      <main className='login-page__content'>
        {/* Left Column: Kernel Matrix & Architecture Showcase */}
        <section className='login-page__matrix'>
          <div className='login-page__brand-header'>
            <div className='login-page__brand-badge'>
              <span>ARCHITECTURAL KERNEL • v0.9.4</span>
            </div>
            <div className='login-page__brand-title-wrap'>
              <img src={loginLogo} alt={t('login.brand')} className='login-page__brand-logo' />
              <div>
                <h1 className='login-page__brand-title'>{t('login.brand')}</h1>
                <p className='login-page__brand-tagline'>Autonomous Multi-Agent Operating System & Sovereign Vault</p>
              </div>
            </div>
          </div>

          <div className='login-page__pillars'>
            <div className='login-page__pillar'>
              <div className='login-page__pillar-icon'>🛡️</div>
              <div className='login-page__pillar-body'>
                <span className='login-page__pillar-title'>Autonomous Agent Mesh</span>
                <span className='login-page__pillar-desc'>
                  Multi-agent governed execution with causal memory, immutable audit receipts & zero prompt leakage.
                </span>
              </div>
            </div>

            <div className='login-page__pillar'>
              <div className='login-page__pillar-icon'>⚡</div>
              <div className='login-page__pillar-body'>
                <span className='login-page__pillar-title'>Local-First SQLite Vault</span>
                <span className='login-page__pillar-desc'>
                  Client-side AES-256 GCM isolation. Sovereign data ownership with zero telemetry leakage.
                </span>
              </div>
            </div>

            <div className='login-page__pillar'>
              <div className='login-page__pillar-icon'>🪙</div>
              <div className='login-page__pillar-body'>
                <span className='login-page__pillar-title'>TOM Realtime Economy</span>
                <span className='login-page__pillar-desc'>
                  1 TOM = $1.00 USD native model compute tokens with live WebSocket sync & transaction ledger.
                </span>
              </div>
            </div>
          </div>

          <div className='login-page__telemetry'>
            <div className='login-page__telemetry-item'>
              <span>Gateway:</span>
              <span className='login-page__telemetry-val'>
                {isSupabaseConfigured ? 'ONLINE (Supabase)' : 'STANDBY (Local)'}
              </span>
            </div>
            <div className='login-page__telemetry-item'>
              <span>Security:</span>
              <span className='login-page__telemetry-val'>AES-256 GCM</span>
            </div>
            <div className='login-page__telemetry-item'>
              <span>Latency:</span>
              <span className='login-page__telemetry-val'>&lt; 40ms</span>
            </div>
          </div>
        </section>

        {/* Right Column: Authentication Console */}
        <section className='login-page__console'>
          <div className='login-page__console-header'>
            <h2 className='login-page__console-title'>
              {mode === 'login' && 'Đăng nhập Hệ thống'}
              {mode === 'register' && 'Khởi tạo Danh tính'}
              {mode === 'forgot' && 'Khôi phục Mật khẩu'}
              {mode === 'verifyOtp' && 'Xác thực Bảo mật OTP'}
            </h2>
            <p className='login-page__console-subtitle'>
              {mode === 'login' && t('login.subtitle')}
              {mode === 'register' && t('login.registerSubtitle')}
              {mode === 'forgot' && 'Nhập email để nhận liên kết thiết lập lại mật khẩu'}
              {mode === 'verifyOtp' && 'Nhập mã 6 chữ số từ email để kích hoạt tài khoản'}
            </p>
            {isSupabaseConfigured ? (
              <div className='login-page__provider-badge' title='Supabase Cloud Authentication'>
                <span className='login-page__provider-badge-dot' />
                <span>{t('login.supabaseBadge')}</span>
              </div>
            ) : null}
          </div>

          {/* Segmented Mode Switcher */}
          {(mode === 'login' || mode === 'register') && (
            <div className='login-page__tabs' role='tablist'>
              <button
                type='button'
                role='tab'
                aria-selected={mode === 'login'}
                className={`login-page__tab ${mode === 'login' ? 'login-page__tab--active' : ''}`}
                onClick={() => {
                  setMode('login');
                  setMessage(null);
                }}
              >
                {t('login.tabLogin')}
              </button>
              <button
                type='button'
                role='tab'
                aria-selected={mode === 'register'}
                className={`login-page__tab ${mode === 'register' ? 'login-page__tab--active' : ''}`}
                onClick={() => {
                  setMode('register');
                  setMessage(null);
                }}
              >
                {t('login.tabRegister')}
              </button>
            </div>
          )}

          {/* Subpage Back Button */}
          {(mode === 'forgot' || mode === 'verifyOtp') && (
            <div className='login-page__subpage-header'>
              <button
                type='button'
                className='login-page__back-link'
                onClick={() => {
                  setMode('login');
                  setMessage(null);
                }}
              >
                ← Quay lại Đăng nhập
              </button>
            </div>
          )}

          {/* Main Form */}
          <form className='login-page__form' onSubmit={handleSubmit}>
            <div className='login-page__form-item'>
              <label className='login-page__label' htmlFor='username'>
                {mode === 'forgot' || mode === 'verifyOtp'
                  ? 'Địa chỉ Email'
                  : isSupabaseConfigured
                    ? t('login.emailOrUsername')
                    : t('login.username')}
              </label>
              <div className='login-page__input-wrapper'>
                <svg
                  className='login-page__input-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                  aria-hidden='true'
                >
                  <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                  <circle cx='12' cy='7' r='4' />
                </svg>
                <input
                  ref={usernameRef}
                  id='username'
                  name='username'
                  className='login-page__input'
                  placeholder={
                    mode === 'forgot' || mode === 'verifyOtp'
                      ? 'Nhập email của bạn (ví dụ: name@gmail.com)'
                      : isSupabaseConfigured
                        ? t('login.emailOrUsernamePlaceholder')
                        : t('login.usernamePlaceholder')
                  }
                  autoComplete='username'
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-required='true'
                />
              </div>
            </div>

            {(mode === 'login' || mode === 'register') && (
              <div className='login-page__form-item'>
                <label className='login-page__label' htmlFor='password'>
                  {t('login.password')}
                </label>
                <div className='login-page__input-wrapper'>
                  <svg
                    className='login-page__input-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    aria-hidden='true'
                  >
                    <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
                    <path d='M7 11V7a5 5 0 0 1 10 0v4' />
                  </svg>
                  <input
                    ref={passwordRef}
                    id='password'
                    name='password'
                    type={passwordVisible ? 'text' : 'password'}
                    className='login-page__input'
                    placeholder={t('login.passwordPlaceholder')}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-required='true'
                  />
                  <button
                    type='button'
                    className='login-page__toggle-password'
                    onClick={() => setPasswordVisible((prev) => !prev)}
                    aria-label={passwordVisible ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                      {passwordVisible ? (
                        <>
                          <path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' />
                          <line x1='1' y1='1' x2='23' y2='23' />
                        </>
                      ) : (
                        <>
                          <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
                          <circle cx='12' cy='12' r='3' />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {mode === 'register' && (
              <div className='login-page__form-item'>
                <label className='login-page__label' htmlFor='confirm-password'>
                  {t('login.confirmPassword')}
                </label>
                <div className='login-page__input-wrapper'>
                  <svg
                    className='login-page__input-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    aria-hidden='true'
                  >
                    <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
                    <path d='M7 11V7a5 5 0 0 1 10 0v4' />
                  </svg>
                  <input
                    id='confirm-password'
                    name='confirmPassword'
                    type={confirmPasswordVisible ? 'text' : 'password'}
                    className='login-page__input'
                    placeholder={t('login.confirmPasswordPlaceholder')}
                    autoComplete='new-password'
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    aria-required='true'
                  />
                  <button
                    type='button'
                    className='login-page__toggle-password'
                    onClick={() => setConfirmPasswordVisible((prev) => !prev)}
                    aria-label={confirmPasswordVisible ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                      {confirmPasswordVisible ? (
                        <>
                          <path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' />
                          <line x1='1' y1='1' x2='23' y2='23' />
                        </>
                      ) : (
                        <>
                          <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
                          <circle cx='12' cy='12' r='3' />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {mode === 'verifyOtp' && (
              <div className='login-page__form-item'>
                <div className='login-page__otp-header'>
                  <label className='login-page__label' htmlFor='otp-token'>
                    Mã xác thực (OTP 6 chữ số)
                  </label>
                  <button
                    type='button'
                    className='login-page__resend-btn'
                    disabled={resendCooldown > 0 || isResending}
                    onClick={handleResendOtp}
                  >
                    {isResending
                      ? 'Đang gửi...'
                      : resendCooldown > 0
                        ? `Gửi lại sau (${resendCooldown}s)`
                        : 'Gửi lại mã'}
                  </button>
                </div>
                <div className='login-page__input-wrapper'>
                  <svg
                    className='login-page__input-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    aria-hidden='true'
                  >
                    <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
                    <path d='M7 11V7a5 5 0 0 1 10 0v4' />
                  </svg>
                  <input
                    id='otp-token'
                    name='otp-token'
                    type='text'
                    inputMode='numeric'
                    maxLength={8}
                    className='login-page__input login-page__input--otp'
                    placeholder='123456'
                    value={otpToken}
                    onChange={(event) => setOtpToken(event.target.value)}
                    aria-required='true'
                  />
                </div>
              </div>
            )}

            {mode === 'login' && (
              <div className='login-page__form-row'>
                {!isDesktopRuntime ? (
                  <div className='login-page__checkbox'>
                    <input
                      type='checkbox'
                      id='remember-me'
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                    />
                    <label htmlFor='remember-me'>{t('login.rememberMe')}</label>
                  </div>
                ) : (
                  <div />
                )}

                {isSupabaseConfigured && (
                  <button
                    type='button'
                    className='login-page__forgot-link'
                    onClick={() => {
                      setMode('forgot');
                      setMessage(null);
                    }}
                  >
                    Quên mật khẩu?
                  </button>
                )}
              </div>
            )}

            <button type='submit' className='login-page__submit' disabled={loading}>
              {loading && (
                <svg className='login-page__spinner' viewBox='0 0 24 24' width='18' height='18'>
                  <circle
                    cx='12'
                    cy='12'
                    r='10'
                    stroke='currentColor'
                    strokeWidth='3'
                    fill='none'
                    strokeDasharray='50'
                    strokeDashoffset='25'
                    strokeLinecap='round'
                  />
                </svg>
              )}
              <span>
                {loading
                  ? 'Đang xử lý...'
                  : mode === 'register'
                    ? t('login.registerSubmit')
                    : mode === 'forgot'
                      ? 'Gửi liên kết khôi phục'
                      : mode === 'verifyOtp'
                        ? 'Xác thực & Kích hoạt'
                        : t('login.submit')}
              </span>
            </button>

            {/* Rich Error / Success Diagnostics Box */}
            <div
              role='alert'
              aria-live='polite'
              className={`login-page__message ${message ? (message.type === 'success' ? 'login-page__message--success' : 'login-page__message--error') : ''}`}
              hidden={!message}
            >
              {message?.type === 'error' && (
                <div className='login-page__error-header'>
                  <span className='login-page__error-badge'>Lỗi</span>
                  {message.source && (
                    <span className={`login-page__error-source login-page__error-source--${message.source}`}>
                      {message.source === 'supabase' && '🌐 Supabase Cloud'}
                      {message.source === 'local' && '💻 Local System'}
                      {message.source === 'network' && '🔌 Network / Mạng'}
                      {message.source === 'validation' && '🛡️ Dữ liệu nhập'}
                    </span>
                  )}
                </div>
              )}
              <div className='login-page__message-text'>{message?.text}</div>
              {message?.actionHint && (
                <div className='login-page__error-hint'>
                  <span className='login-page__error-hint-icon' aria-hidden='true'>
                    💡
                  </span>
                  <span>{message.actionHint}</span>
                </div>
              )}
              {message?.type === 'error' &&
                (message.text.includes('chưa được xác nhận') || message.rawDetails?.includes('email_not_confirmed')) &&
                mode !== 'verifyOtp' && (
                  <div className='login-page__quick-action-wrap'>
                    <button
                      type='button'
                      className='login-page__quick-action-btn'
                      onClick={() => {
                        setMode('verifyOtp');
                        setMessage(null);
                      }}
                    >
                      🔑 Bấm vào đây để nhập mã OTP hoặc gửi lại email xác thực
                    </button>
                  </div>
                )}
              {(Boolean(message?.endpoint) || Boolean(message?.statusCode) || Boolean(message?.rawDetails)) && (
                <details className='login-page__error-details'>
                  <summary className='login-page__error-details-summary'>Chi tiết kỹ thuật (Vị trí & Mã lỗi)</summary>
                  <div className='login-page__error-details-box'>
                    {message.endpoint && (
                      <div className='login-page__error-detail-row'>
                        <span className='login-page__error-detail-label'>Vị trí (Endpoint):</span>
                        <code className='login-page__error-detail-code'>{message.endpoint}</code>
                      </div>
                    )}
                    {message.statusCode && (
                      <div className='login-page__error-detail-row'>
                        <span className='login-page__error-detail-label'>Mã phản hồi HTTP:</span>
                        <code className='login-page__error-detail-code'>{message.statusCode}</code>
                      </div>
                    )}
                    {message.rawDetails && (
                      <div className='login-page__error-detail-row'>
                        <span className='login-page__error-detail-label'>Dữ liệu chi tiết:</span>
                        <pre className='login-page__error-detail-pre'>{message.rawDetails}</pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>

            {/* Bottom Switch Mode Link */}
            <div className='login-page__switch-mode'>
              {mode === 'login' ? (
                <>
                  <span>{t('login.switchToRegisterPrompt')}</span>{' '}
                  <button
                    type='button'
                    className='login-page__switch-link'
                    onClick={() => {
                      setMode('register');
                      setMessage(null);
                    }}
                  >
                    {t('login.switchToRegister')}
                  </button>
                </>
              ) : mode === 'register' ? (
                <>
                  <span>{t('login.switchToLoginPrompt')}</span>{' '}
                  <button
                    type='button'
                    className='login-page__switch-link'
                    onClick={() => {
                      setMode('login');
                      setMessage(null);
                    }}
                  >
                    {t('login.switchToLogin')}
                  </button>
                </>
              ) : (
                <button
                  type='button'
                  className='login-page__switch-link'
                  onClick={() => {
                    setMode('login');
                    setMessage(null);
                  }}
                >
                  ← Quay lại trang Đăng nhập
                </button>
              )}
            </div>
          </form>

          <div className='login-page__footer'>
            <div className='login-page__footer-content'>
              <span>{t('login.footerPrimary')}</span>
              <span className='login-page__footer-divider'>•</span>
              <span>{t('login.footerSecondary')}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default LoginPage;
