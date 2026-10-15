/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageNotificationPost } from '@/common/packages';

/**
 * Notifications posted by installed package apps through the supervised
 * `notifications.post` capability (the package must declare `notifications.show`).
 *
 * Package text is untrusted: it is bounded, its links must be https, and it
 * cannot rank itself — a package may only suggest "normal" or "important",
 * never urgent, and the hub's rules and the user's mutes still apply. Each
 * package is limited to a few posts per hour.
 */

export type PackageNotificationEvent = {
  key: string;
  packageId: string;
  sourceLabel: string;
  title: string;
  body: string;
  url?: string;
  important: boolean;
};

const MAX_PER_HOUR = 30;

const safeHttpsUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 2_000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Validates one post; returns undefined for malformed input. */
export const normalizePackagePost = (value: unknown): PackageNotificationPost | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const title = text(record.title, 200);
  if (!title) return undefined;
  const body = text(record.body, 500);
  const url = safeHttpsUrl(record.url);
  const id = text(record.id, 120);
  return {
    title,
    ...(body ? { body } : {}),
    ...(url ? { url } : {}),
    ...(id ? { id } : {}),
    ...(record.importance === 'important' ? { importance: 'important' as const } : {}),
  };
};

/** Per-package hourly limiter plus event shaping. */
export const createPackageNotificationGate = (now: () => number = Date.now) => {
  const windows = new Map<string, { hour: number; count: number }>();
  return (
    packageId: string,
    label: string,
    post: PackageNotificationPost
  ): PackageNotificationEvent | { error: 'rate-limited' } => {
    const hour = Math.floor(now() / 3_600_000);
    const entry = windows.get(packageId);
    if (!entry || entry.hour !== hour) windows.set(packageId, { hour, count: 1 });
    else if (entry.count >= MAX_PER_HOUR) return { error: 'rate-limited' };
    else entry.count += 1;
    return {
      key: `app:${packageId}:${post.id ?? `${now()}:${post.title}`}`,
      packageId,
      sourceLabel: label.slice(0, 80) || packageId,
      title: post.title,
      body: post.body ?? '',
      url: post.url,
      important: post.importance === 'important',
    };
  };
};
