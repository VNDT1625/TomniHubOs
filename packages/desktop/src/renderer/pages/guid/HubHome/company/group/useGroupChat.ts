/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getGroupSnapshot, subscribeGroup, type GroupSnapshot } from './groupEngine';
import { GROUP_META_CHANGED_EVENT, readMeta, writeMeta, type GroupMeta } from './groupMeta';

/** Live view of one group's transcript and running turns. The engine keeps running without it. */
export function useGroupSnapshot(key: string): GroupSnapshot {
  return useSyncExternalStore(
    useCallback((listener: () => void) => subscribeGroup(key, listener), [key]),
    () => getGroupSnapshot(key)
  );
}

/** A group's goal, calendar and workflows, kept in sync across every view that shows them. */
export function useGroupMeta(key: string): [GroupMeta, (update: (current: GroupMeta) => GroupMeta) => void] {
  const [meta, setMeta] = useState<GroupMeta>(() => readMeta(key));

  useEffect(() => {
    setMeta(readMeta(key));
    const onChange = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === key) setMeta(readMeta(key));
    };
    window.addEventListener(GROUP_META_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(GROUP_META_CHANGED_EVENT, onChange);
  }, [key]);

  const update = useCallback(
    (change: (current: GroupMeta) => GroupMeta): void => writeMeta(key, change(readMeta(key))),
    [key]
  );
  return [meta, update];
}
