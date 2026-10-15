import type {
  ExplorerActionRequest,
  ExplorerEntry,
  ExplorerErrorCode,
  ExplorerListing,
  ExplorerSession,
} from '@/common/types/platform/explorer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explorerAbsolutePath, explorerFileType, explorerRelativePath } from './path';

type Location = { session: ExplorerSession; listing: ExplorerListing };
type Clipboard = { sessionId: string; paths: string[]; cut: boolean };
type Conflict = { request: Omit<ExplorerActionRequest, 'sessionId'>; suggestedName: string };
export type ExplorerSort = 'name' | 'date' | 'size' | 'type';

export const useExplorer = (workspaceName?: string) => {
  const workspacePath = workspaceName?.trim() || undefined;
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ExplorerErrorCode | null>(null);
  const [partial, setPartial] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const sessionInvalid = useRef(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<ExplorerSort>('name');
  const [descending, setDescending] = useState(false);
  const [history, setHistory] = useState<{ paths: string[]; index: number }>({ paths: [], index: -1 });
  const locationRef = useRef<Location | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const actionActive = useRef(false);
  const anchor = useRef<string | null>(null);
  const requestedWorkspace = useRef<{ name?: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      const id = locationRef.current?.session.id;
      locationRef.current = null;
      requestedWorkspace.current = null;
      if (id) void window.electronAPI?.explorer?.close({ sessionId: id }).catch((): undefined => undefined);
    };
  }, []);

  const load = useCallback(
    async (
      path?: string,
      options?: { pick?: boolean; historyIndex?: number; refresh?: boolean; preserveError?: boolean }
    ) => {
      if (actionActive.current) return;
      const api = window.electronAPI?.explorer;
      const id = ++requestId.current;
      setLoading(true);
      if (!options?.preserveError) {
        setError(null);
        setPartial(false);
        setConflict(null);
      }
      if (!api) {
        setError('UNAVAILABLE');
        setLoading(false);
        return;
      }
      const previous = locationRef.current;
      const relative = path && previous ? explorerRelativePath(previous.session.root, path) : null;
      try {
        const result =
          previous && relative !== null && !options?.pick && !sessionInvalid.current
            ? await api.list({ sessionId: previous.session.id, relativePath: relative })
            : await api.open({ ...(path ? { path } : {}), ...(options?.pick ? { pick: true } : {}) });
        if (!mounted.current || id !== requestId.current) {
          if (result.ok && 'session' in result.data)
            void api.close({ sessionId: result.data.session.id }).catch((): undefined => undefined);
          return;
        }
        if (result.ok === false) {
          if (result.code === 'SESSION_EXPIRED') sessionInvalid.current = true;
          if (result.code !== 'CANCELLED') setError(result.code);
          return;
        }
        if (!('session' in result.data) && !previous) return;
        const next =
          'session' in result.data
            ? result.data
            : previous
              ? { session: previous.session, listing: result.data }
              : null;
        if (!next) return;
        if (previous?.session.id !== next.session.id) {
          setClipboard(null);
          if (previous) void api.close({ sessionId: previous.session.id }).catch((): undefined => undefined);
        }
        locationRef.current = next;
        sessionInvalid.current = false;
        setLocation(next);
        if (options?.refresh) {
          const paths = new Set(next.listing.entries.map((entry) => entry.relativePath));
          setSelection((selected) => selected.filter((item) => paths.has(item)));
        } else {
          setSelection([]);
          anchor.current = null;
          setSearch('');
        }
        const absolute = explorerAbsolutePath(next.session.root, next.listing.relativePath);
        setHistory((current) => {
          if (options?.historyIndex !== undefined) return { ...current, index: options.historyIndex };
          if (current.paths[current.index] === absolute) return current;
          const paths = [...current.paths.slice(0, current.index + 1), absolute].slice(-100);
          return { paths, index: paths.length - 1 };
        });
      } catch {
        if (mounted.current && id === requestId.current) setError('IO_ERROR');
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (busy || (requestedWorkspace.current?.name === workspacePath && requestedWorkspace.current !== null)) return;
    requestedWorkspace.current = { name: workspacePath };
    void load(workspacePath);
  }, [busy, load, workspacePath]);

  /** Lists a child directory without changing the active Explorer location or its history. */
  const listDirectory = useCallback(async (relativePath: string): Promise<ExplorerListing | null> => {
    const api = window.electronAPI?.explorer;
    const current = locationRef.current;
    if (!api || !current || sessionInvalid.current) return null;
    try {
      const result = await api.list({ sessionId: current.session.id, relativePath });
      if (!mounted.current || locationRef.current !== current) return null;
      if (result.ok === false) {
        if (result.code === 'SESSION_EXPIRED') sessionInvalid.current = true;
        if (result.code !== 'CANCELLED') setError(result.code);
        return null;
      }
      return result.data;
    } catch {
      if (mounted.current && locationRef.current === current) setError('IO_ERROR');
      return null;
    }
  }, []);

  const entries = useMemo(() => {
    const term = search.toLocaleLowerCase();
    const filtered =
      location?.listing.entries.filter(
        (entry) => (showHidden || !entry.name.startsWith('.')) && entry.name.toLocaleLowerCase().includes(term)
      ) ?? [];
    return filtered.toSorted((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const comparison =
        sort === 'date'
          ? a.modifiedAt - b.modifiedAt
          : sort === 'size'
            ? a.size - b.size
            : sort === 'type'
              ? explorerFileType(a.name).localeCompare(explorerFileType(b.name))
              : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return (comparison || a.name.localeCompare(b.name)) * (descending ? -1 : 1);
    });
  }, [location, search, showHidden, sort, descending]);

  useEffect(() => {
    const visible = new Set(entries.map((entry) => entry.relativePath));
    setSelection((current) => current.filter((path) => visible.has(path)));
  }, [entries]);

  const select = (path: string, ctrl: boolean, shift: boolean) => {
    if (loading || busy) return;
    const start = entries.findIndex((entry) => entry.relativePath === anchor.current);
    const end = entries.findIndex((entry) => entry.relativePath === path);
    if (shift && start >= 0 && end >= 0) {
      const range = entries.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.relativePath);
      setSelection((current) => (ctrl ? [...new Set([...current, ...range])] : range));
    } else {
      setSelection((current) =>
        ctrl ? (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]) : [path]
      );
      anchor.current = path;
    }
  };

  const refresh = () => {
    const current = locationRef.current;
    void load(current ? explorerAbsolutePath(current.session.root, current.listing.relativePath) : workspaceName, {
      refresh: true,
    });
  };
  const action = async (request: Omit<ExplorerActionRequest, 'sessionId'>): Promise<boolean> => {
    const api = window.electronAPI?.explorer;
    const current = locationRef.current;
    if (!api || !current || actionActive.current || loading || sessionInvalid.current) return false;
    actionActive.current = true;
    setBusy(true);
    setPartial(false);
    setError(null);
    setConflict(null);
    let succeeded = false;
    let hadPartialChanges = false;
    let failure: ExplorerErrorCode | null = null;
    try {
      const result = await api.action({ sessionId: current.session.id, ...request });
      if (!mounted.current) return false;
      if (result.ok === false) {
        hadPartialChanges = result.mayHaveCommitted === true || (result.affectedPaths?.length ?? 0) > 0;
        const suggestion = result.code === 'CONFLICT' ? result.suggestedName : undefined;
        if (suggestion !== undefined) setConflict({ request, suggestedName: suggestion });
        else if (result.code !== 'CANCELLED') failure = result.code;
        setPartial(hadPartialChanges);
        if (hadPartialChanges && request.operation === 'move') setClipboard(null);
        if (result.code === 'AUDIT_FAILED' || result.code === 'SESSION_EXPIRED') {
          sessionInvalid.current = true;
          setClipboard(null);
        }
      } else succeeded = true;
    } catch {
      failure = 'IO_ERROR';
      hadPartialChanges = !['open', 'reveal'].includes(request.operation);
      if (mounted.current) {
        setPartial(hadPartialChanges);
        if (request.operation === 'move') setClipboard(null);
      }
    } finally {
      actionActive.current = false;
      if (mounted.current) setBusy(false);
    }
    if (
      (succeeded || hadPartialChanges) &&
      !sessionInvalid.current &&
      mounted.current &&
      locationRef.current === current &&
      !['open', 'reveal'].includes(request.operation)
    ) {
      await load(explorerAbsolutePath(current.session.root, current.listing.relativePath), {
        refresh: true,
        preserveError: true,
      });
    }
    if (mounted.current && failure) setError(failure);
    return succeeded;
  };
  /** Re-runs the rejected request with autoRename so the backend lands on `name (n)`. */
  const confirmConflict = async (): Promise<boolean> => {
    const pending = conflict;
    if (!pending) return false;
    setConflict(null);
    const succeeded = await action({ ...pending.request, autoRename: true });
    if (succeeded && pending.request.operation === 'move') {
      const moved = new Set(pending.request.paths);
      setClipboard((current) => (current && current.paths.some((item) => moved.has(item)) ? null : current));
    }
    return succeeded;
  };
  const cancelConflict = () => setConflict(null);
  const storeClipboard = (cut: boolean) => {
    if (location && selection.length && !loading && !busy && !sessionInvalid.current)
      setClipboard({ sessionId: location.session.id, paths: [...selection], cut });
  };
  const paste = async (destination?: string) => {
    if (!location || !clipboard || clipboard.sessionId !== location.session.id) return;
    const succeeded = await action({
      operation: clipboard.cut ? 'move' : 'copy',
      paths: clipboard.paths,
      destination: destination ?? location.listing.relativePath,
    });
    if (succeeded && clipboard.cut) setClipboard(null);
  };
  const openEntry = (entry: ExplorerEntry) => {
    if (!location || loading || busy) return;
    if (entry.isDirectory) void load(explorerAbsolutePath(location.session.root, entry.relativePath));
    else void action({ operation: 'open', paths: [entry.relativePath] });
  };
  const navigateHistory = (offset: number) => {
    const index = history.index + offset;
    if (history.paths[index]) void load(history.paths[index], { historyIndex: index });
  };
  return {
    location,
    loading,
    busy,
    error,
    partial,
    entries,
    selection,
    clipboard,
    search,
    setSearch,
    showHidden,
    setShowHidden,
    sort,
    setSort,
    descending,
    setDescending,
    select,
    setSelection,
    load,
    listDirectory,
    refresh,
    action,
    conflict,
    confirmConflict,
    cancelConflict,
    paste,
    storeClipboard,
    openEntry,
    canBack: history.index > 0,
    canForward: history.index >= 0 && history.index < history.paths.length - 1,
    navigateHistory,
  };
};
