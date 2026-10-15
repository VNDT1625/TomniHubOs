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
import type { IPlatformAdapter } from './types';

/**
 * A placeholder adapter for platforms where a transport has not yet been
 * implemented. It never fabricates posts, videos, or messages: data
 * can enter the Social cache only through a real platform connector.
 */
export class BasePlatformAdapter implements IPlatformAdapter {
  constructor(public readonly platform: SocialPlatform) {}

  async fetchFeed(_account: SocialAccount): Promise<UnifiedPost[]> {
    throw new Error('SOCIAL_CONNECTOR_UNAVAILABLE');
  }

  async fetchReels(_account: SocialAccount): Promise<UnifiedReel[]> {
    throw new Error('SOCIAL_CONNECTOR_UNAVAILABLE');
  }

  async fetchConversations(_account: SocialAccount): Promise<UnifiedConversation[]> {
    throw new Error('SOCIAL_CONNECTOR_UNAVAILABLE');
  }

  async fetchMessages(_account: SocialAccount, _threadId: string): Promise<UnifiedMessage[]> {
    throw new Error('SOCIAL_CONNECTOR_UNAVAILABLE');
  }

  async sendMessage(_account: SocialAccount, _conversationId: string, _content: string): Promise<UnifiedMessage> {
    throw new Error('SOCIAL_SEND_MESSAGE_TRANSPORT_UNAVAILABLE');
  }
}
