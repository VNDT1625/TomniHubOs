/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SocialDbInstance } from './socialDb';

export function runAutoEviction(
  db: SocialDbInstance,
  maxAgeMs: number = 48 * 3600 * 1000
): { evictedPosts: number; evictedReels: number } {
  const threshold = Date.now() - maxAgeMs;
  const evictedPosts = db.deleteViewedPostsOlderThan(threshold);
  const evictedReels = db.deleteViewedReelsOlderThan(threshold);

  return {
    evictedPosts,
    evictedReels,
  };
}

export function clearAllCache(db: SocialDbInstance): { clearedPosts: number; clearedReels: number } {
  return db.clearAllCache();
}
