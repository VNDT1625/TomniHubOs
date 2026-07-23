/**
 * Chat surface host for docked feature clips and live browser/editor frames.
 *
 * ChatDock is the reusable mechanism. Team and Browser only register items;
 * future surfaces can do the same without duplicating clip, panel or toggle UI.
 */
import { isElectronDesktop } from '@/renderer/utils/platform';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { browserClient } from '@renderer/pages/browser/browserBridgeClient';
import { Compass } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatDockHost, useChatDockItem, type ChatDockItem } from '../ChatDock';
import { editorControlClient } from './editorControlClient';
import { useSuperMode } from '../../hooks/useSuperMode';
import LiveBrowserWatch from './LiveBrowserWatch';
import AgentMeshInlineCard from './AgentMeshInlineCard';

export type ConversationWatchOverlayProps = {
  conversationId?: string;
};

const TAB_POLL_MS = 1500;

const TabPoller: React.FC<{ onCount: (count: number) => void }> = ({ onCount }) => {
  useEffect(() => {
    let alive = true;
    const probe = () => {
      const browserP = browserClient
        .listTabs()
        .then((tabs) => (Array.isArray(tabs) ? tabs.filter((tab) => tab.background !== true).length : 0))
        .catch(() => 0);
      const editorP = editorControlClient
        .listFrames()
        .then((frames) => (Array.isArray(frames) ? frames.length : 0))
        .catch(() => 0);
      void Promise.all([browserP, editorP]).then(([browserCount, editorCount]) => {
        if (alive) onCount(browserCount + editorCount);
      });
    };
    probe();
    const timer = setInterval(probe, TAB_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [onCount]);
  return null;
};

type BrowserDockItemProps = {
  available: boolean;
  enabled: boolean;
  open: boolean;
  tabCount: number;
  onToggle: () => void;
};

/** Browser registers a toggle item; ChatDock owns the actual clip presentation. */
const BrowserDockItem: React.FC<BrowserDockItemProps> = ({ available, enabled, open, tabCount, onToggle }) => {
  const { t } = useTranslation();
  const item = useMemo<ChatDockItem>(
    () => ({
      id: 'browser',
      label: t('workspace.watchTitle'),
      icon: <Compass theme='outline' size={14} />,
      mode: 'toggle',
      order: 30,
      visible: available && enabled && tabCount > 0,
      active: open,
      badge: tabCount,
      onActivate: onToggle,
      testId: 'browser-watch-clip',
    }),
    [available, enabled, onToggle, open, t, tabCount]
  );
  useChatDockItem(item);
  return null;
};

const ConversationWatchOverlay: React.FC<ConversationWatchOverlayProps> = ({ conversationId }) => {
  const sup = useSuperMode(conversationId);
  const [open, setOpen] = useState(false);
  const [tabCount, setTabCount] = useState(0);
  const autoOpenedRef = useRef(false);
  const openRef = useRef(false);
  const superEnabledRef = useRef(sup.enabled);

  useEffect(() => {
    superEnabledRef.current = sup.enabled;
  }, [sup.enabled]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (conversationId) emitter.emit('super.watch.state', conversationId, open);
  }, [conversationId, open]);

  useAddEventListener(
    'super.watch.toggle',
    (id: string) => {
      if (id === conversationId) setOpen((value) => !value);
    },
    [conversationId]
  );
  useAddEventListener(
    'super.watch.set',
    (id: string, next: boolean) => {
      if (id === conversationId) setOpen(next);
    },
    [conversationId]
  );

  useEffect(() => {
    if (!sup.enabled) {
      setOpen(false);
      setTabCount(0);
      autoOpenedRef.current = false;
    }
  }, [sup.enabled]);
  useEffect(() => {
    setOpen(false);
    setTabCount(0);
    autoOpenedRef.current = false;
  }, [conversationId]);

  const handleTabCount = useCallback((count: number): void => {
    setTabCount(count);
    if (superEnabledRef.current && count > 0 && !openRef.current && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setOpen(true);
    }
    if (count === 0) autoOpenedRef.current = false;
  }, []);
  const toggleBrowser = useCallback(() => setOpen((value) => !value), []);

  if (!isElectronDesktop() || !conversationId) return null;

  return (
    <ChatDockHost>
      <AgentMeshInlineCard conversationId={conversationId} />
      <BrowserDockItem
        available={sup.available}
        enabled={sup.enabled}
        open={open}
        tabCount={tabCount}
        onToggle={toggleBrowser}
      />
      {sup.available ? (
        <>
          <LiveBrowserWatch
            open={sup.enabled && open}
            onClose={() => setOpen(false)}
            onTabCountChange={handleTabCount}
          />
          {sup.enabled && !open ? <TabPoller onCount={handleTabCount} /> : null}
        </>
      ) : null}
    </ChatDockHost>
  );
};

export default ConversationWatchOverlay;
