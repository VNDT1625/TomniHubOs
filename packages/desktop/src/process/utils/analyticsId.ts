/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const FILE_NAME = 'analytics.json';
const DIAGNOSTICS_CORRELATION_ROTATION_MS = 30 * 24 * 60 * 60 * 1_000;

type AnalyticsData = {
  id?: string;
  diagnosticsConsent?: boolean;
  diagnosticsCorrelation?: { id: string; rotatedAt: number };
};

const filePath = (): string => path.join(app.getPath('userData'), FILE_NAME);

const readAnalyticsData = (): AnalyticsData => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as AnalyticsData;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
};

const writeAnalyticsData = (data: AnalyticsData): void => {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(data), { mode: 0o600 });
  } catch {
    // Consent and correlation state are best-effort and must not block startup.
  }
};

/**
 * Returns a persistent anonymous analytics ID for this installation.
 * Stored in app.getPath('userData')/analytics.json.
 * No personal data is collected — the ID is a random UUID.
 */
export function getOrCreateAnalyticsId(): string {
  const data = readAnalyticsData();
  if (typeof data.id === 'string' && data.id.length > 0) return data.id;

  const id = crypto.randomUUID();
  writeAnalyticsData({ ...data, id });
  return id;
}

/** Diagnostics leave the device only after this Main-owned persisted opt-in. */
export const hasDiagnosticsConsent = (): boolean => readAnalyticsData().diagnosticsConsent === true;

/**
 * Main-only mutation point for an explicit diagnostics choice. A later IPC/UI
 * owner must authenticate and call this; renderer state never grants consent.
 */
export const setDiagnosticsConsent = (granted: boolean): void => {
  const data = readAnalyticsData();
  writeAnalyticsData({
    ...data,
    diagnosticsConsent: granted,
    ...(granted ? {} : { diagnosticsCorrelation: undefined }),
  });
};

/**
 * A rotation-bounded correlation identifier for opted-in diagnostics. It is
 * intentionally not an account identifier and is never created before consent.
 */
export const getRotatingDiagnosticsCorrelationId = (now = Date.now()): string | undefined => {
  if (!hasDiagnosticsConsent()) return undefined;
  const data = readAnalyticsData();
  const existing = data.diagnosticsCorrelation;
  if (
    existing &&
    typeof existing.id === 'string' &&
    existing.id.length > 0 &&
    Number.isFinite(existing.rotatedAt) &&
    now - existing.rotatedAt >= 0 &&
    now - existing.rotatedAt < DIAGNOSTICS_CORRELATION_ROTATION_MS
  ) {
    return existing.id;
  }
  const id = crypto.randomUUID();
  writeAnalyticsData({ ...data, diagnosticsCorrelation: { id, rotatedAt: now } });
  return id;
};
