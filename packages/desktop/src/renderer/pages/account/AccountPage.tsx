/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Message, Spin, Tooltip } from '@arco-design/web-react';
import { Briefcase, CheckOne, Key, Lock, Logout, Save, Shield, User, Wallet } from '@icon-park/react';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import {
  changeSupabasePassword,
  fetchTomProfile,
  updateTomProfile,
  type TomProfile,
} from '@/renderer/services/supabaseAuth';
import { TomCoinIcon } from '@/renderer/components/layout/Titlebar/TomBalanceWidget';
import TomWalletModal from '@/renderer/components/layout/Titlebar/TomWalletModal';
import styles from './AccountPage.module.css';

export const AccountPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, ready, logout } = useAuth();

  const [profile, setProfile] = useState<TomProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const activeAbortRef = useRef<AbortController | null>(null);

  // Form states
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password states
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Wallet modal state
  const [walletModalVisible, setWalletModalVisible] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) {
      if (isMountedRef.current) setLoadingProfile(false);
      return;
    }
    if (isMountedRef.current) {
      setLoadingProfile(true);
      setProfileError(null);
    }

    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;

    try {
      const data = await fetchTomProfile(user.id, undefined, {
        signal: controller.signal,
        timeoutMs: 5000,
      });
      if (isMountedRef.current) {
        if (data) {
          setProfile(data);
          setFullName(data.full_name || '');
          setCompanyName(data.company_name || '');
          setProfileError(null);
        } else {
          setProfileError('Không thể tải dữ liệu hồ sơ từ máy chủ.');
        }
      }
    } catch (err) {
      if (isMountedRef.current && (err as Error)?.name !== 'AbortError') {
        setProfileError((err as Error)?.message || 'Lỗi mạng khi kết nối hồ sơ.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingProfile(false);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    isMountedRef.current = true;
    if (ready) {
      if (user?.id) {
        void loadData();
      } else {
        setLoadingProfile(false);
      }
    }
    return () => {
      isMountedRef.current = false;
      activeAbortRef.current?.abort();
    };
  }, [loadData, ready, user?.id]);

  const accountInitial = useMemo(() => {
    const raw = (fullName || user?.username || 'Tomni').trim();
    return raw[0]?.toUpperCase() || 'T';
  }, [fullName, user?.username]);

  const tier = profile?.tier || 'free';
  const role = profile?.role || 'member';
  const balance = profile?.balance_tom ?? 5.0;

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    setSavingProfile(true);
    try {
      const res = await updateTomProfile(user.id, {
        full_name: fullName.trim(),
        company_name: companyName.trim(),
      });
      if (res.success) {
        Message.success('Cập nhật thông tin hồ sơ thành công!');
        void loadData();
      } else {
        Message.error(res.message || 'Cập nhật thất bại.');
      }
    } catch {
      Message.error('Có lỗi xảy ra khi lưu thông tin.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!newPassword) {
      Message.warning('Vui lòng nhập mật khẩu mới.');
      return;
    }
    if (newPassword.length < 6) {
      Message.warning('Mật khẩu mới phải có tối thiểu 6 ký tự.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Message.warning('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSavingPassword(true);
    try {
      const res = await changeSupabasePassword(newPassword);
      if (res.success) {
        Message.success(res.message);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        Message.error(res.message);
      }
    } catch {
      Message.error('Không thể cập nhật mật khẩu.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    void navigate('/login', { replace: true });
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>
          <User theme='outline' size={28} />
          <span>Hồ sơ & Tài khoản người dùng</span>
        </h1>
        <p className={styles.subtitle}>
          Quản lý thông tin định danh, cấp bậc tài khoản, bảo mật và phân quyền hệ thống.
        </p>
      </div>

      {/* Main Profile & Tier Banner */}
      <div className={styles.profileCard}>
        <div className={styles.avatarWrapper}>
          <div className={styles.avatar}>{accountInitial}</div>
        </div>

        <div className={styles.infoCol}>
          <div className={styles.nameRow}>
            <span className={styles.displayName}>{fullName || user?.username || 'Người dùng Tomni'}</span>

            {/* Badges */}
            <div className={styles.badgesRow}>
              {/* Tier Badge */}
              <Tooltip
                content={
                  tier === 'enterprise'
                    ? 'Gói Doanh nghiệp: Toàn bộ tính năng mở rộng & tài nguyên chuyên dụng'
                    : tier === 'pro'
                      ? 'Gói Pro: Tăng tốc Agent, ưu tiên mô hình AI & toàn quyền Package Store'
                      : 'Gói Miễn phí: Mô hình tiêu chuẩn & 5.00 TOM khởi tạo'
                }
              >
                <span
                  className={`${styles.tierBadge} ${
                    tier === 'enterprise' ? styles.tierEnterprise : tier === 'pro' ? styles.tierPro : styles.tierFree
                  }`}
                >
                  {tier}
                </span>
              </Tooltip>

              {/* Role Badge */}
              <Tooltip
                content={
                  role === 'admin'
                    ? 'Vai trò Quản trị viên: Toàn quyền cấu hình, bảo mật và quản trị toàn hệ thống'
                    : role === 'manager'
                      ? 'Vai trò Quản lý: Quản lý workspace, dự án và điều phối tác vụ'
                      : 'Vai trò Thành viên: Sử dụng các tính năng và công cụ AI'
                }
              >
                <span
                  className={`${styles.roleBadge} ${
                    role === 'admin' ? styles.roleAdmin : role === 'manager' ? styles.roleManager : styles.roleMember
                  }`}
                >
                  {role}
                </span>
              </Tooltip>
            </div>
          </div>

          <div className={styles.emailRow}>
            <span>{user?.email || 'Chưa liên kết email'}</span>
            <span style={{ opacity: 0.4 }}>•</span>
            <span>ID: {user?.id?.slice(0, 8)}...</span>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            type='outline'
            size='small'
            icon={<Wallet theme='outline' size={14} />}
            onClick={() => setWalletModalVisible(true)}
            style={{ borderRadius: '8px' }}
          >
            Ví TOM ({balance.toFixed(2)})
          </Button>
          <Button
            type='secondary'
            status='danger'
            size='small'
            icon={<Logout theme='outline' size={14} />}
            onClick={handleLogout}
            style={{ borderRadius: '8px' }}
          >
            Đăng xuất
          </Button>
        </div>
      </div>

      {/* Grid of Sections */}
      <div className={styles.grid}>
        {/* Section 1: Edit Profile */}
        <div className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            <Briefcase theme='outline' size={18} />
            <span>Thông tin cá nhân & Doanh nghiệp</span>
          </h2>

          <Spin loading={loadingProfile} style={{ width: '100%' }}>
            {profileError && !loadingProfile && (
              <div
                style={{
                  marginBottom: 16,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>{profileError}</span>
                <Button size='mini' type='text' status='danger' onClick={() => void loadData()}>
                  Thử lại
                </Button>
              </div>
            )}
            <div className={styles.formItem}>
              <label className={styles.label}>Họ và tên hiển thị (full_name)</label>
              <Input
                prefix={<User theme='outline' size={14} />}
                placeholder='Nhập họ và tên đầy đủ của bạn'
                value={fullName}
                onChange={setFullName}
                allowClear
              />
            </div>

            <div className={styles.formItem}>
              <label className={styles.label}>Tên công ty / Tổ chức (company_name)</label>
              <Input
                prefix={<Briefcase theme='outline' size={14} />}
                placeholder='Ví dụ: Tomni AI Corp, Đại học NTT...'
                value={companyName}
                onChange={setCompanyName}
                allowClear
              />
            </div>

            <div style={{ marginTop: '20px' }}>
              <Button
                type='primary'
                icon={<Save theme='outline' size={14} />}
                loading={savingProfile}
                onClick={handleSaveProfile}
                style={{ borderRadius: '8px', width: '100%' }}
              >
                Lưu thông tin hồ sơ
              </Button>
            </div>
          </Spin>
        </div>

        {/* Section 2: Change Password */}
        <div className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            <Lock theme='outline' size={18} />
            <span>Đổi mật khẩu tài khoản</span>
          </h2>

          <div className={styles.formItem}>
            <label className={styles.label}>Mật khẩu mới</label>
            <Input.Password
              prefix={<Key theme='outline' size={14} />}
              placeholder='Tối thiểu 6 ký tự'
              value={newPassword}
              onChange={setNewPassword}
            />
          </div>

          <div className={styles.formItem}>
            <label className={styles.label}>Xác nhận mật khẩu mới</label>
            <Input.Password
              prefix={<CheckOne theme='outline' size={14} />}
              placeholder='Nhập lại mật khẩu mới'
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
          </div>

          <div style={{ marginTop: '20px' }}>
            <Button
              type='outline'
              icon={<Shield theme='outline' size={14} />}
              loading={savingPassword}
              onClick={handleChangePassword}
              style={{ borderRadius: '8px', width: '100%' }}
            >
              Cập nhật mật khẩu mới
            </Button>
          </div>
        </div>

        {/* Section 3: TOM Wallet Overview */}
        <div className={styles.sectionCard} style={{ gridColumn: '1 / -1' }}>
          <h2 className={styles.sectionTitle}>
            <Wallet theme='outline' size={18} />
            <span>Tổng quan Ví TOM & Hạn mức</span>
          </h2>

          <div className={styles.walletBanner}>
            <div className={styles.walletInfo}>
              <span style={{ fontSize: '13px', color: '#cbd5e1' }}>Số dư khả dụng</span>
              <div className={styles.walletAmount}>
                <TomCoinIcon size={22} />
                <span>{balance.toFixed(2)} TOM</span>
              </div>
              <span className={styles.walletEquivalent}>
                Tương đương ${balance.toFixed(2)} USD (Tỷ giá 1 TOM = $1.00 USD)
              </span>
            </div>

            <Button
              type='primary'
              size='large'
              icon={<Wallet theme='outline' size={16} />}
              onClick={() => setWalletModalVisible(true)}
              style={{
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: 'none',
                fontWeight: 600,
              }}
            >
              Quản lý Ví & Lịch sử Giao dịch
            </Button>
          </div>
        </div>
      </div>

      {/* Wallet & Transactions Modal */}
      <TomWalletModal
        visible={walletModalVisible}
        onClose={() => {
          setWalletModalVisible(false);
          void loadData();
        }}
      />
    </div>
  );
};

export default AccountPage;
