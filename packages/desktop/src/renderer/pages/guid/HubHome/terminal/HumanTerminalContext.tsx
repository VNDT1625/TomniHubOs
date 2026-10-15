/**
 * User-owned terminal sessions for the Hub. This is deliberately separate from
 * agent tool traces: only sessions created through the human terminal manager
 * are displayed, never subprocesses launched by an agent tool call.
 *
 * Shell authority stays in Main behind the existing Terminal IPC bridge.
 */
import { bridge } from '@office-ai/platform';
import type {
  CreateTerminalOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalIdRequest,
  TerminalListData,
  TerminalResult,
  TerminalSession,
} from '@/common/types/terminalHost';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { terminalSignalFromOutput, type HumanTerminalSignal } from './terminalSignal';

type TerminalBridgeState = 'loading' | 'ready' | 'unavailable';

export type HumanTerminalController = {
  status: TerminalBridgeState;
  sessions: TerminalSession[];
  activeId: string | null;
  buffers: Readonly<Record<string, string>>;
  signals: Readonly<Record<string, HumanTerminalSignal>>;
  error: string | null;
  select: (id: string) => void;
  create: (options?: CreateTerminalOptions) => Promise<TerminalSession | null>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => void;
  kill: (id: string) => void;
  remove: (id: string) => void;
  retry: () => void;
};

const channels = {
  create: bridge.buildProvider<TerminalResult<TerminalSession>, { options?: CreateTerminalOptions }>('terminal.create'),
  list: bridge.buildProvider<TerminalResult<TerminalListData>, void>('terminal.list'),
  scrollback: bridge.buildProvider<TerminalResult<string>, TerminalIdRequest>('terminal.scrollback'),
  write: bridge.buildProvider<TerminalResult<void>, { id: string; data: string }>('terminal.write'),
  resize: bridge.buildProvider<TerminalResult<void>, { id: string; cols: number; rows: number }>('terminal.resize'),
  kill: bridge.buildProvider<TerminalResult<void>, TerminalIdRequest>('terminal.kill'),
  remove: bridge.buildProvider<TerminalResult<void>, TerminalIdRequest>('terminal.remove'),
  data: bridge.buildEmitter<TerminalDataEvent>('terminal.data'),
  exit: bridge.buildEmitter<TerminalExitEvent>('terminal.exit'),
  changed: bridge.buildEmitter<TerminalSession[]>('terminal.sessions-changed'),
};

const TIMEOUT_MS = 4000;
const BUFFER_LIMIT = 120_000;
const appendBuffer = (previous: string, data: string): string => (previous + data).slice(-BUFFER_LIMIT);

const invoke = <T,>(channel: string, request: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Terminal IPC timeout: ${channel}`)), TIMEOUT_MS);
    void request.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });



const HumanTerminalContext = createContext<HumanTerminalController | null>(null);
const NOOP = (): void => undefined;
const EMPTY_TERMINALS: HumanTerminalController = {
  status: 'unavailable',
  sessions: [],
  activeId: null,
  buffers: {},
  signals: {},
  error: null,
  select: NOOP,
  create: async () => null,
  write: NOOP,
  resize: NOOP,
  kill: NOOP,
  remove: NOOP,
  retry: NOOP,
};

/** The rail remains renderable independently for previews and isolated tests. */
export const useHumanTerminals = (): HumanTerminalController =>
  useContext(HumanTerminalContext) ?? EMPTY_TERMINALS;

export const HumanTerminalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<TerminalBridgeState>('loading');
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [signals, setSignals] = useState<Record<string, HumanTerminalSignal>>({});
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let disposed = false;
    const hydrated = new Set<string>();
    const hydrate = (entries: TerminalSession[]): void => {
      for (const session of entries) {
        if (session.scheduled || hydrated.has(session.id)) continue;
        hydrated.add(session.id);
        void invoke('terminal.scrollback', channels.scrollback.invoke({ id: session.id }))
          .then((response) => {
            if (disposed || !response.ok) return;
            setBuffers((current) => ({
              ...current,
              [session.id]: current[session.id] && current[session.id]!.length >= response.data.length
                ? current[session.id]!
                : response.data.slice(-BUFFER_LIMIT),
            }));
          })
          .catch((): undefined => undefined);
      }
    };
    const sync = (entries: TerminalSession[]): void => {
      if (disposed) return;
      const human = entries.filter((session) => !session.scheduled);
      setSessions(human);
      setActiveId((current) =>
        current && human.some((session) => session.id === current) ? current : human[0]?.id ?? null
      );
      hydrate(human);
    };
    const stopData = channels.data.on(({ id, data }) => {
      if (disposed) return;
      setBuffers((current) => ({ ...current, [id]: appendBuffer(current[id] ?? '', data) }));
      setSignals((current) => {
        const next = terminalSignalFromOutput(current[id], data);
        return next && next !== current[id] ? { ...current, [id]: next } : current;
      });
    });
    const stopExit = channels.exit.on(({ id, exitCode }) => {
      if (!disposed && exitCode !== null && exitCode !== 0)
        setSignals((current) => ({ ...current, [id]: { ...current[id], phase: 'error', exitCode } }));
    });
    const stopChanged = channels.changed.on(sync);
    setStatus('loading');
    void invoke('terminal.list', channels.list.invoke())
      .then((result) => {
        if (disposed) return;
        if (result.ok === false) throw new Error(result.error);
        sync(result.data.sessions);
        setError(null);
        setStatus('ready');
      })
      .catch((failure: unknown) => {
        if (!disposed) {
          setStatus('unavailable');
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      });
    return () => {
      disposed = true;
      stopData();
      stopExit();
      stopChanged();
    };
  }, [reload]);

  const create = useCallback(async (options?: CreateTerminalOptions) => {
    try {
      const result = await invoke('terminal.create', channels.create.invoke({ options }));
      if (result.ok === false) throw new Error(result.error);
      setActiveId(result.data.id);
      setSessions((previous) => previous.some((entry) => entry.id === result.data.id) ? previous : [...previous, result.data]);
      setError(null);
      return result.data;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return null;
    }
  }, []);

  const write = useCallback((id: string, data: string) => {
    void invoke('terminal.write', channels.write.invoke({ id, data }))
      .then((result) => { if (result.ok === false) setError(result.error); })
      .catch((failure: unknown) => setError(String(failure)));
  }, []);
  const resize = useCallback((id: string, cols: number, rows: number) => {
    if (cols < 2 || rows < 2) return;
    void invoke('terminal.resize', channels.resize.invoke({ id, cols, rows })).catch((): undefined => undefined);
  }, []);
  const kill = useCallback((id: string) => {
    void invoke('terminal.kill', channels.kill.invoke({ id }))
      .then((result) => { if (result.ok === false) setError(result.error); })
      .catch((failure: unknown) => setError(String(failure)));
  }, []);
  const remove = useCallback((id: string) => {
    void invoke('terminal.remove', channels.remove.invoke({ id }))
      .then((result) => { if (result.ok === false) setError(result.error); })
      .catch((failure: unknown) => setError(String(failure)));
  }, []);

  const controller = useMemo<HumanTerminalController>(() => ({
    status, sessions, activeId, buffers, signals, error,
    select: setActiveId, create, write, resize, kill, remove,
    retry: () => setReload((value) => value + 1),
  }), [status, sessions, activeId, buffers, signals, error, create, write, resize, kill, remove]);
  return <HumanTerminalContext.Provider value={controller}>{children}</HumanTerminalContext.Provider>;
};
