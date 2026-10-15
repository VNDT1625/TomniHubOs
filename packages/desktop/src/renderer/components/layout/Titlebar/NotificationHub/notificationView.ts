/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HubNotification } from '@/common/types/platform/notificationHub';

/** Search text and unread switch of a notification list. */
export type FeedFilter = { unreadOnly: boolean; text: string };

export const EMPTY_FILTER: FeedFilter = { unreadOnly: false, text: '' };

export const filterFeed = <T extends HubNotification>(items: readonly T[], filter: FeedFilter): T[] => {
  const needle = filter.text.trim().toLowerCase();
  return items.filter(
    (item) =>
      (!filter.unreadOnly || !item.read) &&
      (!needle ||
        `${item.title}\n${item.sender ?? ''}\n${item.sourceLabel}\n${item.account ?? ''}`
          .toLowerCase()
          .includes(needle))
  );
};
