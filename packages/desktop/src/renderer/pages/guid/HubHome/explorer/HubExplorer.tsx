import type { ExplorerEntry } from '@/common/types/platform/explorer';
import { Dropdown, Input, Menu, Modal, Tooltip } from '@arco-design/web-react';
import {
  Crosshair as Aiming,
  ChevronDown as Down,
  ChevronUp as Up,
  Columns3 as TableFile,
  Clipboard,
  Copy,
  Scissors as Cutting,
  Ellipsis as More,
  Info as PropertiesIcon,
  Blocks as BlockIcon,
  Lock,
  Trash2 as Delete,
  Pencil as Edit,
  FilePlus as FileAddition,
  AppWindow,
  FileText,
  FolderOpen,
  FolderPlus,
  RefreshCw as Refresh,
  ChevronRight as Right,
  Search,
  ListTree,
} from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { explorerAbsolutePath, explorerCrumbs, explorerFileType, explorerSize } from './path';
import { useExplorer } from './useExplorer';

import { fileViewerPath } from '@/renderer/pages/integrations/fileViewer/fileViewerRoute';

type HubExplorerProps = {
  workspaceName?: string;
  onFocusDirectory: (path: string) => Promise<void> | void;
  focusDisabled?: boolean;
};
type NameDialog = {
  operation: 'create-file' | 'create-directory' | 'rename' | 'group';
  paths: string[];
  name: string;
  destination?: string;
};

const explorerParentPath = (relativePath: string): string => relativePath.split('/').slice(0, -1).join('/');

type ToolProps = { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode };
const Tool: React.FC<ToolProps> = ({ label, disabled, onClick, children }) => (
  <Tooltip content={label}>
    <button type='button' className='hub-explorer-tool' aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  </Tooltip>
);

/** Human file operations use only the narrow, sender-bound native Explorer API. */
export const HubExplorer: React.FC<HubExplorerProps> = ({ workspaceName, onFocusDirectory, focusDisabled }) => {
  const { t, i18n } = useTranslation();
  const explorer = useExplorer(workspaceName);
  const [detailColumn, setDetailColumn] = useState<'size' | 'type' | 'date'>('type');
  const [viewMode, setViewMode] = useState<'tree' | 'detail'>('tree');
  const [isWide, setIsWide] = useState(false);
  const [breadcrumbsCollapsed, setBreadcrumbsCollapsed] = useState(false);
  const [breadcrumbRequiredWidth, setBreadcrumbRequiredWidth] = useState(0);
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [childEntries, setChildEntries] = useState<Record<string, ExplorerEntry[]>>({});
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set());
  const [draggingPaths, setDraggingPaths] = useState<string[]>([]);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dropGroupTarget, setDropGroupTarget] = useState(false);
  const [blankDropTarget, setBlankDropTarget] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [conflictFollowUp, setConflictFollowUp] = useState<((newName: string) => Promise<void>) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const crumbsRef = useRef<HTMLOListElement>(null);
  const key = (name: string) => t(`guid.hubHome.explorer.${name}`);
  const { location, selection, entries, loading, busy } = explorer;
  const disabled = loading || busy || focusBusy;
  const absolute = location ? explorerAbsolutePath(location.session.root, location.listing.relativePath) : '';
  const crumbs = absolute ? explorerCrumbs(absolute) : [];
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null;
  const selected = location?.listing.entries.filter((entry) => selection.includes(entry.relativePath)) ?? [];
  const one = selected.length === 1 ? selected[0] : undefined;
  const focusPath =
    one?.isDirectory && location ? explorerAbsolutePath(location.session.root, one.relativePath) : absolute;
  const pasteDisabled =
    disabled || !location || !explorer.clipboard || explorer.clipboard.sessionId !== location.session.id;
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' });
  // A rename/create conflict opens its own dialog, so the name prompt retires unless a
  // group follow-up still owns it and closes it after the retry.
  useEffect(() => {
    if (explorer.conflict !== null && conflictFollowUp === null && nameDialog !== null) setNameDialog(null);
  }, [explorer.conflict, conflictFollowUp, nameDialog]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = (): void => setIsWide(container.clientWidth >= 480);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setBreadcrumbsCollapsed(false);
    setBreadcrumbRequiredWidth(0);
  }, [absolute]);

  useLayoutEffect(() => {
    const element = crumbsRef.current;
    if (!element) return;
    const update = (): void => {
      const availableWidth = element.clientWidth;
      if (breadcrumbsCollapsed) {
        if (availableWidth >= breadcrumbRequiredWidth) setBreadcrumbsCollapsed(false);
        return;
      }
      if (element.scrollWidth > availableWidth + 1) {
        setBreadcrumbRequiredWidth(element.scrollWidth);
        setBreadcrumbsCollapsed(true);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [absolute, breadcrumbRequiredWidth, breadcrumbsCollapsed]);

  // Navigating to a different folder resets tree state; refreshing the same folder must keep it.
  useEffect(() => {
    setNameDialog(null);
    setEditingPath(false);
    setFocusError(false);
    setPropertiesOpen(false);
    setExpandedDirectories(new Set());
    setChildEntries({});
    setLoadingDirectories(new Set());
  }, [location?.session.id, location?.listing.relativePath]);

  // A refresh (or post-action reload) replaces the location object while keeping the same folder.
  // Refetch the still-expanded directories' children so the tree reflects committed changes.
  useEffect(() => {
    if (!location) return;
    const expanded = [...expandedDirectories];
    if (!expanded.length) return;
    void Promise.all(
      expanded.map(async (relativePath) => {
        const listing = await explorer.listDirectory(relativePath);
        if (listing) setChildEntries((current) => ({ ...current, [relativePath]: listing.entries }));
      })
    );
    // Keyed on object identity so only true reloads trigger a refetch of the preserved expansion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const toggleDirectory = async (entry: ExplorerEntry): Promise<void> => {
    if (!entry.isDirectory || disabled) return;
    if (expandedDirectories.has(entry.relativePath)) {
      setExpandedDirectories((current) => {
        const next = new Set(current);
        next.delete(entry.relativePath);
        return next;
      });
      return;
    }
    if (!childEntries[entry.relativePath]) {
      setLoadingDirectories((current) => new Set(current).add(entry.relativePath));
      const listing = await explorer.listDirectory(entry.relativePath);
      setLoadingDirectories((current) => {
        const next = new Set(current);
        next.delete(entry.relativePath);
        return next;
      });
      if (!listing) return;
      setChildEntries((current) => ({ ...current, [entry.relativePath]: listing.entries }));
    }
    setExpandedDirectories((current) => new Set(current).add(entry.relativePath));
  };

  const editPath = () => {
    setPathDraft(absolute);
    setEditingPath(true);
  };
  const rename = () => {
    if (one && !disabled) setNameDialog({ operation: 'rename', paths: [one.relativePath], name: one.name });
  };
  // Right-clicking one selected folder means commands act inside that folder, not the parent.
  const contextParent = (): string => {
    if (!location) return '';
    return one?.isDirectory ? one.relativePath : location.listing.relativePath;
  };
  const create = (directory: boolean) => {
    if (location && !disabled)
      setNameDialog({
        operation: directory ? 'create-directory' : 'create-file',
        paths: [contextParent()],
        name: '',
      });
  };
  const remove = () => {
    if (selection.length && !disabled) void explorer.action({ operation: 'delete', paths: selection });
  };
  const focus = async () => {
    if (!focusPath || disabled || focusDisabled) return;
    setFocusBusy(true);
    setFocusError(false);
    try {
      await onFocusDirectory(focusPath);
    } catch {
      setFocusError(true);
    } finally {
      setFocusBusy(false);
    }
  };
  const submitName = async () => {
    if (!nameDialog || !nameDialog.name.trim() || disabled) return;
    const name = nameDialog.name.trim();
    const { operation, paths, destination } = nameDialog;
    if (operation === 'group') {
      const groupParent = destination ?? '';
      const grouped = groupParent ? `${groupParent}/${name}` : name;
      // Arm the follow-up before the create: if the group name collides, confirming the
      // conflict rename moves the selection into the group under its new name.
      setConflictFollowUp(() => async (newName: string) => {
        setConflictFollowUp(null);
        const target = groupParent ? `${groupParent}/${newName}` : newName;
        const moved = await explorer.action({ operation: 'move', paths, destination: target });
        if (moved) setNameDialog(null);
      });
      const created = await explorer.action({ operation: 'create-directory', paths: [groupParent], name });
      if (!created) return;
      setConflictFollowUp(null);
      setNameDialog(null);
      await explorer.action({ operation: 'move', paths, destination: grouped });
      return;
    }
    const succeeded = await explorer.action({ operation, paths, name });
    if (succeeded) setNameDialog(null);
  };
  const open = () => {
    if (one) explorer.openEntry(one);
  };
  const reveal = () => {
    if (one) void explorer.action({ operation: 'reveal', paths: [one.relativePath] });
  };

  // "Open in Hub": Main issues an opaque view id for the file; the centre viewer route carries only that id.
  const openInHub = () => {
    if (!one || one.isDirectory || !location) return;
    void window.electronAPI?.fileViewer
      ?.openFromExplorer({ sessionId: location.session.id, relativePath: one.relativePath })
      .then((result) => {
        if (result.ok) window.location.hash = '#' + fileViewerPath({ kind: 'view', id: result.data.viewId });
      })
      .catch((): undefined => undefined);
  };
  // Every command on the context menu acts on the right-clicked object, which is always selected.
  const selectionBlocked = selected.length > 0 && selected.every((entry) => entry.blocked);
  const copyAsPath = () => {
    if (!location || !selected.length || disabled) return;
    const root = location.session.root;
    // Windows convention: quote paths that contain spaces so a paste into a terminal stays one token.
    const lines = selected.map((entry) => {
      const absolute = explorerAbsolutePath(root, entry.relativePath);
      return /\s/.test(absolute) ? `"${absolute}"` : absolute;
    });
    void navigator.clipboard?.writeText(lines.join('\n')).catch((): undefined => undefined);
  };
  const toggleBlock = () => {
    if (!selected.length || disabled) return;
    const operation = selectionBlocked ? 'unblock' : 'block';
    void explorer.action({ operation, paths: selected.map((entry) => entry.relativePath) });
  };
  const properties = () => {
    if (selected.length) setPropertiesOpen(true);
  };
  const menu = (
    <Menu
      className='hub-explorer-menu hub-explorer-actions'
      onClickMenuItem={(command) => {
        if (disabled) return;
        switch (command) {
          case 'open':
            open();
            break;
          case 'reveal':
            reveal();
            break;

          case 'openInHub':
            openInHub();
            break;
          case 'focus':
            void focus();
            break;
          case 'copy':
            explorer.storeClipboard(false);
            break;
          case 'cut':
            explorer.storeClipboard(true);
            break;
          case 'paste':
            void explorer.paste(one?.isDirectory ? one.relativePath : location?.listing.relativePath);
            break;
          case 'rename':
            rename();
            break;
          case 'delete':
            remove();
            break;
          case 'copyAsPath':
            copyAsPath();
            break;
          case 'properties':
            properties();
            break;
          case 'block':
            toggleBlock();
            break;
          case 'unblock':
            toggleBlock();
            break;
          case 'newFolder':
            create(true);
            break;
          case 'newFile':
            create(false);
            break;
        }
      }}
    >
      <Menu.Item key='open' disabled={!one || disabled}>
        <FileText size={16} />
        {key('open')}
      </Menu.Item>

      <Menu.Item key='openInHub' disabled={!one || one.isDirectory || disabled}>
        <AppWindow size={16} />
        {key('openInHub')}
      </Menu.Item>
      <Menu.Item key='reveal' disabled={!one || disabled}>
        <FolderOpen size={16} />
        {key('reveal')}
      </Menu.Item>
      <Menu.Item key='focus' disabled={!focusPath || disabled || focusDisabled}>
        <Aiming size={16} />
        {key('focusDirectory')}
      </Menu.Item>
      <Menu.Item key='copy' disabled={!selection.length || disabled}>
        <Copy size={16} />
        {key('copy')}
      </Menu.Item>
      <Menu.Item key='cut' disabled={!selection.length || disabled}>
        <Cutting size={16} />
        {key('cut')}
      </Menu.Item>
      <Menu.Item key='paste' disabled={pasteDisabled}>
        <Clipboard size={16} />
        {key('paste')}
      </Menu.Item>
      <Menu.Item key='rename' disabled={!one || disabled}>
        <Edit size={16} />
        {key('rename')}
      </Menu.Item>
      <Menu.Item key='copyAsPath' disabled={!selected.length || disabled}>
        <Copy size={16} />
        {key('copyAsPath')}
      </Menu.Item>
      <Menu.Item key='properties' disabled={!selected.length || disabled}>
        <PropertiesIcon size={16} />
        {key('properties')}
      </Menu.Item>
      <Menu.Item key={selectionBlocked ? 'unblock' : 'block'} disabled={!selected.length || disabled}>
        {selectionBlocked ? <Lock size={16} /> : <BlockIcon size={16} />}
        {key(selectionBlocked ? 'unblock' : 'block')}
      </Menu.Item>
      <Menu.Item key='delete' disabled={!selection.length || disabled}>
        <Delete size={16} />
        {key('delete')}
      </Menu.Item>
      <Menu.Item key='newFolder' disabled={!location || disabled}>
        <FolderPlus size={16} />
        {key('newFolder')}
      </Menu.Item>
      <Menu.Item key='newFile' disabled={!location || disabled}>
        <FileAddition size={16} />
        {key('newFile')}
      </Menu.Item>
    </Menu>
  );
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest('input,textarea,[contenteditable="true"]') || target.closest('[role="menu"]'))
    )
      return;
    if (disabled || nameDialog) return;
    const command = event.ctrlKey || event.metaKey;
    const pressed = event.key.toLowerCase();
    if (command && pressed === 'a') explorer.setSelection(entries.map((entry) => entry.relativePath));
    else if (command && pressed === 'c') explorer.storeClipboard(false);
    else if (command && pressed === 'x') explorer.storeClipboard(true);
    else if (command && pressed === 'v') void explorer.paste();
    else if (command && pressed === 'l') editPath();
    else if (event.key === 'F2') rename();
    else if (event.key === 'Delete') remove();
    else if (event.key === 'F5') explorer.refresh();
    else if (event.altKey && event.key === 'ArrowLeft') explorer.navigateHistory(-1);
    else if (event.altKey && event.key === 'ArrowRight') explorer.navigateHistory(1);
    else if (event.key === 'Backspace' && parent) void explorer.load(parent);
    else if (event.key === 'Enter' && one && target === containerRef.current) open();
    else return;
    event.preventDefault();
  };
  const startDrag = (event: React.DragEvent<HTMLButtonElement>, entry: ExplorerEntry): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const paths = selection.includes(entry.relativePath) ? selection : [entry.relativePath];
    if (!selection.includes(entry.relativePath)) explorer.select(entry.relativePath, false, false);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-tomni-explorer-paths', JSON.stringify(paths));
    event.dataTransfer.setData(
      'application/x-tomni-explorer-entries',
      JSON.stringify(
        paths.map((relativePath) => ({
          relativePath,
          kind: (location?.listing.entries.find((candidate) => candidate.relativePath === relativePath)?.isDirectory
            ? 'folder'
            : 'file') as 'file' | 'folder',
          ...(location ? { sessionId: location.session.id } : {}),
        }))
      )
    );
        // Preserve the Explorer's Main-issued root so a chat drop resolves relative paths in the correct workspace.
    if (location) event.dataTransfer.setData('application/x-tomni-explorer-workspace-root', location.session.root);
    event.dataTransfer.setData('text/plain', paths.join('\n'));
    setDraggingPaths(paths);
  };

  const canDropOn = (entry: ExplorerEntry): boolean =>
    draggingPaths.length > 0 &&
    !disabled &&
    !draggingPaths.some(
      (path) =>
        path === entry.relativePath ||
        entry.relativePath.startsWith(`${path}/`) ||
        (entry.isDirectory && explorerParentPath(path) === entry.relativePath)
    );
  /** A runner over a folder is a plain move unless Ctrl/Meta forces a group. */
  const groupsOnFolder = (forceGroup: boolean): boolean => forceGroup;

  const endDrag = (): void => {
    setDraggingPaths([]);
    setDropTargetPath(null);
    setDropGroupTarget(false);
    setBlankDropTarget(false);
  };

  const dropOn = (event: React.DragEvent<HTMLButtonElement>, entry: ExplorerEntry): void => {
    event.preventDefault();
    const paths = draggingPaths;
    const allowed = canDropOn(entry) && Boolean(location);
    endDrag();
    if (!allowed) return;
    if (entry.isDirectory && !(event.ctrlKey || event.metaKey)) {
      // (4c) Into a folder: plain move.
      void explorer.action({ operation: 'move', paths, destination: entry.relativePath });
      return;
    }
    // (4b) Onto a file (or a Ctrl-drop onto a folder): group into a new folder placed in the
    // folder that contains the dropped object.
    const groupedPaths = [...new Set([...paths, entry.relativePath])];
    const destination = explorerParentPath(entry.relativePath);
    setNameDialog({ operation: 'group', paths: groupedPaths, destination, name: '' });
  };

  // (4a) Dropping onto blank space moves into the current viewed folder.
  const canDropOnBlank = (): boolean =>
    draggingPaths.length > 0 &&
    !disabled &&
    Boolean(location) &&
    draggingPaths.some((path) => explorerParentPath(path) !== location!.listing.relativePath);
  const dropOnBlank = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!canDropOnBlank()) {
      endDrag();
      return;
    }
    const destination = location!.listing.relativePath;
    const paths = draggingPaths;
    endDrag();
    void explorer.action({ operation: 'move', paths, destination });
  };

  const row = (entry: ExplorerEntry, tree = true): React.ReactNode => {
    const expanded = tree && expandedDirectories.has(entry.relativePath);
    const children = childEntries[entry.relativePath] ?? [];
    const loadingChildren = loadingDirectories.has(entry.relativePath);
    return (
      <React.Fragment key={entry.relativePath}>
        <Dropdown trigger='contextMenu' disabled={disabled} droplist={menu}>
          <button
            type='button'
            role='option'
            aria-selected={selection.includes(entry.relativePath)}
            aria-expanded={tree && entry.isDirectory ? expanded : undefined}
            draggable={!disabled}
            aria-grabbed={draggingPaths.includes(entry.relativePath)}
            onDragStart={(event) => {
              setDropTargetPath(null);
              startDrag(event, entry);
            }}
            onDragEnd={endDrag}
            data-drop-target={dropTargetPath === entry.relativePath ? 'true' : undefined}
            data-drop-group={dropGroupTarget ? 'true' : undefined}
            onDragOver={(event) => {
              if (!canDropOn(entry)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setBlankDropTarget(false);
              setDropTargetPath(entry.relativePath);
              setDropGroupTarget(!entry.isDirectory || groupsOnFolder(event.ctrlKey || event.metaKey));
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropTargetPath(null);
                setDropGroupTarget(false);
              }
            }}
            onDrop={(event) => dropOn(event, entry)}
            className={`hub-explorer-row${tree ? '' : ' hub-explorer-row--detail'}${explorer.clipboard?.cut && explorer.clipboard.paths.includes(entry.relativePath) ? ' hub-explorer-row-cut' : ''}${entry.blocked ? ' hub-explorer-row-blocked' : ''}`}
            title={entry.name}
            aria-label={entry.name}
            disabled={disabled}
            onClick={(event) => {
              const withinToggle =
                tree && entry.isDirectory && event.clientX - event.currentTarget.getBoundingClientRect().left < 30;
              if (withinToggle) {
                void toggleDirectory(entry);
                return;
              }
              explorer.select(entry.relativePath, event.ctrlKey || event.metaKey, event.shiftKey);
            }}
            onDoubleClick={() => explorer.openEntry(entry)}
            onContextMenu={(event) => {
              event.stopPropagation();
              if (!selection.includes(entry.relativePath)) explorer.select(entry.relativePath, false, false);
            }}
            onKeyDown={(event) => {
              if (tree && entry.isDirectory && event.key === 'ArrowRight' && !expanded) {
                event.preventDefault();
                void toggleDirectory(entry);
                return;
              }
              if (tree && entry.isDirectory && event.key === 'ArrowLeft' && expanded) {
                event.preventDefault();
                void toggleDirectory(entry);
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                explorer.openEntry(entry);
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const options = [
                  ...(containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
                ];
                const index = options.indexOf(event.currentTarget);
                const next = options[index + (event.key === 'ArrowDown' ? 1 : -1)];
                next?.focus();
              }
            }}
          >
            {tree && (
              <span
                className={entry.isDirectory ? 'hub-explorer-tree-toggle' : 'hub-explorer-tree-spacer'}
                aria-hidden='true'
              >
                {entry.isDirectory && (expanded ? <Down size={13} /> : <Right size={13} />)}
              </span>
            )}
            <span className='hub-explorer-name'>
              {entry.isDirectory ? <FolderOpen size={16} /> : <FileText size={16} />}
              <span>{entry.name}</span>
              {entry.blocked && (
                <span title={key('blocked')}>
                  <Lock size={12} className='hub-explorer-lock' aria-label={key('blocked')} />
                </span>
              )}
            </span>
            {(!tree || isWide) && (
              <>
                <span className='hub-explorer-size'>{entry.isDirectory ? '' : explorerSize(entry.size)}</span>
                <span className='hub-explorer-type'>
                  {entry.isDirectory ? key('folderType') : explorerFileType(entry.name) || key('fileType')}
                </span>
                <span className='hub-explorer-date'>
                  {Number.isFinite(entry.modifiedAt) ? dateFormatter.format(entry.modifiedAt) : ''}
                </span>
              </>
            )}
          </button>
        </Dropdown>
        {tree && entry.isDirectory && expanded && (
          <div className='hub-explorer-tree-children'>
            {loadingChildren ? (
              <div className='hub-explorer-tree-loading' role='status'>
                {key('loading')}
              </div>
            ) : (
              children.map((child) => row(child, tree))
            )}
          </div>
        )}
      </React.Fragment>
    );
  };

  return (
    <div
      ref={containerRef}
      className='hub-explorer'
      data-detail-column={detailColumn}
      data-wide={isWide}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid='hub-explorer'
      aria-busy={loading || busy}
    >
      <div className='hub-explorer-navigation'>
        <Dropdown trigger='click' droplist={menu} disabled={disabled}>
          <button
            type='button'
            className='hub-explorer-tool'
            aria-label={key('more')}
            title={key('more')}
            aria-haspopup='menu'
          >
            <More size={16} />
          </button>
        </Dropdown>{' '}
        <Tool label={key('refresh')} disabled={disabled} onClick={explorer.refresh}>
          <Refresh size={16} className={loading ? 'hub-icon-spinning' : undefined} />
        </Tool>
        <div className='hub-explorer-search'>
          <Input
            size='mini'
            prefix={<Search size={14} />}
            placeholder={key('search')}
            aria-label={key('search')}
            value={explorer.search}
            onChange={explorer.setSearch}
            allowClear
            disabled={disabled}
          />
        </div>
        <Tool
          label={key('pickFolder')}
          disabled={disabled}
          onClick={() => void explorer.load(undefined, { pick: true })}
        >
          <FolderOpen size={16} />
        </Tool>
      </div>
      {(editingPath || crumbs.length > 0) && (
        <nav className='hub-explorer-path' aria-label={key('pathLabel')} title={absolute}>
          {editingPath ? (
            <Input
              autoFocus
              value={pathDraft}
              aria-label={key('pathLabel')}
              disabled={disabled}
              onChange={setPathDraft}
              onPressEnter={() => {
                if (pathDraft.trim()) {
                  setEditingPath(false);
                  void explorer.load(pathDraft.trim());
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditingPath(false);
              }}
              onBlur={() => setEditingPath(false)}
            />
          ) : (
            <>
              <ol ref={crumbsRef} className='hub-explorer-crumbs'>
                {crumbs.map((crumb, index) => {
                  if (breadcrumbsCollapsed && crumbs.length > 3 && index > 0 && index < crumbs.length - 2) {
                    if (index !== 1) return null;
                    return (
                      <li key='ancestors'>
                        <Right size={12} />
                        <Dropdown
                          trigger='click'
                          droplist={
                            <Menu className='hub-explorer-menu'>
                              {crumbs.slice(1, -2).map((ancestor) => (
                                <Menu.Item key={ancestor.path} onClick={() => void explorer.load(ancestor.path)}>
                                  {ancestor.label}
                                </Menu.Item>
                              ))}
                            </Menu>
                          }
                          disabled={disabled}
                        >
                          <button type='button' disabled={disabled} aria-label={key('pathLabel')} aria-haspopup='menu'>
                            ...
                          </button>
                        </Dropdown>
                      </li>
                    );
                  }
                  return (
                    <li key={crumb.path} aria-current={index === crumbs.length - 1 ? 'location' : undefined}>
                      {index > 0 && <Right size={12} />}
                      <button
                        type='button'
                        title={crumb.path}
                        disabled={disabled}
                        onClick={() => void explorer.load(crumb.path)}
                      >
                        {crumb.label}
                      </button>
                    </li>
                  );
                })}{' '}
              </ol>
            </>
          )}
        </nav>
      )}
      {(explorer.error || focusError) && (
        <div className={location ? 'hub-explorer-error' : 'hub-explorer-unavailable'} role='alert'>
          {explorer.error ? key(`errors.${explorer.error}`) : key('errors.generic')}
        </div>
      )}
      {explorer.partial && (
        <div className='hub-explorer-error' role='alert'>
          {key('partial')}
        </div>
      )}
      {location && (
        <div className='hub-explorer-columns' data-view={isWide ? 'tree' : viewMode}>
          {(isWide || viewMode === 'detail' ? (['name', 'size', 'type', 'date'] as const) : (['name'] as const)).map(
            (field) => (
              <button
                key={field}
                data-column={field}
                type='button'
                disabled={disabled}
                aria-label={key(field === 'date' ? 'modified' : field)}
                aria-pressed={explorer.sort === field}
                data-direction={
                  explorer.sort === field ? (explorer.descending ? 'descending' : 'ascending') : undefined
                }
                onClick={() => {
                  explorer.setDescending(explorer.sort === field ? !explorer.descending : false);
                  explorer.setSort(field);
                }}
              >
                <span>{key(field === 'date' ? 'modified' : field)}</span>
                {explorer.sort === field && (explorer.descending ? <Down size={10} /> : <Up size={10} />)}
              </button>
            )
          )}
          <Dropdown
            trigger='click'
            droplist={
              <Menu className='hub-explorer-menu'>
                {(['size', 'type', 'date'] as const).map((field) => (
                  <Menu.Item
                    key={field}
                    onClick={() => {
                      setDetailColumn(field);
                      setViewMode('detail');
                    }}
                  >
                    {key(field === 'date' ? 'modified' : field)}
                  </Menu.Item>
                ))}
              </Menu>
            }
          >
            <button
              type='button'
              className='hub-explorer-tool hub-explorer-column-picker'
              aria-label={key('detailColumn')}
              title={key('detailColumn')}
              aria-haspopup='menu'
            >
              <Down size={12} />
            </button>
          </Dropdown>
        </div>
      )}
      <Dropdown trigger='contextMenu' disabled={disabled} droplist={menu}>
        <div
          className='hub-explorer-list'
          role='listbox'
          aria-label={key('files')}
          aria-multiselectable='true'
          data-blank-drop-target={blankDropTarget ? 'true' : undefined}
          onContextMenu={(event) => {
            if (event.target instanceof Element && !event.target.closest('.hub-explorer-row')) {
              explorer.setSelection([]);
            }
          }}
          onDragOver={(event) => {
            if (event.target instanceof Element && event.target.closest('.hub-explorer-row')) return;
            if (!canDropOnBlank()) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTargetPath(null);
            setDropGroupTarget(false);
            setBlankDropTarget(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBlankDropTarget(false);
          }}
          onDrop={(event) => {
            void dropOnBlank(event);
          }}
        >
          {entries.map((entry) => row(entry, isWide || viewMode === 'tree'))}
          {!entries.length && !loading && !explorer.error && (
            <div className='hub-explorer-empty'>{key(explorer.search ? 'noMatches' : 'empty')}</div>
          )}
          {loading && (
            <div className='hub-explorer-loading' role='status'>
              {key('loading')}
            </div>
          )}
        </div>
      </Dropdown>
      {location && (
        <div className='hub-explorer-status' role='status'>
          <span>{t('guid.hubHome.explorer.items', { count: entries.length })}</span>
          {selection.length > 0 && <span>{t('guid.hubHome.explorer.selected', { count: selection.length })}</span>}
          {location?.listing.truncated && <span>{key('truncated')}</span>}
          {!isWide && (
            <button
              type='button'
              className='hub-explorer-view-toggle'
              aria-label={key('viewMode')}
              title={key('viewMode')}
              aria-pressed={viewMode === 'tree'}
              onClick={() => setViewMode((current) => (current === 'tree' ? 'detail' : 'tree'))}
            >
              {viewMode === 'tree' ? <TableFile size={14} /> : <ListTree size={14} />}
            </button>
          )}
        </div>
      )}
      <Modal
        className='hub-explorer-dialog'
        visible={nameDialog !== null}
        title={key(
          nameDialog?.operation === 'rename'
            ? 'rename'
            : nameDialog?.operation === 'create-directory' || nameDialog?.operation === 'group'
              ? 'newFolder'
              : 'newFile'
        )}
        okText={key('save')}
        cancelText={key('cancel')}
        confirmLoading={busy}
        okButtonProps={{ disabled: !nameDialog?.name.trim() || loading }}
        onCancel={() => {
          if (!busy) {
            setNameDialog(null);
            setConflictFollowUp(null);
          }
        }}
        onOk={submitName}
        unmountOnExit
      >
        <label className='hub-explorer-dialog-label'>
          {key('nameLabel')}
          <Input
            autoFocus
            value={nameDialog?.name ?? ''}
            disabled={busy}
            maxLength={255}
            onChange={(name) => setNameDialog((current) => (current ? { ...current, name } : null))}
            onPressEnter={() => void submitName()}
          />
        </label>
        {explorer.error && (
          <div className='hub-explorer-error' role='alert'>
            {key(`errors.${explorer.error}`)}
          </div>
        )}
      </Modal>
      <Modal
        className='hub-explorer-dialog'
        visible={explorer.conflict !== null}
        title={key('conflictTitle')}
        okText={key('rename')}
        cancelText={key('cancel')}
        confirmLoading={busy}
        onCancel={() => {
          if (!busy) {
            explorer.cancelConflict();
            setConflictFollowUp(null);
          }
        }}
        onOk={() => {
          const suggested = explorer.conflict?.suggestedName;
          const follow = conflictFollowUp;
          setConflictFollowUp(null);
          void explorer.confirmConflict().then((retried) => {
            if (retried && suggested && follow) void follow(suggested);
          });
        }}
        unmountOnExit
      >
        <p role='alert'>
          {t('guid.hubHome.explorer.conflictRename', { name: explorer.conflict?.suggestedName ?? '' })}
        </p>
      </Modal>
      {location && (
        <Modal
          className='hub-explorer-dialog'
          visible={propertiesOpen}
          title={key('properties')}
          okText={key('cancel')}
          cancelButtonProps={{ style: { display: 'none' } }}
          onCancel={() => setPropertiesOpen(false)}
          onOk={() => setPropertiesOpen(false)}
          unmountOnExit
        >
          {selected.map((entry) => (
            <dl key={entry.relativePath} className='hub-explorer-properties'>
              <div>
                <dt>{key('name')}</dt>
                <dd>{entry.name}</dd>
              </div>
              <div>
                <dt>{key('propertyType')}</dt>
                <dd>{entry.isDirectory ? key('folderType') : explorerFileType(entry.name) || key('fileType')}</dd>
              </div>
              {!entry.isDirectory && (
                <div>
                  <dt>{key('size')}</dt>
                  <dd>{explorerSize(entry.size)}</dd>
                </div>
              )}
              <div>
                <dt>{key('modified')}</dt>
                <dd>{Number.isFinite(entry.modifiedAt) ? dateFormatter.format(entry.modifiedAt) : ''}</dd>
              </div>
              <div>
                <dt>{key('propertyPath')}</dt>
                <dd>{explorerAbsolutePath(location.session.root, entry.relativePath)}</dd>
              </div>
            </dl>
          ))}
        </Modal>
      )}
    </div>
  );
};
