import type { HubActivityItem, HubActivityStatus } from '@/common/types/agent/hubActivity';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Message } from '@arco-design/web-react';

import { AllApplication, Cycle, FolderOpen, People } from '@icon-park/react';
import { ExternalLink } from 'lucide-react';
import {
  UconBot,
  uconBotRoleFromActivity,
  uconBotStateFromActivity,
  uconBotTaskGlyphFromActivity,
} from '@/renderer/components/agents/UconBot';
import { archetypeForIdentity, resolveUconAppearance } from '@/renderer/components/agents/uconBotConfig';
import { appearanceForCliSkin, resolveUconCliSkin } from '@/renderer/components/agents/uconCliSkins';
import { useUconToolGlyph } from '@/renderer/components/agents/useUconToolGlyph';
import { HubToolOverview } from './inspector/HubToolOverview';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HubAppDefinition } from './catalog';
import {
  arrangeGrid,
  GRID_SLOT_MIN,
  GRID_SLOT_MAX,
  gridDensityForCount,
  moveInOrder,
  monitorResponseExcerpt,
  orderItems,
  parseGridPrefs,
  pruneGridPrefs,
  resolveGridLayout,
  workspaceLabel,
  type LiveGridPrefs,
  type PingAdvice,
  type TileSize,
} from './liveGrid';
import type { HubActivityControls } from './useHubActivity';

type HubAgentsProps = {
  activity: HubActivityControls;
  apps: readonly HubAppDefinition[];
  selectedId?: string;
  pingAdvice: PingAdvice & { value: number | null };
  onSelect: (item: HubActivityItem | undefined) => void;
  onOpenItem: (item: HubActivityItem) => void;
  onOpenApp: (app: HubAppDefinition) => void;
  onNavigate: (path: string) => void;
  onFocusComposer: () => void;
  assistants: readonly Assistant[];
  onSelectAssistant: (assistantKey: string) => void;
};

const MAX_WELCOME_APPS = 5;
/** Home only carries the latest activity, not the whole agent transcript. */
const VISIBLE_STEPS_BY_SIZE: Record<TileSize, number> = { xl: 2, lg: 1, md: 1, sm: 1 };
const PREFS_STORAGE_KEY = 'tomni.hub.liveGrid';
const FINISHED: ReadonlySet<HubActivityStatus> = new Set(['done', 'stopped', 'error']);

/** Observes an element's box so the grid can derive its layout from real stage size. */
const useElementSize = <T extends HTMLElement>() => {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, size] as const;
};

const DOT_CLASS: Record<HubActivityStatus, string> = {
  running: 'hub-dot-g',
  needs_input: 'hub-dot-y',
  error: 'hub-dot-r',
  done: 'hub-dot-gr',
  stopped: 'hub-dot-gr',
};

const STEP_MARK = { done: '✓', running: '▶', error: '✗' } as const;

const readPrefs = (): LiveGridPrefs => {
  try {
    return parseGridPrefs(window.localStorage.getItem(PREFS_STORAGE_KEY));
  } catch {
    return parseGridPrefs(null);
  }
};

const toggle = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

type SlotButtonProps = {
  label: string;
  active: boolean;
  onClick: () => void;
  pressedLabel?: string;
};

const SlotButton: React.FC<SlotButtonProps> = ({ label, active, onClick, pressedLabel }) => (
  <button
    type='button'
    className={`hub-sb-btn ${active ? 'hub-sb-active' : ''}`}
    aria-pressed={active}
    aria-label={pressedLabel}
    onClick={onClick}
  >
    {label}
  </button>
);

type MenuState = { id: string; x: number; y: number };

const WelcomeState: React.FC<
  Pick<HubAgentsProps, 'apps' | 'onOpenApp' | 'onNavigate' | 'assistants' | 'onSelectAssistant'>
> = ({ apps, onOpenApp, onNavigate, assistants, onSelectAssistant }) => {
  const { t } = useTranslation();
  const enabledAssistants = assistants.filter((assistant) => assistant.enabled !== false);
  return (
    <section className='hub-welcome'>
      <div className='hub-welcome-head'>
        <h1>{t('guid.hubHome.title')}</h1>
        <p>{t('guid.hubHome.subtitle')}</p>
      </div>
      <div className='hub-app-grid'>
        {apps.slice(0, MAX_WELCOME_APPS).map((app) => (
          <button
            key={app.id}
            type='button'
            className='hub-app-card'
            data-testid={`hub-welcome-app-${app.id}`}
            onClick={() => onOpenApp(app)}
          >
            <span className='hub-app-card-icon'>
              <app.Icon theme='outline' size={16} fill='currentColor' />
            </span>
            <strong>{t(app.labelKey)}</strong>
            <small>{t(app.descriptionKey)}</small>
          </button>
        ))}
      </div>
      {enabledAssistants.length > 0 && (
        <section className='hub-welcome-assistants' aria-label={t('settings.assistants')}>
          <div className='hub-welcome-head'>
            <h2>{t('settings.assistants')}</h2>
          </div>
          <div className='hub-app-grid'>
            {enabledAssistants.map((assistant) => (
              <button
                key={assistant.id}
                type='button'
                className='hub-app-card'
                data-testid={`hub-assistant-${assistant.id}`}
                onClick={() => onSelectAssistant(`custom:${assistant.id}`)}
              >
                <span className='hub-app-card-icon' aria-hidden='true'>
                  {assistant.avatar || '🤖'}
                </span>
                <strong>{assistant.name}</strong>
                {assistant.description && <small>{assistant.description}</small>}
              </button>
            ))}
          </div>
        </section>
      )}
      <aside className='hub-promo-panel' data-testid='hub-promo-panel'>
        <div className='hub-promo-head'>
          <h2>{t('guid.hubHome.promo.title')}</h2>
          <p>{t('guid.hubHome.promo.description')}</p>
        </div>
        <ul className='hub-promo-list'>
          <li>
            <span className='hub-promo-ico'>
              <People theme='outline' size={16} fill='currentColor' />
            </span>
            <strong>{t('guid.hubHome.promo.f1Title')}</strong>
            <small>{t('guid.hubHome.promo.f1Body')}</small>
          </li>
          <li>
            <span className='hub-promo-ico'>
              <FolderOpen theme='outline' size={16} fill='currentColor' />
            </span>
            <strong>{t('guid.hubHome.promo.f2Title')}</strong>
            <small>{t('guid.hubHome.promo.f2Body')}</small>
          </li>
          <li>
            <span className='hub-promo-ico'>
              <Cycle theme='outline' size={16} fill='currentColor' />
            </span>
            <strong>{t('guid.hubHome.promo.f3Title')}</strong>
            <small>{t('guid.hubHome.promo.f3Body')}</small>
          </li>
        </ul>
        <button
          type='button'
          className='hub-promo-cta'
          data-testid='hub-welcome-store'
          onClick={() => onNavigate('/store')}
        >
          <AllApplication theme='outline' size={14} fill='currentColor' />
          {t('guid.hubHome.promo.cta')}
        </button>
      </aside>
    </section>
  );
};

type TileProps = {
  item: HubActivityItem;
  live: boolean;
  follow: boolean;
  pending: boolean;
  visibleSteps: number;
  density: 'solo' | 'standard' | 'compact';
  onRespond: (item: HubActivityItem, value: string) => void;
  onOpen: (item: HubActivityItem) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

const TileContent: React.FC<TileProps> = ({
  item,
  live,
  follow,
  pending,
  visibleSteps,
  density,
  onRespond,
  onOpen,
  onDragStart,
  onDragEnd,
}) => {
  const { t } = useTranslation();
  const toolGlyph = useUconToolGlyph(item, live);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const highlightedMember =
    item.steps.find((step) => step.id === selectedMemberId) ??
    item.steps.find((step) => step.state === 'error' || step.state === 'running') ??
    item.steps[0];

  const responseExcerpt = density === 'solo' ? monitorResponseExcerpt(item.preview) : '';
  const done = item.steps.filter((step) => step.state === 'done').length;
  const total = item.steps.length;
  const showProgress = live && density !== 'compact' && item.status === 'running' && total > 0;
  const badge = !live ? '⏸' : follow ? `▶ ${t('guid.hubHome.live.follow')}` : '';
  const workspace = workspaceLabel(item.workspace);
  const parentAppearance = useMemo(() => {
    const cliSkin = resolveUconCliSkin(item.agentName);
    return cliSkin ? appearanceForCliSkin(cliSkin) : resolveUconAppearance(archetypeForIdentity(item.id));
  }, [item.id, item.agentName]);
  return (
    <>
      <header className='hub-tile-head' draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <UconBot
          state={uconBotStateFromActivity(item)}
          role={uconBotRoleFromActivity(item)}
          identity={item.id}
          cliAgentId={item.agentName}
          taskGlyph={toolGlyph ?? uconBotTaskGlyphFromActivity(item)}
          size={density === 'solo' ? 'large' : density === 'compact' ? 'mini' : 'small'}
          label={item.title + ' — ' + t('guid.hubHome.live.status.' + item.status)}
        />
        <span className={`hub-dot ${DOT_CLASS[item.status]}`} />
        <span className='hub-t-summary'>
          <span className='hub-t-name'>{item.title}</span>
          {item.task && <span className='hub-t-task'>{item.task}</span>}
        </span>
        <span className='hub-t-badge'>{badge}</span>
        {item.route && (
          <button
            type='button'
            className='hub-tile-open-session'
            title={t('guid.hubHome.live.open')}
            aria-label={t('guid.hubHome.live.open')}
            data-testid='hub-tile-open-session'
            onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}
          >
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden='true' />
          </button>
        )}
      </header>
      {showProgress && (
        <div className='hub-tile-step-count'>
          {t('guid.hubHome.live.completedSteps', { defaultValue: '{{done}}/{{total}} bước hoàn tất', done, total })}
        </div>
      )}
      <div className='hub-tile-body'>
        {item.prompt ? (
          <>
            <div className='hub-q-text'>
              {item.prompt.title}
              {item.prompt.description && <small>{item.prompt.description}</small>}
            </div>
            <div className='hub-q-btns'>
              {item.prompt.options.map((option, index) => (
                <button
                  key={option.value}
                  type='button'
                  className={`hub-q-btn ${index === 0 ? 'hub-q-btn--primary' : ''}`}
                  data-testid={`hub-tile-answer-${option.value}`}
                  disabled={pending}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRespond(item, option.value);
                  }}
                >
                  {t(option.label, { defaultValue: option.label })}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className='hub-tile-overview' data-testid='hub-tile-overview'>
            {item.kind === 'team' && item.steps.length > 0 ? (
              <div className='hub-tile-team-summary'>
                <span>
                  {t('guid.hubHome.inspector.subagents', { defaultValue: 'Subagents' })}:{' '}
                  {item.steps.filter((step) => step.state === 'running').length}/{item.steps.length}
                </span>
                <select
                  aria-label={t('guid.hubHome.inspector.selectMember', { defaultValue: 'Quan sát Agent' })}
                  value={highlightedMember?.id ?? ''}
                  onChange={(event) => setSelectedMemberId(event.currentTarget.value)}
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.steps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.label}
                    </option>
                  ))}
                </select>
                {highlightedMember && (
                  <UconBot
                    state={
                      highlightedMember.state === 'error'
                        ? 'error'
                        : highlightedMember.state === 'running'
                          ? 'working'
                          : 'success'
                    }
                    role='team'
                    size='mini'
                    isSubagent
                    parentAppearance={parentAppearance}
                    cliAgentId={item.agentName}
                    identity={item.id + ':' + highlightedMember.id}
                    label={highlightedMember.label}
                  />
                )}
                {highlightedMember && (
                  <span
                    className={`hub-log-line hub-log-line--${highlightedMember.state}`}
                    title={highlightedMember.label}
                  >
                    {STEP_MARK[highlightedMember.state]} {highlightedMember.label}
                  </span>
                )}
              </div>
            ) : item.kind === 'agent' ? (
              <>
                <HubToolOverview item={item} density={density} />
                {density === 'solo' && responseExcerpt && (
                  <div className='hub-monitor-response' data-testid='hub-monitor-response'>
                    <strong>{t('guid.hubHome.monitor.response', { defaultValue: 'Phản hồi hiện tại' })}</strong>
                    <p>{responseExcerpt}</p>
                  </div>
                )}
                {density === 'solo' && item.steps.length > 0 && (
                  <div className='hub-monitor-recent' data-testid='hub-monitor-recent'>
                    <strong>{t('guid.hubHome.monitor.recentSteps', { defaultValue: 'Các thao tác gần đây' })}</strong>
                    {item.steps.slice(-6).map((step) => (
                      <div key={step.id} className={`hub-log-line hub-log-line--${step.state}`} title={step.label}>
                        {STEP_MARK[step.state]} {step.label}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : item.steps.length > 0 ? (
              item.steps.slice(-visibleSteps).map((step) => (
                <div key={step.id} className={`hub-log-line hub-log-line--${step.state}`} title={step.label}>
                  {STEP_MARK[step.state]} {step.label}
                </div>
              ))
            ) : (
              <div className='hub-log-line'>
                {item.status === 'running'
                  ? t('guid.hubHome.live.waiting')
                  : t(`guid.hubHome.live.status.${item.status}`)}
              </div>
            )}
            {!live && <div className='hub-chat-line--muted'>{t('guid.hubHome.live.pingOff')}</div>}
          </div>
        )}
      </div>
      <footer className='hub-tile-foot'>
        <span>{t(`guid.hubHome.live.kind.${item.kind}`)}</span>
        {workspace && <span title={item.workspace}>· {workspace}</span>}
        <span className='hub-tile-foot-status'>{t(`guid.hubHome.live.status.${item.status}`)}</span>
      </footer>
    </>
  );
};

export const HubAgents: React.FC<HubAgentsProps> = ({
  activity,
  apps,
  selectedId,
  pingAdvice,
  onSelect,
  onOpenItem,
  onOpenApp,
  onNavigate,
  assistants = [],
  onSelectAssistant = () => undefined,
}) => {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<LiveGridPrefs>(readPrefs);
  const [slotInput, setSlotInput] = useState(() =>
    String(typeof readPrefs().slots === 'number' ? readPrefs().slots : 4)
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const { items, stop, respond, dismiss } = activity;

  const pendingRequests = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [gridRef, stageSize] = useElementSize<HTMLDivElement>();

  const performAction = useCallback(
    async (id: string, action: () => Promise<boolean>): Promise<boolean> => {
      if (pendingRequests.current.has(id)) return false;
      pendingRequests.current.add(id);
      setPendingIds((current) => [...current, id]);
      try {
        const accepted = await action();
        if (!accepted) Message.warning(t('guid.hubHome.live.actionFailed'));
        return accepted;
      } catch {
        Message.error(t('guid.hubHome.live.actionFailed'));
        return false;
      } finally {
        pendingRequests.current.delete(id);
        setPendingIds((current) => current.filter((entry) => entry !== id));
      }
    },
    [t]
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable: the layout just does not persist
    }
  }, [prefs]);

  // Ids of work that is gone are forgotten, so the stored layout stays small.
  useEffect(() => {
    if (!activity.ready) return;
    setPrefs((current) => {
      const next = pruneGridPrefs(current, items);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [activity.ready, items]);

  // Unfollow only reduces attention/pings. Closing a tile is always an explicit user action.

  const layout = useMemo(
    () =>
      resolveGridLayout(
        items.length,
        Math.max(0, stageSize.width - 32),
        Math.max(0, stageSize.height - 80),
        prefs.slots
      ),
    [items.length, stageSize.width, stageSize.height, prefs.slots]
  );
  const { tiles, escalated } = useMemo(
    () => arrangeGrid(items, { order: prefs.order, unpinged: prefs.unpinged, visible: layout.capacity }),
    [items, prefs.order, prefs.unpinged, layout.capacity]
  );
  const density = gridDensityForCount(
    prefs.slots === 'auto'
      ? items.length
      : Math.min(items.length, stageSize.width > 0 && stageSize.height > 0 ? layout.capacity : prefs.slots)
  );
  const pingedCount = tiles.filter((item) => !prefs.unpinged.includes(item.id)).length;
  const menuItem = menu ? items.find((item) => item.id === menu.id) : undefined;

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const handleRespond = useCallback(
    (item: HubActivityItem, value: string) => {
      const prompt = item.prompt;
      if (!prompt) return;
      void performAction(item.id, () => respond(item.id, prompt.id, value));
    },
    [performAction, respond]
  );

  const togglePing = useCallback(
    (id: string) => {
      const turningOn = prefs.unpinged.includes(id);
      if (turningOn && pingedCount >= pingAdvice.limit && pingAdvice.reason) {
        Message.warning(
          t('guid.hubHome.live.pingAdvice', {
            count: pingedCount + 1,
            limit: pingAdvice.limit,
            reason: t(`guid.hubHome.live.reason.${pingAdvice.reason}`),
            value: pingAdvice.value ?? 0,
          })
        );
      }
      setPrefs((current) => ({ ...current, unpinged: toggle(current.unpinged, id) }));
    },
    [pingAdvice, pingedCount, prefs.unpinged, t]
  );

  const runMenu = (action: 'follow' | 'ping' | 'open' | 'stop' | 'dismiss') => {
    const item = menuItem;
    setMenu(null);
    if (!item) return;
    if (action === 'follow') setPrefs((current) => ({ ...current, unfollowed: toggle(current.unfollowed, item.id) }));
    else if (action === 'ping') togglePing(item.id);
    else if (action === 'open') onOpenItem(item);
    else if (action === 'stop') {
      void performAction(item.id, () => stop(item.id)).then((stopped) => {
        if (stopped) Message.info(t('guid.hubHome.live.stopped', { name: item.title }));
      });
    } else void performAction(item.id, () => dismiss(item.id));
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const visible = orderItems(items, prefs.order).map((item) => item.id);
    setPrefs((current) => ({ ...current, order: moveInOrder(visible, dragId, targetId) }));
  };

  if (items.length === 0) {
    return (
      <div className='hub-agents-wrap' data-testid='hub-agent-grid'>
        <WelcomeState
          apps={apps}
          onOpenApp={onOpenApp}
          onNavigate={onNavigate}
          assistants={assistants}
          onSelectAssistant={onSelectAssistant}
        />
      </div>
    );
  }

  const running = items.filter((item) => item.status === 'running').length;
  const attention = items.filter((item) => item.status === 'needs_input' || item.status === 'error').length;

  return (
    <div
      ref={gridRef}
      className='hub-agents-wrap'
      data-testid='hub-agent-grid'
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        onSelect(undefined);
        event.stopPropagation();
      }}
    >
      <div
        className='hub-grid-bar'
        onClick={(event) => {
          if (!(event.target instanceof Element) || !event.target.closest('button, select, input, textarea, a'))
            onSelect(undefined);
        }}
      >
        <span>
          <span className='hub-dot hub-dot-g' /> {t('guid.hubHome.live.running', { count: running })}
        </span>
        {attention > 0 && (
          <span>
            <span className='hub-dot hub-dot-y' /> {t('guid.hubHome.live.attention', { count: attention })}
          </span>
        )}
        {pingAdvice.reason && pingedCount > pingAdvice.limit && (
          <span className='hub-grid-warn' data-testid='hub-ping-advice'>
            {t('guid.hubHome.live.pingAdvice', {
              count: pingedCount,
              limit: pingAdvice.limit,
              reason: t(`guid.hubHome.live.reason.${pingAdvice.reason}`),
              value: pingAdvice.value ?? 0,
            })}
          </span>
        )}
        <span className='hub-grid-bar-actions'>
          <SlotButton
            label={t('guid.hubHome.live.auto')}
            active={prefs.slots === 'auto'}
            onClick={() => setPrefs((current) => ({ ...current, slots: 'auto' }))}
          />
          <SlotButton
            label={t('guid.hubHome.live.custom', { defaultValue: 'Tùy chỉnh' })}
            active={prefs.slots !== 'auto'}
            onClick={() =>
              setPrefs((current) => ({
                ...current,
                slots:
                  current.slots === 'auto'
                    ? Math.max(GRID_SLOT_MIN, Math.min(GRID_SLOT_MAX, Number(slotInput) || 4))
                    : current.slots,
              }))
            }
          />
          <input
            type='number'
            className='hub-grid-count-input'
            min={GRID_SLOT_MIN}
            max={GRID_SLOT_MAX}
            step={1}
            value={slotInput}
            aria-label={t('guid.hubHome.live.customCount', { defaultValue: 'Số ô giám sát' })}
            title={t('guid.hubHome.live.customCount', { defaultValue: 'Số ô giám sát' })}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSlotInput(value);
              const number = Number(value);
              if (value.trim() && Number.isInteger(number) && number >= GRID_SLOT_MIN && number <= GRID_SLOT_MAX) {
                setPrefs((current) => ({ ...current, slots: number }));
              }
            }}
            onBlur={() => {
              if (
                !slotInput.trim() ||
                !Number.isInteger(Number(slotInput)) ||
                Number(slotInput) < GRID_SLOT_MIN ||
                Number(slotInput) > GRID_SLOT_MAX
              ) {
                setSlotInput(String(typeof prefs.slots === 'number' ? prefs.slots : 4));
              }
            }}
          />
        </span>
      </div>
      <div
        className={[
          'hub-agent-grid',
          prefs.slots === 'auto'
            ? `hub-agent-grid--auto hub-density-${density} hub-size-${layout.tileSize}`
            : `hub-agent-grid--fixed hub-density-${density} hub-size-${layout.tileSize}`,
        ].join(' ')}
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          ...(prefs.slots !== 'auto' ? { gridAutoRows: `minmax(${layout.rowHeight}px, auto)` } : {}),
        }}
        role='list'
        aria-label={t('guid.hubHome.live.gridLabel')}
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelect(undefined);
        }}
      >
        {tiles.map((item, index) => {
          const live = !prefs.unpinged.includes(item.id) || escalated.has(item.id);
          const isEscalated = escalated.has(item.id);
          return (
            <article
              key={item.id}
              role='listitem'
              className={[
                'hub-tile',
                selectedId === item.id ? 'hub-tile--selected' : '',
                isEscalated ? 'hub-tile--attn' : '',
                dragId === item.id ? 'hub-tile--dragging' : '',
                dragOverId === item.id ? 'hub-tile--drag-over' : '',
              ].join(' ')}
              data-testid={`hub-agent-tile-${item.id}`}
              data-status={item.status}
              data-density={density}
              style={
                prefs.slots !== 'auto' && index === layout.capacity && index > 0
                  ? { gridColumn: 1, gridRowStart: layout.visibleRows + 1 }
                  : undefined
              }
              tabIndex={0}
              aria-label={item.title}
              aria-current={selectedId === item.id ? 'true' : undefined}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onOpenItem(item);
                } else if (event.key === ' ') {
                  event.preventDefault();
                  onSelect(item);
                }
              }}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('button, select, input, textarea, a'))
                  return;
                onSelect(item);
              }}
              onDoubleClick={(event) => {
                if (event.target instanceof Element && event.target.closest('button, select, input, textarea, a'))
                  return;
                onOpenItem(item);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect(item);
                setMenu({
                  id: item.id,
                  x: Math.min(event.clientX, window.innerWidth - 200),
                  y: Math.min(event.clientY, window.innerHeight - 200),
                });
              }}
              onDragOver={(event) => {
                if (!dragId) return;
                event.preventDefault();
                setDragOverId(item.id);
              }}
              onDragLeave={() => setDragOverId((current) => (current === item.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                drop(item.id);
                setDragId(null);
                setDragOverId(null);
              }}
            >
              <TileContent
                item={item}
                live={live}
                follow={!prefs.unfollowed.includes(item.id)}
                pending={pendingIds.includes(item.id)}
                visibleSteps={density === 'solo' ? 6 : VISIBLE_STEPS_BY_SIZE[layout.tileSize]}
                density={density}
                onRespond={handleRespond}
                onOpen={onOpenItem}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  setDragId(item.id);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
              />
            </article>
          );
        })}
      </div>
      {menu && menuItem && (
        <div
          className='hub-ctx-menu'
          role='menu'
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type='button' role='menuitem' className='hub-ctx-item' onClick={() => runMenu('follow')}>
            ▸ {t('guid.hubHome.live.follow')}
            <span className='hub-ck'>{prefs.unfollowed.includes(menuItem.id) ? '[ ]' : '[✓]'}</span>
          </button>
          <button type='button' role='menuitem' className='hub-ctx-item' onClick={() => runMenu('ping')}>
            ▸ {t('guid.hubHome.live.ping')}
            <span className='hub-ck'>{prefs.unpinged.includes(menuItem.id) ? '[ ]' : '[✓]'}</span>
          </button>
          <div className='hub-ctx-sep' />
          <button type='button' role='menuitem' className='hub-ctx-item' onClick={() => runMenu('open')}>
            {t('guid.hubHome.live.open')}
          </button>
          {menuItem.canStop && !FINISHED.has(menuItem.status) && (
            <button
              type='button'
              role='menuitem'
              className='hub-ctx-item'
              disabled={pendingIds.includes(menuItem.id)}
              onClick={() => runMenu('stop')}
            >
              {t('guid.hubHome.live.stop')}
            </button>
          )}
          {FINISHED.has(menuItem.status) && (
            <button
              type='button'
              role='menuitem'
              className='hub-ctx-item'
              disabled={pendingIds.includes(menuItem.id)}
              onClick={() => runMenu('dismiss')}
            >
              {t('guid.hubHome.live.dismiss')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
