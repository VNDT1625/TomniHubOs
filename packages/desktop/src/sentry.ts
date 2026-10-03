/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import { gzipSync } from 'node:zlib';
import {
  getRotatingDiagnosticsCorrelationId,
  hasDiagnosticsConsent,
  setDiagnosticsConsent,
} from './process/utils/analyticsId';
import { readAutoUpdateDiagnostics } from './process/services/diagnostics/autoUpdateDiagnostics';

import { systemEgressAuthority } from './process/services/security/systemEgressAuthority';
import { collectBackendInstallDiagnostics } from './process/startup/backendInstallDiagnostics';
import { classifyBackendStartupFailure } from './process/startup/backendStartupFailure';
import {
  capturedErrorFromSentryEvent,
  sentryErrorTap,
  type SentryLikeEvent,
} from './process/monitor/sentryErrorSource';

// 抑制 Chromium GPU 崩溃噪声（参见 ELECTRON-9A / ELECTRON-9D）：
// 自愈逻辑在 gpuRecovery 中处理，事件流量已无价值。
const GPU_CRASH_DROP_PATTERNS = [
  /'GPU' process exited with /,
  /IntentionallyCrashBrowserForUnusableGpuProcess/,
  /GPU process isn't usable\. Goodbye/,
];
const BACKEND_STARTUP_SECONDARY_DROP_PATTERNS = [
  /globalThis\.__backendPort unset/,
  /window\.__backendPort/,
  /Failed to fetch/,
  /ECONNREFUSED/,
];

type SearchableEvent = {
  message?: unknown;
  exception?: { values?: unknown[] };
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

type SentryScope = {
  setContext: (key: string, value: unknown) => void;
  setExtra: (key: string, value: unknown) => void;
  setTag: (key: string, value: string) => void;
};

let sentryInitialized = false;

const MAX_DIAGNOSTIC_TEXT_LENGTH = 240;
const DIAGNOSTIC_SECRET_PATTERNS = [
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]+/gi,
  /\bsk-[a-z0-9_-]+/gi,
  /\bgh[pousr]_[a-z0-9_-]+/gi,
];
const DIAGNOSTIC_PATH_PATTERNS = [/[A-Za-z]:\\(?:[^\s"']+\\?)+/g, /\/(?:Users|home|tmp)\/(?:[^\s"']+\/?)*/g];

const redactDiagnosticText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  let redacted = value;
  for (const pattern of DIAGNOSTIC_SECRET_PATTERNS) redacted = redacted.replace(pattern, '[REDACTED_SECRET]');
  for (const pattern of DIAGNOSTIC_PATH_PATTERNS) redacted = redacted.replace(pattern, '[REDACTED_PATH]');
  return redacted.length > MAX_DIAGNOSTIC_TEXT_LENGTH ? `${redacted.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)}…` : redacted;
};

const safeDiagnosticValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (!value || typeof value !== 'object' || depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeDiagnosticValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, item]) => [key, safeDiagnosticValue(item, depth + 1)])
      .filter(([, item]) => item !== undefined)
  );
};

const redactSentryEvent = <T extends SearchableEvent>(event: T): T =>
  ({
    ...event,
    ...(event.message === undefined ? {} : { message: redactDiagnosticText(event.message) }),
    ...(event.exception === undefined ? {} : { exception: safeDiagnosticValue(event.exception) }),
    ...(event.contexts === undefined ? {} : { contexts: safeDiagnosticValue(event.contexts) }),
    ...(event.extra === undefined ? {} : { extra: safeDiagnosticValue(event.extra) }),
  }) as T;

function collectStringLeaves(value: unknown, haystacks: string[], seen = new WeakSet<object>(), depth = 0): void {
  if (typeof value === 'string') {
    haystacks.push(value);
    return;
  }
  if (!value || typeof value !== 'object' || depth > 6) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLeaves(item, haystacks, seen, depth + 1);
    }
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStringLeaves(item, haystacks, seen, depth + 1);
  }
}

function collectEventSearchText(event: SearchableEvent): string[] {
  const haystacks: string[] = [];
  if (typeof event.message === 'string') haystacks.push(event.message);
  const exceptions = event.exception?.values ?? [];
  for (const ex of exceptions) {
    if (!ex || typeof ex !== 'object') continue;
    const value = (ex as { value?: unknown }).value;
    if (typeof value === 'string') haystacks.push(value);
    const frames = (ex as { stacktrace?: { frames?: unknown[] } }).stacktrace?.frames ?? [];
    for (const frame of frames) {
      if (!frame || typeof frame !== 'object') continue;
      const fn = (frame as { function?: unknown }).function;
      if (typeof fn === 'string') haystacks.push(fn);
    }
  }
  collectStringLeaves(event.contexts, haystacks);
  collectStringLeaves(event.extra, haystacks);
  return haystacks;
}

function hasBackendStartupFailed(): boolean {
  return (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed === true;
}

function isBackendStartupFailureEvent(event: { tags?: Record<string, unknown> }): boolean {
  return event.tags?.['tomny.failure'] === 'backend_startup';
}

function isBackendStartupSecondaryEvent(event: { tags?: Record<string, unknown> }, haystacks: string[]): boolean {
  if (isBackendStartupFailureEvent(event)) {
    return false;
  }
  return (
    hasBackendStartupFailed() && BACKEND_STARTUP_SECONDARY_DROP_PATTERNS.some((re) => haystacks.some((h) => re.test(h)))
  );
}

export function initSentry(): void {
  // Diagnostics are opt-in. Do not initialize a Sentry client or transport
  // before Main-owned persisted consent exists.
  if (!hasDiagnosticsConsent() || sentryInitialized) return;
  const egress = systemEgressAuthority.authorize({
    egressClass: 'opt-in-diagnostics',
    destination: process.env.SENTRY_DSN,
    diagnosticsConsent: true,
  });
  if (egress.decision !== 'allow') return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: app.isPackaged ? 'production' : 'development',
    beforeSend(event) {
      if (!hasDiagnosticsConsent()) return null;
      const haystacks = collectEventSearchText(event);
      if (GPU_CRASH_DROP_PATTERNS.some((re) => haystacks.some((h) => re.test(h)))) {
        return null;
      }
      if (isBackendStartupSecondaryEvent(event, haystacks)) {
        return null;
      }
      // Tap captured runtime errors into the bug monitor (Yêu cầu 6, criterion
      // 6.1). Best-effort + guarded: feeding the monitor must never alter what
      // Sentry sends, so we forward a copy and always return the event.
      try {
        if (sentryErrorTap.hasListeners()) {
          const captured = capturedErrorFromSentryEvent(redactSentryEvent(event) as SentryLikeEvent);
          if (captured) sentryErrorTap.push(captured);
        }
      } catch (err) {
        console.warn('[sentry] bug-monitor tap failed (ignored):', err);
      }
      return redactSentryEvent(event);
    },
  });
  sentryInitialized = true;

  Sentry.setTag('app.arch', process.arch);
  Sentry.setTag('app.version', app.getVersion());
  Sentry.setTag('os.name', process.platform);
  const correlationId = getRotatingDiagnosticsCorrelationId();
  if (correlationId) Sentry.setTag('diagnostics.correlation_id', correlationId);
}

/**
 * Updates the persisted Main-owned choice. A UI/IPC owner must authenticate
 * the user before calling this Main-only authority.
 */
export function setSentryDiagnosticsConsent(granted: boolean): void {
  setDiagnosticsConsent(granted);
  if (granted) {
    initSentry();
    return;
  }
  clearSentryDiagnosticsScope();
}

/** Clears all account-like diagnostic identity on sign-out or consent withdrawal. */
export function clearSentryDiagnosticsScope(): void {
  Sentry.setUser(null);
  Sentry.setTag('diagnostics.correlation_id', '');
}

/** Test-only reset for the process-local Sentry initialization latch. */
export const __resetSentryForTests = (): void => {
  sentryInitialized = false;
};

function getBackendStartupDetails(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return undefined;
  return details as Record<string, unknown>;
}

const BACKEND_STARTUP_FLUSH_TIMEOUT_MS = 2000;

export async function captureBackendStartupFailure(error: unknown): Promise<void> {
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
  if (!hasDiagnosticsConsent() || !sentryInitialized) return;
  const details = getBackendStartupDetails(error);
  const failureInfo = classifyBackendStartupFailure(error);
  const installDiagnostics = collectBackendInstallDiagnostics(details, {
    appVersion: app.getVersion(),
    arch: process.arch,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  });
  const autoUpdateDiagnostics = readAutoUpdateDiagnostics(app.getPath('userData'));
  Sentry.withScope((scope: SentryScope) => {
    scope.setTag('tomny.failure', 'backend_startup');
    scope.setTag('tomny.backend_startup.reason', failureInfo.reason);
    if (failureInfo.runtime) {
      scope.setTag('tomny.backend_startup.runtime', failureInfo.runtime);
    }
    if (typeof details?.stage === 'string') {
      scope.setTag('tomny.backend_startup.stage', redactDiagnosticText(details.stage) ?? 'redacted');
    }
    scope.setContext('tomnycore_startup_classification', safeDiagnosticValue(failureInfo));
    scope.setContext(
      'tomnycore_install_diagnostics',
      safeDiagnosticValue({
        appVersion: installDiagnostics.appVersion,
        arch: installDiagnostics.arch,
        isPackaged: installDiagnostics.isPackaged,
        platform: installDiagnostics.platform,
      })
    );
    if (autoUpdateDiagnostics) {
      scope.setContext(
        'auto_update_diagnostics',
        safeDiagnosticValue({
          currentAppVersion: autoUpdateDiagnostics.currentAppVersion,
          lastEvent: autoUpdateDiagnostics.lastEvent
            ? {
                progressPercent: autoUpdateDiagnostics.lastEvent.progressPercent,
                status: autoUpdateDiagnostics.lastEvent.status,
                version: autoUpdateDiagnostics.lastEvent.version,
              }
            : undefined,
        })
      );
    }
    Sentry.captureMessage('backend-startup-failure', 'error');
  });
  try {
    await Sentry.flush(BACKEND_STARTUP_FLUSH_TIMEOUT_MS);
  } catch {
    // If Sentry cannot flush during fatal startup, keep shutdown deterministic.
  }
}

/**
 * How many recent days of logs the next startup report packs. Aligned with
 * the 24h throttle: the previous report covers everything older, so each
 * launch only needs the last calendar day. The app always writes today's
 * log on startup, so this slice is never empty in practice.
 */
export type LogFileMeta = { path: string; mtime: number; size: number };

/**
 * Pick the N most recent calendar days that contain non-empty log files,
 * and return every file falling on those days. Backend + frontend logs for
 * the same day stay together so the gzip bundle is coherent.
 */
export function selectRecentLogFiles(files: LogFileMeta[], n: number): LogFileMeta[] {
  const nonEmpty = files.filter((f) => f.size > 0);
  const byDay = new Map<string, LogFileMeta[]>();
  for (const f of nonEmpty) {
    const day = new Date(f.mtime).toISOString().slice(0, 10);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = [];
      byDay.set(day, bucket);
    }
    bucket.push(f);
  }
  const days = Array.from(byDay.keys()).toSorted().toReversed().slice(0, n);
  return days.flatMap((d) => byDay.get(d) ?? []).toSorted((a, b) => a.mtime - b.mtime);
}

export type LogSegment = { name: string; mtime: number; content: string };
export type PackResult = { gzipped: Buffer; truncated: boolean };

/**
 * Concatenate segments with a per-file header, gzip them, and shrink-from-head
 * until the gzipped size fits `maxBytes`. The tail (newest content) survives
 * because Sentry users care most about recent activity around the crash.
 */
export function packAndCap(segments: LogSegment[], maxBytes: number): PackResult {
  const headers = segments.map((s) => `===== ${s.name} (mtime: ${new Date(s.mtime).toISOString()}) =====\n`);
  let combined = '';
  for (let i = 0; i < segments.length; i++) {
    combined += headers[i] + segments[i].content;
    if (i < segments.length - 1) combined += '\n';
  }

  let gzipped = gzipSync(combined);
  if (gzipped.length <= maxBytes) {
    return { gzipped, truncated: false };
  }

  let truncated = combined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ratio = gzipped.length / Math.max(truncated.length, 1);
    const targetUncompressed = Math.max(Math.floor((maxBytes / ratio) * 0.9), 1024);
    if (truncated.length <= targetUncompressed) {
      truncated = truncated.slice(Math.floor(truncated.length * 0.3));
    } else {
      truncated = truncated.slice(truncated.length - targetUncompressed);
    }
    gzipped = gzipSync(truncated);
    if (gzipped.length <= maxBytes) {
      return { gzipped, truncated: true };
    }
  }

  truncated = truncated.slice(-Math.floor(maxBytes / 2));
  gzipped = gzipSync(truncated);
  return { gzipped, truncated: true };
}
