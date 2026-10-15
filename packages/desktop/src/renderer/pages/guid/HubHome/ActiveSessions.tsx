import { AllApplication, CheckCorrect, Compass, Delete, MessageOne, Terminal } from '@icon-park/react';
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LiveSessionDisplay } from '@/common/liveSessions/model';
import { CHAT_APP_ID, type ActiveAppRow, type ActiveOpenTarget, type ActiveSessionRow } from './activeSessionsModel';

const STATUS_TEXT_KEY: Record<LiveSessionDisplay, string> = {
  working: 'guid.hubHome.shell.statusWorking',
  idle: 'guid.hubHome.shell.statusIdle',
  attention: 'guid.hubHome.shell.statusAttention',
  error: 'guid.hubHome.shell.statusError',
  dormant: 'guid.hubHome.shell.statusDormant',
  suspended: 'guid.hubHome.shell.statusSuspended',
};

const AppIcon: React.FC<{ icon: string }> = ({ icon }) => {
  const props = { theme: 'outline' as const, size: 14, fill: 'currentColor' };
  if (icon === 'chat') return <MessageOne {...props} />;
  if (icon === 'browser') return <Compass {...props} />;
  if (icon === 'terminal') return <Terminal {...props} />;
  return <AllApplication {...props} />;
};

type ActiveSessionsProps = {
  rows: readonly ActiveAppRow[];
  onOpen: (target: ActiveOpenTarget) => void;
  /** Delete one chat (the host confirms first). Without it no delete button is drawn. */
    onDeleteChat?: (conversationId: string) => void;
  onShowChat?: (conversationId: string) => void;
  onRenameChat?: (conversationId: string, name: string) => void;
  onForkChat?: (conversationId: string) => void;
  onExportChat?: (conversationId: string) => void;
  /**
   * Delete the ticked chats in one go (the host confirms first) and call `done` when the attempt ends so select
   * mode closes. Without it the Chat row has no select toggle.
   */
  onDeleteChats?: (conversationIds: string[], done: () => void) => void;
  /** Add a session to an app ("+" on its row, shown when the app supports it). */
  onCreateSession?: (appId: string) => void;
  /** Close one session of an app ("x" on the session, shown when the app supports it). */
  onCloseSession?: (appId: string, sessionId: string) => void;
};

/** Apps that hold at least one live session; each expands to its sessions, coloured by status. */
export const ActiveSessions: React.FC<ActiveSessionsProps> = ({
  rows,
  onOpen,
    onDeleteChat,
  onShowChat,
  onRenameChat,
  onForkChat,
  onExportChat,
  onDeleteChats,
  onCreateSession,
  onCloseSession,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [selecting, setSelecting] = useState(false);
    const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [chatMenu, setChatMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!chatMenu) return;
    const close = () => setChatMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', escape);
    };
  }, [chatMenu]);
  const openChatMenu = (id: string, name: string, x: number, y: number): void => {
    setChatMenu({ id, name, x: Math.min(Math.max(8, x), window.innerWidth - 210), y: Math.min(Math.max(8, y), window.innerHeight - 235) });
  };

  const chatRow = rows.find((row) => row.appId === CHAT_APP_ID);
  // Ticks follow the visible list: a chat that is gone can no longer be deleted by accident.
  const tickedIds = (chatRow?.groups ?? [])
    .flatMap((group) => group.sessions)
    .flatMap((session) => (session.open.kind === 'conversation' ? [session.open.id] : []))
    .filter((id) => ticked.has(id));
  const allChatIds = (chatRow?.groups ?? [])
    .flatMap((group) => group.sessions)
    .flatMap((session) => (session.open.kind === 'conversation' ? [session.open.id] : []));
  const leaveSelectMode = (): void => {
    setSelecting(false);
    setTicked(new Set());
  };
  // Keyboard shortcuts of select mode, heard from anywhere inside the Chat section:
  // Ctrl/Cmd+A ticks every chat, Delete/Backspace deletes the ticked ones (after the usual confirmation),
  // Escape leaves select mode.
  const handleSelectKeys = (event: React.KeyboardEvent): void => {
    if (!selecting || !onDeleteChats) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setTicked(new Set(allChatIds));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (event.repeat || tickedIds.length === 0) return;
      event.preventDefault();
      onDeleteChats(tickedIds, leaveSelectMode);
    } else if (event.key === 'Escape') {
      leaveSelectMode();
    }
  };
  const toggleTick = (id: string): void =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) return <div className='hub-agents-empty'>{t('guid.hubHome.shell.activeEmpty')}</div>;

  const renderSession = (session: ActiveSessionRow, deep: boolean): React.ReactNode => {
    const chatId = session.open.kind === 'conversation' ? session.open.id : undefined;
    const choosing = selecting && chatId !== undefined;
    return (
      <div key={session.key} className='hub-active-row'>
        {choosing && (
          <input
            type='checkbox'
            className='hub-active-check'
            data-testid={`hub-active-check-${session.key}`}
            aria-label={session.title}
            checked={ticked.has(chatId)}
            onChange={() => toggleTick(chatId)}
          />
        )}
        <button
          type='button'
          className={`hub-nav-item hub-nav-item--nested ${deep ? 'hub-nav-item--deep' : ''}`}
          data-hub-status={session.display}
          data-testid={`hub-active-session-${session.key}`}
          title={`${session.title} · ${t(STATUS_TEXT_KEY[session.display])}`}
          aria-label={`${session.title}, ${t(STATUS_TEXT_KEY[session.display])}`}
                     onClick={() => (choosing ? toggleTick(chatId) : onOpen(session.open))}
           onContextMenu={chatId && !selecting ? (event) => {
             event.preventDefault();
             openChatMenu(chatId, session.title, event.clientX, event.clientY);
           } : undefined}
        >
          <span className='hub-status-dot' aria-hidden='true' />
          <span className='hub-n-label hub-status-name'>{session.title}</span>
          {session.detail && <span className='hub-active-detail'>{session.detail}</span>}
        </button>
                 {chatId !== undefined && !selecting && (onShowChat || onRenameChat || onForkChat || onExportChat || onDeleteChat) && (
           <button
             type='button'
             className='hub-active-menu-trigger'
             data-testid={`hub-active-menu-${session.key}`}
             aria-label={`${t('common.more', { defaultValue: 'Thao tác' })}: ${session.title}`}
             aria-haspopup='menu'
             aria-expanded={chatMenu?.id === chatId}
             onClick={(event) => {
               event.stopPropagation();
               const rect = event.currentTarget.getBoundingClientRect();
               if (chatMenu?.id === chatId) setChatMenu(null);
               else openChatMenu(chatId, session.title, rect.right, rect.bottom + 4);
             }}
           >
             <MoreHorizontal size={15} aria-hidden='true' />
           </button>
         )}
         {chatId !== undefined && onDeleteChat && !selecting && (
          <button
            type='button'
            className='hub-active-delete'
            data-testid={`hub-active-delete-${session.key}`}
            title={t('conversation.history.deleteTitle')}
            aria-label={`${t('conversation.history.deleteTitle')}: ${session.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteChat(chatId);
            }}
          >
            <Delete theme='outline' size={13} fill='currentColor' aria-hidden='true' />
          </button>
        )}
        {session.canClose && onCloseSession && session.open.kind === 'package' && (
          <button
            type='button'
            className='hub-active-close'
            data-testid={`hub-active-close-${session.key}`}
            title={t('guid.hubHome.layout.closeTab')}
            aria-label={`${t('guid.hubHome.layout.closeTab')}: ${session.title}`}
            onClick={(event) => {
              event.stopPropagation();
              if (session.open.kind === 'package') onCloseSession(session.open.appId, session.open.sessionId);
            }}
          >
            <X size={13} strokeWidth={1.75} aria-hidden='true' />
          </button>
        )}
      </div>
    );
  };

    return (
    <>
      {chatMenu && createPortal(
        <div className='hub-active-chat-menu' role='menu' data-testid='hub-active-chat-menu'
          style={{ position: 'fixed', left: chatMenu.x, top: chatMenu.y }}
          onClick={(event) => event.stopPropagation()}>
          {([
            ['show', 'Hiển thị ô Agent', onShowChat],
            ['rename', 'Đổi tên tab', onRenameChat],
            ['fork', 'Fork chat', onForkChat],
            ['export', 'Export chat', onExportChat],
            ['delete', t('conversation.history.deleteTitle'), onDeleteChat],
          ] as const).map(([key, title, callback]) => callback && (
            <button key={key} type='button' role='menuitem' data-testid={`hub-active-menu-action-${key}`}
              className={key === 'delete' ? 'hub-active-chat-menu__danger' : ''}
              onClick={() => {
                setChatMenu(null);
                                if (key === 'show') onShowChat?.(chatMenu.id);
                else if (key === 'rename') onRenameChat?.(chatMenu.id, chatMenu.name);
                else if (key === 'fork') onForkChat?.(chatMenu.id);
                else if (key === 'export') onExportChat?.(chatMenu.id);
                else onDeleteChat?.(chatMenu.id);
              }}>{title}</button>
          ))}
        </div>, document.body
      )}
      {rows.map((row) => {
        const open = expanded.get(row.appId) ?? false;
        const statusText = t(STATUS_TEXT_KEY[row.display]);
        return (
          <div
            key={row.appId}
            className='hub-workspace-group'
            data-hub-status={row.display}
            onKeyDown={row.appId === CHAT_APP_ID ? handleSelectKeys : undefined}
          >
            <div className='hub-workspace-folder-row'>
              <button
                type='button'
                className='hub-workspace-toggle'
                data-testid={`hub-active-toggle-${row.appId}`}
                aria-expanded={open}
                aria-label={t(open ? 'guid.hubHome.shell.collapseApp' : 'guid.hubHome.shell.expandApp', {
                  name: row.title,
                })}
                onClick={() => setExpanded((current) => new Map(current).set(row.appId, !open))}
              >
                {open ? (
                  <ChevronDown size={14} strokeWidth={1.75} aria-hidden='true' />
                ) : (
                  <ChevronRight size={14} strokeWidth={1.75} aria-hidden='true' />
                )}
              </button>
              <button
                type='button'
                className='hub-nav-item'
                data-testid={`hub-active-app-${row.appId}`}
                title={`${row.title} · ${statusText}`}
                onClick={() => setExpanded((current) => new Map(current).set(row.appId, !open))}
              >
                <span className='hub-n-icon'>
                  <AppIcon icon={row.icon} />
                </span>
                <span className='hub-status-dot' aria-hidden='true' />
                <span className='hub-n-label hub-status-name'>{row.title}</span>
                <span className='hub-active-count'>{row.count}</span>
              </button>
              {row.canCreate && onCreateSession && (
                <button
                  type='button'
                  className='hub-active-add'
                  data-testid={`hub-active-add-${row.appId}`}
                  title={t('guid.hubHome.layout.addTab')}
                  aria-label={`${t('guid.hubHome.layout.addTab')}: ${row.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateSession(row.appId);
                  }}
                >
                  <Plus size={13} strokeWidth={1.75} aria-hidden='true' />
                </button>
              )}
              {row.appId === CHAT_APP_ID && onDeleteChats && (
                <button
                  type='button'
                  className={`hub-active-select ${selecting ? 'hub-active-select--on' : ''}`}
                  data-testid={`hub-active-select-${row.appId}`}
                  aria-pressed={selecting}
                  title={t(selecting ? 'conversation.history.batchModeExit' : 'conversation.history.batchManage')}
                  aria-label={t(selecting ? 'conversation.history.batchModeExit' : 'conversation.history.batchManage')}
                  onClick={() => (selecting ? leaveSelectMode() : setSelecting(true))}
                >
                  <CheckCorrect theme='outline' size={13} fill='currentColor' aria-hidden='true' />
                </button>
              )}
            </div>
            {open &&
              row.groups.map((group, index) => (
                <React.Fragment key={group.name ?? `loose-${index}`}>
                  {group.name && <div className='hub-active-group-label'>{group.name}</div>}
                  {group.sessions.map((session) => renderSession(session, Boolean(group.name)))}
                </React.Fragment>
              ))}
            {open && selecting && row.appId === CHAT_APP_ID && onDeleteChats && (
              <div className='hub-active-batchbar'>
                <span className='hub-active-batchinfo'>
                  <span data-testid='hub-active-batch-count' className='hub-active-batchcount'>
                    {t('conversation.history.selectedCount', { count: tickedIds.length })}
                  </span>
                  <span data-testid='hub-active-batch-hint' className='hub-active-batchhint'>
                    {t('guid.hubHome.shell.selectHint')}
                  </span>
                </span>
                <button
                  type='button'
                  className='hub-active-batchdelete'
                  data-testid='hub-active-batch-delete'
                  disabled={tickedIds.length === 0}
                  onClick={() => onDeleteChats(tickedIds, leaveSelectMode)}
                >
                  {t('conversation.history.batchDelete')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
