/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { openSocialPermalink } from '../openSocialPermalink';
import styles from './Reels.module.css';

export type ReelCommentsDrawerProps = {
  isOpen: boolean;
  permalink: string;
  onClose: () => void;
};

/**
 * Comments require a platform-authorized transport. Never render fabricated
 * comments or claim a comment was posted without a provider receipt.
 */
export const ReelCommentsDrawer: React.FC<ReelCommentsDrawerProps> = ({ isOpen, permalink, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className={styles.drawerOverlay}>
      <header className={styles.drawerHeader}>
        <span className={styles.drawerTitle}>Bình luận</span>
        <button type='button' className={styles.closeButton} onClick={onClose} aria-label='Đóng'>
          <X size={18} />
        </button>
      </header>
      <div className={styles.drawerBody}>
        <p>Chưa có kết nối API bình luận. Hãy mở bài đăng gốc để xem hoặc gửi bình luận thật.</p>
      </div>
      <footer className={styles.drawerFooter}>
        <button
          type='button'
          className={styles.sendButton}
          onClick={() => openSocialPermalink(permalink)}
          aria-label='Mở bình luận gốc'
        >
          <ExternalLink size={14} />
          Mở bình luận gốc
        </button>
      </footer>
    </div>
  );
};

export default ReelCommentsDrawer;
