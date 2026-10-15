import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { Message, Modal } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

/** Removes one chat and tells the rest of the app; false when it could not be removed. */
const removeChat = async (conversationId: string): Promise<boolean> => {
  const removed = await ipcBridge.conversation.remove.invoke({ id: conversationId });
  if (!removed) return false;
  emitter.emit('conversation.deleted', conversationId);
  return true;
};

const MODAL_STYLE = {
  style: { borderRadius: '12px' },
  alignCenter: true,
  getPopupContainer: () => document.body,
} as const;

/**
 * Deletes one chat from the sidebar after the same confirmation the chat history uses. Leaves the chat page
 * when the deleted chat is the one on screen, and tells the rest of the app through the same events.
 */
export const useDeleteChat = (onDeletedCurrent: () => void): ((conversationId: string) => void) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return useCallback(
    (conversationId: string): void => {
      Modal.confirm({
        title: t('conversation.history.deleteTitle'),
        content: t('conversation.history.deleteConfirm'),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            if (!(await removeChat(conversationId))) {
              Message.error(t('conversation.history.deleteFailed'));
              return;
            }
            emitter.emit('chat.history.refresh');
            if (pathname === `/conversation/${conversationId}`) onDeletedCurrent();
            Message.success(t('conversation.history.deleteSuccess'));
          } catch {
            Message.error(t('conversation.history.deleteFailed'));
          }
        },
        ...MODAL_STYLE,
      });
    },
    [onDeletedCurrent, pathname, t]
  );
};

/**
 * Deletes several chats chosen in the sidebar's select mode after one confirmation. `done` always runs when the
 * attempt ends (so the caller can leave select mode); only the chats really removed are announced and counted.
 */
export const useDeleteChats = (
  onDeletedCurrent: () => void
): ((conversationIds: readonly string[], done: () => void) => void) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return useCallback(
    (conversationIds: readonly string[], done: () => void): void => {
      if (conversationIds.length === 0) return;
      Modal.confirm({
        title: t('conversation.history.batchDelete'),
        content: t('conversation.history.batchDeleteConfirm', { count: conversationIds.length }),
        okText: t('conversation.history.confirmDelete'),
        cancelText: t('conversation.history.cancelDelete'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          try {
            const results = await Promise.all(conversationIds.map((id) => removeChat(id).catch(() => false)));
            const removedIds = conversationIds.filter((_, index) => results[index]);
            if (removedIds.length === 0) {
              Message.error(t('conversation.history.deleteFailed'));
              return;
            }
            emitter.emit('chat.history.refresh');
            if (removedIds.some((id) => pathname === `/conversation/${id}`)) onDeletedCurrent();
            Message.success(t('conversation.history.batchDeleteSuccess', { count: removedIds.length }));
          } catch {
            Message.error(t('conversation.history.deleteFailed'));
          } finally {
            done();
          }
        },
        ...MODAL_STYLE,
      });
    },
    [onDeletedCurrent, pathname, t]
  );
};
