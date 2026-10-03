/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Popover, Tooltip } from '@arco-design/web-react';
import { Down, Gift, Logout, Moon, Pic, Robot, SettingTwo, Shield, SunOne, User } from '@icon-park/react';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { changeLanguage } from '@/renderer/services/i18n';
import '@/renderer/styles/glassmorphism.css';

const LANGUAGE_OPTIONS = [
  { code: 'vi-VN', shortLabel: 'VI', label: 'Tiếng Việt' },
  { code: 'en-US', shortLabel: 'EN', label: 'English' },
  { code: 'zh-CN', shortLabel: '中', label: '简体中文' },
  { code: 'ja-JP', shortLabel: '日', label: '日本語' },
] as const;

export const SettingsGlassDropdown: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useThemeContext();

  const toggleTheme = useCallback(() => {
    void setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  const accountName = useMemo(() => {
    return user?.username || 'Tomni User';
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

        <button type='button' className='tomni-glass-item' onClick={() => handleNavigate('/settings/model')}>
          <div className='tomni-glass-item-left'>
            <span className='tomni-glass-item-icon'>
              <SettingTwo theme='outline' size={16} fill='currentColor' />
            </span>
            <span>Cài đặt hệ thống</span>
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
