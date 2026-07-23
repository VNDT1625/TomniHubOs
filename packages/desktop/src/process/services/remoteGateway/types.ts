import type { ISendMessageResult } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';
import type { NativeSendMessageParams } from '@process/services/database/nativeConversation/service';

export type TomniRemoteEventKind = 'core' | 'conversation.response' | 'conversation.completed' | 'conversation.list';
export type TomniRemoteEvent = { sequence: number; timestamp: number; kind: TomniRemoteEventKind; payload: unknown };
export type TomniRemoteEventPayload = { kind: TomniRemoteEventKind; payload: unknown };
export type TomniRemoteConversationPort = {
  list: (cursor?: string, limit?: number) => Promise<{ items: TChatConversation[]; total: number; has_more: boolean }>;
  history: (
    conversationId: string,
    page?: number,
    pageSize?: number,
    order?: string
  ) => Promise<{ items: TMessage[]; total: number; has_more: boolean }>;
  send: (params: NativeSendMessageParams) => Promise<ISendMessageResult>;
  cancel: (conversationId: string) => Promise<void>;
};
export type TomniRemoteGatewayConfig = { language: string; publicUrl?: string };
