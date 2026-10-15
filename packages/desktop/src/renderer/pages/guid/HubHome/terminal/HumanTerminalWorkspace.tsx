/** Human terminal overview plus the selected interactive PTY beneath it.
 * These are shell sessions created for people, never agent tool invocations.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, Plus, Square, Terminal, X } from 'lucide-react';
import { resolveGridLayout, GRID_SLOT_MAX, GRID_SLOT_MIN, type GridSlots } from '../liveGrid';
import { useHumanTerminals } from './HumanTerminalContext';
import { HumanTerminalViewport } from './HumanTerminalViewport';

const STORAGE_KEY = 'tomni.hub.humanTerminalSlots';
const readSlots = (): GridSlots => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'auto') return 'auto';
    const parsed = Number(saved);
    return saved && Number.isInteger(parsed) && parsed >= GRID_SLOT_MIN && parsed <= GRID_SLOT_MAX ? parsed : 'auto';
  } catch {
    return 'auto';
  }
};

type Props = { workspacePath?: string };

export const HumanTerminalWorkspace: React.FC<Props> = ({ workspacePath }) => {
  const { t } = useTranslation();
  const terminals = useHumanTerminals();
  const [slots, setSlots] = useState<GridSlots>(readSlots);
  const [slotInput, setSlotInput] = useState(() => String(typeof readSlots() === 'number' ? readSlots() : 4));
  const [focus, setFocus] = useState(false);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const createPending = useRef(false);

  const newSession = async (): Promise<void> => {
    if (createPending.current) return;
    createPending.current = true;
    try {
      // A display label is not a filesystem path; only pass absolute paths as cwd.
      const cwd = workspacePath && (/^[A-Za-z]:[\\/]/.test(workspacePath) || workspacePath.startsWith('/'))
        ? workspacePath
        : undefined;
      await terminals.create(cwd ? { cwd } : undefined);
    } finally {
      createPending.current = false;
    }
  };

  useEffect(() => {
    if (terminals.status === 'ready' && terminals.sessions.length === 0) void newSession();
    // Only initialize when entering this workspace. Do not create a new shell
    // whenever a user explicitly closes their last terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminals.status]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, String(slots)); } catch { /* Storage is optional. */ }
  }, [slots]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [focus, terminals.status]);

  const layout = useMemo(
    () => resolveGridLayout(terminals.sessions.length, Math.max(0, stage.width - 12), Math.max(0, stage.height - 42), slots),
    [terminals.sessions.length, stage.width, stage.height, slots]
  );
  const active = terminals.sessions.find((session) => session.id === terminals.activeId) ?? null;
  const label = (key: string, fallback: string) => t(key, { defaultValue: fallback });

  return (
    <>
      <div ref={stageRef} className={`hub-human-terminal-stage ${focus ? 'hub-human-terminal-stage--focused' : ''}`} data-testid='hub-terminal-grid'>
        <header className='hub-human-terminal-bar'>
          <span>{label('guid.hubHome.terminal.overview', 'Terminal Overview')} · {terminals.sessions.length}</span>
          <div className='hub-human-terminal-actions'>
            <button type='button' className={slots === 'auto' ? 'hub-active' : ''} onClick={() => setSlots('auto')}>
              {label('guid.hubHome.live.auto', 'Auto')}
            </button>
            <label>
              <span className='sr-only'>{label('guid.hubHome.terminal.visibleCount', 'Số ô terminal')}</span>
              <input
                type='number' min={GRID_SLOT_MIN} max={GRID_SLOT_MAX} step={1}
                value={slotInput}
                title={label('guid.hubHome.terminal.visibleCount', 'Số ô terminal')}
                onChange={(event) => {
                  const input = event.currentTarget.value;
                  setSlotInput(input);
                  const number = Number(input);
                  if (input.trim() && Number.isInteger(number) && number >= GRID_SLOT_MIN && number <= GRID_SLOT_MAX)
                    setSlots(number);
                }}
                onBlur={() => {
                  if (!slotInput.trim() || !Number.isInteger(Number(slotInput)) || Number(slotInput) < GRID_SLOT_MIN || Number(slotInput) > GRID_SLOT_MAX)
                    setSlotInput(String(typeof slots === 'number' ? slots : 4));
                }}
              />
            </label>
            <button type='button' onClick={() => void newSession()} title={label('guid.hubHome.terminal.new', 'Terminal mới')} data-testid='hub-terminal-new'>
              <Plus size={15} />
            </button>
            <button type='button' onClick={() => setFocus((current) => !current)} title={label('guid.hubHome.terminal.focus', 'Phóng to terminal')}>
              {focus ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </header>
        {terminals.status === 'unavailable' ? (
          <div className='hub-human-terminal-empty'>
            <p>{label('guid.hubHome.terminal.unavailable', 'Không kết nối được Terminal.')} {terminals.error}</p>
            <button type='button' onClick={terminals.retry}>{label('guid.hubHome.terminal.retry', 'Thử lại')}</button>
          </div>
        ) : terminals.sessions.length === 0 ? (
          <div className='hub-human-terminal-empty'>
            <Terminal size={24} />
            <span>{terminals.status === 'loading'
              ? label('guid.hubHome.terminal.loading', 'Đang kết nối Terminal…')
              : label('guid.hubHome.terminal.empty', 'Chưa có phiên Terminal')}</span>
            <button type='button' onClick={() => void newSession()}>{label('guid.hubHome.terminal.new', 'Terminal mới')}</button>
          </div>
        ) : (
          <div
            className={`hub-human-terminal-grid hub-human-terminal-grid--cols-${Math.min(4, layout.columns)} ${slots !== 'auto' ? 'hub-human-terminal-grid--manual' : ''} ${focus ? 'hub-human-terminal-grid--hidden' : ''}`}
            style={slots === 'auto' ? undefined : { '--hub-terminal-row-height': `${layout.rowHeight}px` } as React.CSSProperties}
            data-testid='hub-terminal-tiles'
          >
            {terminals.sessions.map((session, index) => {
              const signal = terminals.signals[session.id];
              const phase = session.status === 'exited'
                ? (session.exitCode && session.exitCode !== 0 ? 'error' : 'exited')
                : signal?.phase ?? 'unknown';
              return (
                                <React.Fragment key={session.id}>
                {slots !== 'auto' && index === layout.capacity && layout.capacity % layout.columns !== 0 &&
                  Array.from({ length: layout.columns - layout.capacity % layout.columns }, (_, offset) => (
                    <span className='hub-human-terminal-grid-spacer' aria-hidden='true' key={offset} />
                  ))}
                <button
                  type='button'
                  className={`hub-human-terminal-tile hub-human-terminal-tile--${phase} ${active?.id === session.id ? 'hub-active' : ''}`}
                  aria-pressed={active?.id === session.id}
                  onClick={() => terminals.select(session.id)}
                  data-testid='hub-terminal-tile'
                >
                  <span className='hub-human-terminal-tile-title'><Terminal size={15}/><strong>{session.title || `Terminal ${index + 1}`}</strong></span>
                  <span className='hub-human-terminal-tile-state'>
                    <span className='hub-human-terminal-dot'/>
                    {phase === 'running' ? label('guid.hubHome.terminal.running', 'Đang chạy')
                      : phase === 'error' ? label('guid.hubHome.terminal.error', 'Lỗi')
                      : phase === 'exited' ? label('guid.hubHome.terminal.exited', 'Đã đóng')
                      : phase === 'unknown' ? label('guid.hubHome.terminal.unknown', 'Phiên đang mở')
                       : label('guid.hubHome.terminal.ready', 'Chờ lệnh')}
                  </span>
                  {signal?.lastCommand && <code title={signal.lastCommand}>{signal.lastCommand}</code>}
                  <small title={session.cwd}>{session.cwd}</small>
                  {phase === 'error' && <span>{label('guid.hubHome.terminal.exitCode', 'Mã lỗi')}: {session.exitCode ?? signal?.exitCode ?? '—'}</span>}
                                </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
      <div className={`hub-human-terminal-composer ${focus ? 'hub-human-terminal-composer--focused' : ''}`} data-testid='hub-terminal-composer'>
        <header className='hub-human-terminal-composer-head'>
          <span><Terminal size={14} /> {active?.title ?? label('guid.hubHome.terminal.new', 'Terminal mới')}</span>
          {active && <div className='hub-human-terminal-actions'>
            {active.status === 'running' && (
              <button type='button' title={label('guid.hubHome.terminal.stop', 'Dừng tiến trình')} onClick={() => terminals.kill(active.id)}>
                <Square size={13} />
              </button>
            )}
            <button type='button' title={label('guid.hubHome.terminal.close', 'Đóng phiên')} onClick={() => terminals.remove(active.id)}>
              <X size={14} />
            </button>
          </div>}
        </header>
        {active ? (
          <HumanTerminalViewport key={active.id} sessionId={active.id} />
        ) : (
          <div className='hub-human-terminal-empty'>{label('guid.hubHome.terminal.empty', 'Chưa có phiên Terminal')}</div>
        )}
        {terminals.error && terminals.status === 'ready' && <p className='hub-human-terminal-error' role='alert'>{terminals.error}</p>}
      </div>
    </>
  );
};
