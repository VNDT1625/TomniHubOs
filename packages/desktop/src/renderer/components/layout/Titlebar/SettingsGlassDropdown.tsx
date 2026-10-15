/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Popover, Tooltip } from '@arco-design/web-react';
import { Down, Gift, Home, Logout, Moon, Pic, Robot, SettingTwo, Shield, SunOne, User } from '@icon-park/react';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { changeLanguage } from '@/renderer/services/i18n';
import { fetchTomProfile, isSupabaseConfigured } from '@/renderer/services/supabaseAuth';

const LANGUAGE_OPTIONS = [
  { code: 'vi-VN', shortLabel: 'VI', label: 'Tiếng Việt' },
  { code: 'en-US', shortLabel: 'EN', label: 'English' },
  { code: 'zh-CN', shortLabel: '中', label: '简体中文' },
  { code: 'ja-JP', shortLabel: '日', label: '日本語' },
] as const;

type SettingsGlassDropdownProps = {
  /** 'home' = v3 avatar menu: profile, credit, language, theme, settings. */
  variant?: 'default' | 'home';
};

export const SettingsGlassDropdown: React.FC<SettingsGlassDropdownProps> = ({ variant = 'default' }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isSettingsRoute = pathname.startsWith('/settings');
  const contextActionPath = isSettingsRoute ? '/guid' : '/settings/model';
  const contextActionLabel = isSettingsRoute
    ? t('common.home', { defaultValue: 'Trang chủ' })
    : t('guid.hubHome.account.settings', { defaultValue: 'Cài đặt' });
  const { user, logout } = useAuth();
  const { theme, setTheme } = useThemeContext();

  const toggleTheme = useCallback(() => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  const accountName = useMemo(() => {
  return user?.username || 'Tomny User';
  }, [user]);

  const accountInitials = useMemo(() => {
    const raw = accountName.trim();
    if (!raw) return 'T';
    if (raw.includes('@')) return raw[0].toUpperCase();
    const parts = raw.split(/\s+/);
    if (parts.length > 1) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return raw.slice(0, 2).toUpperCase();
  }, [accountName]);

  const handleNavigate = useCallback(
    (path: string) => {
      void navigate(path);
    },
    [navigate]
  );

  const handleLogout = useCallback(async () => {
    await logout();
    void navigate('/login', { replace: true });
  }, [logout, navigate]);

  const [credit, setCredit] = useState<number | null>(null);
  useEffect(() => {
    if (variant !== 'home' || !user?.id || !isSupabaseConfigured()) return undefined;
    const controller = new AbortController();
    void fetchTomProfile(user.id, undefined, { signal: controller.signal, timeoutMs: 5000 })
      .then((profile) => setCredit(profile?.balance_tom ?? null))
      .catch(() => setCredit(null));
    return () => controller.abort();
  }, [user?.id, variant]);

  const homeContent = (
    <div className='hub-account-menu'>
      <div className='hub-account-head'>
        <span className='hub-account-avatar hub-account-avatar--lg'>{accountInitials}</span>
        <div className='hub-account-meta'>
          <b title={accountName}>{accountName}</b>
          <span className='hub-account-tier'>{t('guid.hubHome.account.member', { defaultValue: 'MEMBER' })}</span>
        </div>
      </div>
      <div className='hub-account-credit'>
        <span>{t('guid.hubHome.account.credit', { defaultValue: 'Số dư TOM' })}</span>
        <b>
          {credit === null
            ? '—'
            : credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </b>
      </div>
      <div className='hub-account-sep' />
      <div className='hub-account-row'>
        <span>{t('guid.hubHome.account.language', { defaultValue: 'Ngôn ngữ' })}</span>
        <span className='hub-account-seg'>
          {LANGUAGE_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              type='button'
              title={opt.label}
              className={i18n.language === opt.code ? 'hub-on' : ''}
              onClick={() => void changeLanguage(opt.code)}
            >
              {opt.shortLabel}
            </button>
          ))}
        </span>
      </div>
      <div className='hub-account-row'>
        <span>{t('guid.hubHome.account.theme', { defaultValue: 'Giao diện' })}</span>
        <span className='hub-account-seg'>
          <button type='button' className={theme === 'dark' ? 'hub-on' : ''} onClick={() => void setTheme('dark')}>
            <Moon theme='outline' size={12} fill='currentColor' />
            {t('guid.hubHome.account.dark', { defaultValue: 'Tối' })}
          </button>
          <button type='button' className={theme === 'light' ? 'hub-on' : ''} onClick={() => void setTheme('light')}>
            <SunOne theme='outline' size={12} fill='currentColor' />
            {t('guid.hubHome.account.light', { defaultValue: 'Sáng' })}
          </button>
        </span>
      </div>
      <div className='hub-account-sep' />
      <button type='button' className='hub-account-item' onClick={() => handleNavigate(contextActionPath)}>
        {isSettingsRoute ? (
          <Home theme='outline' size={14} fill='currentColor' />
        ) : (
          <SettingTwo theme='outline' size={14} fill='currentColor' />
        )}
        {contextActionLabel}
      </button>
      <button type='button' className='hub-account-item' onClick={handleLogout}>
        <Logout theme='outline' size={14} fill='currentColor' />
        {t('common.logout', { defaultValue: 'Đăng xuất' })}
      </button>
    </div>
  );

  const popoverContent = (
    <div className='tomni-glass-panel' style={{ width: '280px', padding: '0 0 8px 0' }}>
      {/* Header with profile info */}
      <div
        className='tomni-glass-header'
        style={{ cursor: 'pointer' }}
        onClick={() => handleNavigate('/account')}
        title='Nhấn để vào Hồ sơ & Tài khoản'
      >
        <div className='tomni-glass-avatar'>{accountInitials}</div>
        <div className='tomni-glass-info'>
          <span className='tomni-glass-name' title={accountName}>
            {accountName}
          </span>
          <div className='tomni-glass-badge-row'>
            <span className='tomni-glass-status-dot' />
            <span className='tomni-glass-tier-badge'>Pro Hub</span>
          </div>
        </div>
      </div>

      {/* Navigation items */}
      <div style={{ padding: '6px 8px' }}>
        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate('/account')}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              <User theme='outline' size={16} fill='currentColor' />
            </span>
            <span>Hồ sơ & Tài khoản</span>
          </div>
          <span className='text-10px px-4px py-1px rounded bg-blue-500/20 text-blue-400 font-semibold'>Account</span>
        </button>

        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate(contextActionPath)}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              {isSettingsRoute ? (
                <Home theme='outline' size={16} fill='currentColor' />
              ) : (
                <SettingTwo theme='outline' size={16} fill='currentColor' />
              )}
            </span>
            <span>{contextActionLabel}</span>
          </div>
        </button>

        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate('/settings/display')}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              <Pic theme='outline' size={16} fill='currentColor' />
            </span>
            <span>Giao diện & Chủ đề (Themes)</span>
          </div>
        </button>

        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate('/store')}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              <Gift theme='outline' size={16} fill='currentColor' />
            </span>
            <span>Cửa hàng gói & Ứng dụng</span>
          </div>
          <span className='text-10px px-4px py-1px rounded bg-blue-500/20 text-blue-400 font-semibold'>Store</span>
        </button>

        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate('/settings/model')}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              <Robot theme='outline' size={16} fill='currentColor' />
            </span>
            <span>Mô hình AI & Provider</span>
          </div>
        </button>

        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate('/settings/security')}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              <Shield theme='outline' size={16} fill='currentColor' />
            </span>
            <span>Bảo mật & Két an toàn</span>
          </div>
        </button>
      </div>

      <div className='tomni-glass-divider' />

      {/* Quick preferences: Theme mode & Language */}
      <div style={{ padding: '4px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {LANGUAGE_OPTIONS.map((opt) => (
            <Tooltip key={opt.code} content={opt.label}>
              <button
                type='button'
                onClick={() => void changeLanguage(opt.code)}
                style={{
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: i18n.language === opt.code ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: i18n.language === opt.code ? '#38bdf8' : '#94a3b8',
                }}
              >
                {opt.shortLabel}
              </button>
            </Tooltip>
          ))}
        </div>

        <button
          type='button'
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#cbd5e1',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          {theme === 'dark' ? (
            <>
              <SunOne theme='outline' size={13} fill='currentColor' />
              <span>Sáng</span>
            </>
          ) : (
            <>
              <Moon theme='outline' size={13} fill='currentColor' />
              <span>Tối</span>
            </>
          )}
        </button>
      </div>

      <div className='tomni-glass-divider' />

      {/* Sign out */}
      <div style={{ padding: '0 8px' }}>
        <button type='button' className='tomni-glass-item' onClick={handleLogout} style={{ color: '#f87171' }}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon' style={{ color: '#f87171' }}>
              <Logout theme='outline' size={16} fill='currentColor' />
            </span>
            <span>{t('common.logout', { defaultValue: 'Đăng xuất' })}</span>
          </div>
        </button>
      </div>
    </div>
  );

  if (variant === 'home') {
    return (
      <Popover trigger='click' position='br' className='hub-account-popover' content={homeContent}>
        <button
          type='button'
          className='hub-account-trigger app-titlebar__no-drag'
          title={accountName}
          aria-label={accountName}
        >
          <span className='hub-account-avatar'>{accountInitials}</span>
        </button>
      </Popover>
    );
  }

  return (
    <Popover trigger='click' position='br' className='tomni-glass-popover-content' content={popoverContent}>
      <button
        type='button'
        className='app-titlebar__button app-titlebar__settings-btn app-titlebar__no-drag'
        title='Tài khoản & Menu nhanh'
        aria-label='Tài khoản & Menu nhanh'
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '2px 8px',
          height: '28px',
          borderRadius: '14px',
          background: 'rgba(255, 255, 255, 0.06)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: '#e2e8f0',
          cursor: 'pointer',
          transition: 'all 0.2s',
          margin: '0 2px',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#2563eb',
            color: '#fff',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {accountInitials}
        </span>
        <Down theme='outline' size={11} fill='currentColor' style={{ opacity: 0.7 }} />
      </button>
    </Popover>
  );
};

export default SettingsGlassDropdown;
