/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

export const socialChannels = {
  LIST_ACCOUNTS: 'social:account:list',
  ADD_ACCOUNT: 'social:account:add',
  CONNECT_ACCOUNT: 'social:account:connect',
  REMOVE_ACCOUNT: 'social:account:remove',
  UPDATE_PERMISSIONS: 'social:account:updatePermissions',
  OPEN_LOGIN_WINDOW: 'social:account:openLogin',
  SHOW_WEB: 'social:web:show',
  HIDE_WEB: 'social:web:hide',
  RELOAD_WEB: 'social:web:reload',
  GET_FEED_QUEUE: 'social:feed:getQueue',
  REFRESH_FEED: 'social:feed:refresh',
  MARK_POST_VIEWED: 'social:feed:markViewed',
  GET_REELS_QUEUE: 'social:reels:getQueue',
  REFRESH_REELS: 'social:reels:refresh',
  MARK_REEL_VIEWED: 'social:reels:markViewed',
  GET_CONVERSATIONS: 'social:messages:getConversations',
  REFRESH_CONVERSATIONS: 'social:messages:refreshConversations',
  GET_THREAD: 'social:messages:getThread',
  REFRESH_THREAD: 'social:messages:refreshThread',
  SEND_MESSAGE: 'social:messages:send',
  GET_STORAGE_STATS: 'social:storage:getStats',
  CLEAR_CACHE: 'social:storage:clearCache',
} as const;

export type SocialChannelKey = keyof typeof socialChannels;
