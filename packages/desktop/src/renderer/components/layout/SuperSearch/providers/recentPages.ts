/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { normaliseText } from './localProvider';

/** A page the user opened through Super Search; shown by name in later suggestions. */
export type RecentPage = { title: string; url: string };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'tomny:super-search:recent-pages:v1';
const MAX_STORED = 50;
export const MAX_PAGE_SUGGESTIONS = 10;

const defaultStorage = (): StorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const load = (storage: StorageLike | undefined): RecentPage[] => {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentPage =>
        typeof item?.title === 'string' && typeof item?.url === 'string' && isHttpUrl(item.url)
    );
  } catch {
    return [];
  }
};

/** Stores the page (newest first, de-duplicated by URL). Storage failures are ignored. */
export const recordRecentPage = (page: RecentPage, storage: StorageLike | undefined = defaultStorage()): void => {
  const title = page.title.trim().slice(0, 200);
  if (!title || !isHttpUrl(page.url)) return;
  try {
    const next = [{ title, url: page.url }, ...load(storage).filter((item) => item.url !== page.url)];
    storage?.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, MAX_STORED)));
  } catch {
    // Storage may be blocked; suggestions simply stay empty.
  }
};

/** Remembered pages whose name or address contains every query word, newest first, at most 10. */
export const findRecentPages = (query: string, storage: StorageLike | undefined = defaultStorage()): RecentPage[] => {
  const words = normaliseText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return load(storage)
    .filter((page) => {
      const haystack = normaliseText(`${page.title} ${page.url}`);
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, MAX_PAGE_SUGGESTIONS);
};
