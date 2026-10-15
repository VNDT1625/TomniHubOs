/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import type { SocialPlatform, SocialPermissions } from '@/common/types/social';
import styles from './Settings.module.css';

export interface AddAccountFormData {
  username: string;
  displayName?: string;
  permissions: SocialPermissions;
  launchLogin?: boolean;
}

export interface PermissionModalProps {
  isOpen: boolean;
  platform: SocialPlatform;
  onConfirm: (data: AddAccountFormData) => void;
  onCancel: () => void;
}

export const PermissionModal: React.FC<PermissionModalProps> = ({
  isOpen,
  platform,
  onConfirm,
  onCancel,
}) => {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [canReadFeed, setCanReadFeed] = useState(true);
  const [canReadMessages, setCanReadMessages] = useState(true);
  const [launchLogin, setLaunchLogin] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const trimmed = username.trim().replace(/^@+/, '');
    if (!trimmed) {
      setError('Vui lòng nhập Username hoặc Handle tài khoản');
      return;
    }
    setError(null);
    onConfirm({
      username: trimmed,
      displayName: displayName.trim() || undefined,
      permissions: {
        canSyncFeed: canReadFeed,
        canSyncReels: canReadFeed,
        canReadMessages,
        canSendMessages: canReadMessages,
      },
      launchLogin,
    });
  };

  return (
    <div className={styles.modalBackdrop}>
      <div className={styles.modalDialog} role="dialog" aria-modal="true">
        <header className={styles.modalHeader}>
          <span className={styles.modalTitle}>
            Ủy quyền truy cập {platform.toUpperCase()}
          </span>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #475569)', lineHeight: 1.5 }}>
            TomniHubOS quản lý phiên đăng nhập trong vùng nhớ cô lập riêng biệt. Nhập định danh tài khoản thực của bạn:
          </p>

          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="social-input-username">
              Username / Handle <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              id="social-input-username"
              type="text"
              className={styles.textInput}
              placeholder="ví dụ: johndoe hoặc @johndoe"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
            />
            {error && <span className={styles.inputError}>{error}</span>}
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.inputLabel} htmlFor="social-input-displayname">
              Tên hiển thị (Tùy chọn)
            </label>
            <input
              id="social-input-displayname"
              type="text"
              className={styles.textInput}
              placeholder="ví dụ: John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={canReadFeed}
                  onChange={(e) => setCanReadFeed(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Đồng bộ Bảng tin & Reels</span>
              </label>
              <div className={styles.toggleDesc} style={{ marginTop: 2 }}>
                Lưu trữ và phân phối bài viết, video ngắn trên thiết bị cục bộ.
              </div>
            </div>

            <div>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={canReadMessages}
                  onChange={(e) => setCanReadMessages(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Đồng bộ Hộp thư Tin nhắn</span>
              </label>
              <div className={styles.toggleDesc} style={{ marginTop: 2 }}>
                Nhận và gửi phản hồi tin nhắn trực tiếp qua Messenger hợp nhất.
              </div>
            </div>

            <div>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={launchLogin}
                  onChange={(e) => setLaunchLogin(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Mở trình duyệt đăng nhập bảo mật ngay</span>
              </label>
              <div className={styles.toggleDesc} style={{ marginTop: 2 }}>
                Mở cửa sổ Electron với phiên cô lập để bạn đăng nhập trực tiếp trên {platform.toUpperCase()}.
              </div>
            </div>
          </div>
        </div>

        <footer className={styles.modalFooter}>
          <button
            type="button"
            className={styles.outlineButton}
            onClick={onCancel}
          >
            Hủy
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleConfirm}
            aria-label="Tiếp tục đăng nhập"
          >
            Tiếp tục đăng nhập
          </button>
        </footer>
      </div>
    </div>
  );
};
