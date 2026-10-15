/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { SocialPlatform } from '@/common/types/social';
import styles from './Feed.module.css';

export interface FeedFilterPillsProps {
  selectedPlatform: 'all' | SocialPlatform;
  onSelectPlatform: (platform: 'all' | SocialPlatform) => void;
}

const PLATFORMS: Array<{ id: 'all' | SocialPlatform; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X / Twitter' },
  { id: 'threads', label: 'Threads' },
  { id: 'reddit', label: 'Reddit' },
];

export const FeedFilterPills: React.FC<FeedFilterPillsProps> = ({
  selectedPlatform,
  onSelectPlatform,
}) => {
  return (
    <div className={styles.pillsBar} role="tablist" aria-label="Lọc theo nền tảng">
      {PLATFORMS.map((p) => {
        const isActive = selectedPlatform === p.id;
        return (
          <button
            key={p.id}
            type="button"
            className={`${styles.pillButton} ${isActive ? styles.pillButtonActive : ''}`}
            onClick={() => onSelectPlatform(p.id)}
            role="tab"
            aria-selected={isActive}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
};
