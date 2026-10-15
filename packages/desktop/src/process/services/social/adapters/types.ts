/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SocialAccount,
  SocialPlatform,
  UnifiedPost,
  UnifiedReel,
  UnifiedConversation,
  UnifiedMessage,
} from '@/common/types/social';

export interface IPlatformAdapter {
  readonly platform: SocialPlatform;
  fetchFeed(account: SocialAccount): Promise<UnifiedPost[]>;
  fetchReels(account: SocialAccount): Promise<UnifiedReel[]>;
  fetchConversations(account: SocialAccount): Promise<UnifiedConversation[]>;
  fetchMessages(account: SocialAccount, threadId: string): Promise<UnifiedMessage[]>;
  sendMessage(account: SocialAccount, conversationId: string, content: string): Promise<UnifiedMessage>;
}
