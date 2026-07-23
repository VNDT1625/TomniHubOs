/**
 * Generic chat-owned dock for lightweight app clips next to the composer.
 *
 * Team, Browser, Terminal, Preview and future surfaces register a dock item.
 * The dock owns ordering, compact rendering, panel lifecycle and toggle/action
 * dispatch so feature modules never need to rebuild the clip mechanism.
 *
 * Only four items are exposed as quick pins. Every visible item remains
 * reachable through the All popover, which also owns pin/unpin customization.
 */
import { Button, Drawer, Popover, Tag, Tooltip } from '@arco-design/web-react';
import { AllApplication, ApplicationOne } from '@icon-park/react';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type ChatDockItemMode = 'panel' | 'toggle' | 'action';

export type ChatDockItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  mode: ChatDockItemMode;
  visible?: boolean;
  disabled?: boolean;
  active?: boolean;
  order?: number;
  badge?: number | string;
  attentionBadge?: number | string;
  tooltip?: ReactNode;
  panel?: ReactNode;
  panelTitle?: ReactNode;
  panelWidth?: number;
  onActivate?: () => void;
  onOpenChange?: (open: boolean) => void;
  testId?: string;
};

type ChatDockContextValue = {
  upsert: (item: ChatDockItem) => void;
  remove: (id: string) => void;
  openPanelId: string | null;
  setPanelOpen: (id: string, open: boolean) => void;
};

const ChatDockContext = createContext<ChatDockContextValue | null>(null);

export const MAX_PINNED_CHAT_DOCK_ITEMS = 4;
const PINNED_CHAT_DOCK_STORAGE_KEY = 'tomny.chatDock.pinned.v1';

const normalizeItem = (item: ChatDockItem): ChatDockItem => ({
  ...item,
  visible: item.visible !== false,
  order: item.order ?? 100,
});

const normalizePinnedIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_PINNED_CHAT_DOCK_ITEMS);
};

const readPinnedIds = (): string[] | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PINNED_CHAT_DOCK_STORAGE_KEY);
    return raw === null ? null : normalizePinnedIds(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
};

const persistPinnedIds = (ids: string[]): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PINNED_CHAT_DOCK_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Quick-pin persistence is best effort and must never block chat rendering.
  }
};

export type ChatDockHostProps = {
  children: ReactNode;
};

/** Chat-level host. Feature modules only register items; this component owns all clip UI. */
export const ChatDockHost: React.FC<ChatDockHostProps> = ({ children }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<Map<string, ChatDockItem>>(() => new Map());
  const [openPanelId, setOpenPanelId] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(readPinnedIds);
  const [dockSlot, setDockSlot] = useState<HTMLElement | null>(null);
  const dockAnchorRef = useRef<HTMLSpanElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const upsert = useCallback((item: ChatDockItem): void => {
    const normalized = normalizeItem(item);
    setItems((current) => {
      const next = new Map(current);
      next.set(normalized.id, normalized);
      return next;
    });
  }, []);

  const remove = useCallback((id: string): void => {
    setItems((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    setOpenPanelId((current) => (current === id ? null : current));
  }, []);

  const setPanelOpen = useCallback((id: string, open: boolean): void => {
    const item = itemsRef.current.get(id);
    if (!item || item.mode !== 'panel' || item.visible === false || item.disabled) return;
    setOpenPanelId((current) => {
      const next = open ? id : current === id ? null : current;
      if (current !== next) {
        itemsRef.current.get(current ?? '')?.onOpenChange?.(false);
        item.onOpenChange?.(open);
      }
      return next;
    });
  }, []);

  const sortedItems = useMemo(
    () =>
      [...items.values()]
        .filter((item) => item.visible !== false)
        .toSorted((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.id.localeCompare(right.id)),
    [items]
  );
  const defaultPinnedIds = useMemo(
    () => sortedItems.slice(0, MAX_PINNED_CHAT_DOCK_ITEMS).map((item) => item.id),
    [sortedItems]
  );
  const resolvedPinnedIds = pinnedIds ?? defaultPinnedIds;
  const pinnedItems = useMemo(
    () =>
      resolvedPinnedIds
        .map((id) => items.get(id))
        .filter((item): item is ChatDockItem => Boolean(item && item.visible !== false))
        .slice(0, MAX_PINNED_CHAT_DOCK_ITEMS),
    [items, resolvedPinnedIds]
  );
  const pinnedItemIds = useMemo(() => new Set(pinnedItems.map((item) => item.id)), [pinnedItems]);
  const hiddenItemCount = Math.max(0, sortedItems.length - pinnedItems.length);
  const openItem = openPanelId ? items.get(openPanelId) : undefined;

  useEffect(() => {
    if (pinnedIds !== null) persistPinnedIds(pinnedIds);
  }, [pinnedIds]);

  useEffect(() => {
    if (!openPanelId || (openItem && openItem.visible !== false)) return;
    setOpenPanelId(null);
  }, [openItem, openPanelId]);

  useEffect(() => {
    if (sortedItems.length === 0) setAllOpen(false);
  }, [sortedItems.length]);

  useEffect(() => {
    const anchor = dockAnchorRef.current;
    if (!anchor) return;

    const findSlot = (): HTMLElement | null => {
      let ancestor: HTMLElement | null = anchor.parentElement;
      while (ancestor) {
        const slot = ancestor.querySelector<HTMLElement>('[data-chat-dock-slot]');
        if (slot) return slot;
        ancestor = ancestor.parentElement;
      }
      return null;
    };

    const syncSlot = () =>
      setDockSlot((current) => {
        const next = findSlot();
        return current === next ? current : next;
      });
    syncSlot();
    const observer = new MutationObserver(syncSlot);
    observer.observe(anchor.parentElement ?? document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const activate = (item: ChatDockItem): void => {
    if (item.disabled) return;
    if (item.mode === 'panel') {
      setPanelOpen(item.id, openPanelId !== item.id);
      return;
    }
    item.onActivate?.();
  };

  const togglePinned = (id: string): void => {
    const availableIds = new Set(sortedItems.map((item) => item.id));
    setPinnedIds((current) => {
      const base = (current ?? defaultPinnedIds).filter((candidate) => availableIds.has(candidate));
      if (base.includes(id)) return base.filter((candidate) => candidate !== id);
      if (base.length < MAX_PINNED_CHAT_DOCK_ITEMS) return [...base, id];
      return [...base.slice(0, MAX_PINNED_CHAT_DOCK_ITEMS - 1), id];
    });
  };

  const contextValue = useMemo<ChatDockContextValue>(
    () => ({ upsert, remove, openPanelId, setPanelOpen }),
    [openPanelId, remove, setPanelOpen, upsert]
  );

  const allMenu = (
    <div className='max-h-320px w-300px overflow-y-auto p-2px' data-testid='chat-dock-all-menu'>
      <div className='flex flex-col gap-4px'>
        {sortedItems.map((item) => {
          const active = item.mode === 'panel' ? openPanelId === item.id : item.active === true;
          const pinned = pinnedItemIds.has(item.id);
          return (
            <div key={item.id} className='flex items-center gap-4px rd-8px px-2px py-2px hover:bg-fill-2'>
              <Button
                type='text'
                size='small'
                disabled={item.disabled}
                className='min-w-0 flex-1 !justify-start !px-8px'
                icon={item.icon}
                onClick={() => {
                  setAllOpen(false);
                  activate(item);
                }}
                data-testid={`chat-dock-all-item-${item.id}`}
                aria-pressed={active}
              >
                <span className='min-w-0 flex-1 truncate text-left'>{item.label}</span>
                {item.badge !== undefined && item.badge !== 0 ? <Tag size='small'>{item.badge}</Tag> : null}
                {item.attentionBadge !== undefined && item.attentionBadge !== 0 ? (
                  <Tag size='small' color='red'>
                    {item.attentionBadge}
                  </Tag>
                ) : null}
              </Button>
              <Button
                type='text'
                size='mini'
                className='shrink-0 !px-7px'
                onClick={(event) => {
                  event.stopPropagation();
                  togglePinned(item.id);
                }}
                data-testid={`chat-dock-pin-${item.id}`}
                aria-pressed={pinned}
              >
                {pinned ? t('common.unpin') : t('common.pin')}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const dock =
    sortedItems.length > 0 ? (
      <div className='flex items-center gap-4px' data-testid='chat-dock'>
        {pinnedItems.map((item) => {
          const active = item.mode === 'panel' ? openPanelId === item.id : item.active === true;
          const accessibleLabel = typeof item.label === 'string' ? item.label : item.id;
          return (
            <Tooltip key={item.id} content={item.tooltip ?? item.label} mini>
              <Button
                size='mini'
                type={active ? 'primary' : 'secondary'}
                disabled={item.disabled}
                className='!h-28px !min-w-28px !px-6px'
                icon={item.icon ?? <ApplicationOne theme='outline' size={14} />}
                onClick={() => activate(item)}
                data-testid={item.testId ?? `chat-dock-item-${item.id}`}
                aria-label={accessibleLabel}
                aria-pressed={active}
              >
                {item.badge !== undefined && item.badge !== 0 ? <Tag size='small'>{item.badge}</Tag> : null}
                {item.attentionBadge !== undefined && item.attentionBadge !== 0 ? (
                  <Tag size='small' color='red'>
                    {item.attentionBadge}
                  </Tag>
                ) : null}
              </Button>
            </Tooltip>
          );
        })}
        <Popover trigger='click' position='top' content={allMenu} popupVisible={allOpen} onVisibleChange={setAllOpen}>
          <Tooltip content={t('common.all')} mini>
            <Button
              size='mini'
              type={allOpen ? 'primary' : 'secondary'}
              className='!h-28px !min-w-28px !px-6px'
              icon={<AllApplication theme='outline' size={14} />}
              data-testid='chat-dock-all'
              aria-label={t('common.all')}
              aria-expanded={allOpen}
            >
              {hiddenItemCount > 0 ? <Tag size='small'>{hiddenItemCount}</Tag> : null}
            </Button>
          </Tooltip>
        </Popover>
      </div>
    ) : null;

  return (
    <ChatDockContext.Provider value={contextValue}>
      {children}
      <span ref={dockAnchorRef} className='hidden' aria-hidden />
      {dockSlot && dock ? createPortal(dock, dockSlot) : dock}

      <Drawer
        width={openItem?.panelWidth ?? 520}
        visible={Boolean(openItem && openItem.mode === 'panel')}
        title={openItem?.panelTitle ?? openItem?.label}
        footer={null}
        onCancel={() => openItem && setPanelOpen(openItem.id, false)}
        unmountOnExit
      >
        {openItem?.panel}
      </Drawer>
    </ChatDockContext.Provider>
  );
};

/** Register or update one feature-owned item in the chat dock. */
export const useChatDockItem = (item: ChatDockItem): { isOpen: boolean; open: () => void; close: () => void } => {
  const context = useContext(ChatDockContext);
  if (!context) throw new Error('useChatDockItem must be used inside ChatDockHost.');
  const { upsert, remove, openPanelId, setPanelOpen } = context;
  const id = item.id;

  useEffect(() => {
    upsert(item);
  }, [item, upsert]);

  useEffect(() => () => remove(id), [id, remove]);

  return {
    isOpen: openPanelId === id,
    open: () => setPanelOpen(id, true),
    close: () => setPanelOpen(id, false),
  };
};

export default ChatDockHost;
