/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live sessions of the IDE for the Hub "Active" list: the chats and files open in the current
 * workspace, grouped by the workspace folder name. Terminals are reported by the host, not here.
 */

import type { LiveSession } from '@/common/liveSessions/model';
import { baseName } from '@package-apps/shared/filePath';
import { useSyncExternalStore } from 'react';

/** Package id of the IDE; the Hub keys its Active entry by it. */
export const IDE_LIVE_SESSIONS_APP_ID = 'com.tomni.ide';

export type IdeChatTabInfo = { id: string; title: string; memId: string };

type Published = { rootPath: string | null; tabs: IdeChatTabInfo[] };

const EMPTY: IdeChatTabInfo[] = [];
let published: Published = { rootPath: null, tabs: EMPTY };
const listeners = new Set<() => void>();

/**
 * The chat panel owns the tabs but is only mounted in Chat mode; it publishes them here so the
 * workspace can keep reporting the chats (which stay alive) while another mode is shown.
 */
export const publishIdeChatTabs = (rootPath: string | null, tabs: readonly IdeChatTabInfo[]): void => {
  published = { rootPath, tabs: tabs.length === 0 ? EMPTY : [...tabs] };
  for (const listener of listeners) listener();
};

export const getIdeChatTabsFor = (rootPath: string | null): IdeChatTabInfo[] =>
  rootPath !== null && published.rootPath === rootPath ? published.tabs : EMPTY;

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Chat tabs published for `rootPath` (stable reference until they change). */
export const useIdeChatTabsFor = (rootPath: string | null): IdeChatTabInfo[] =>
  useSyncExternalStore(
    subscribe,
    () => getIdeChatTabsFor(rootPath),
    () => EMPTY
  );

export type BuildIdeLiveSessionsInput = {
  rootPath: string | null;
  openFiles: readonly string[];
  dirtyFiles: ReadonlySet<string>;
  chatTabs: readonly IdeChatTabInfo[];
  /** Localised "unsaved" label shown as detail on files with unsaved edits. */
  unsavedLabel: string;
};

export const buildIdeLiveSessions = (input: BuildIdeLiveSessionsInput): LiveSession[] => {
  const { rootPath, openFiles, dirtyFiles, chatTabs, unsavedLabel } = input;
  if (!rootPath) return [];
  const group = baseName(rootPath.replace(/[/\\]+$/, ''));
  const sessions: LiveSession[] = [];
  for (const tab of chatTabs) {
    sessions.push({ id: `chat:${tab.id}`, title: tab.title.trim() || group, status: 'idle', group });
  }
  for (const path of openFiles) {
    sessions.push({
      id: `file:${path}`,
      title: baseName(path) || path,
      status: 'idle',
      group,
      ...(dirtyFiles.has(path) ? { detail: unsavedLabel } : {}),
    });
  }
  return sessions;
};
