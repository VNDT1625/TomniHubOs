/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveSessionRegistry } from './liveSessionRegistry';

/**
 * Applies a third-party package's `sessions.report` capability call. The app id is the verified package id
 * from the capability lease; nothing in `args` can choose or override it.
 */
export const reportPackageSessions = (registry: LiveSessionRegistry, packageId: string, args: unknown): boolean => {
  const record = args && typeof args === 'object' ? (args as { sessions?: unknown; actions?: unknown }) : undefined;
  return registry.report(packageId, record?.sessions, record?.actions);
};
