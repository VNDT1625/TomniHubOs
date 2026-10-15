/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isHookSettingsFailure,
  type HookSettingsAuditLine,
  type HookSettingsCoverageRow,
  type HookSettingsErrorCode,
  type HookSettingsNativeAPI,
  type HookSettingsResult,
  type HookSettingsRow,
  type HookSettingsSwitches,
} from '@/common/integrations/hooks/hookSettings';

const AUDIT_LIMIT = 50;

/** The native API, or undefined when this window has no hook controls. */
export const getHookSettingsApi = (): HookSettingsNativeAPI | undefined => window.electronAPI?.hookSettings;

export type HookNotice = { kind: 'ok'; message: string } | { kind: 'error'; code: HookSettingsErrorCode };

export type HookSettingsState = {
  phase: 'loading' | 'ready' | 'unavailable';
  hooks: HookSettingsRow[];
  switches: HookSettingsSwitches;
  coverage: HookSettingsCoverageRow[];
  audit: HookSettingsAuditLine[];
  notice?: HookNotice;
  busy: boolean;
};

const DEFAULT_SWITCHES: HookSettingsSwitches = {
  disableAll: false,
  sources: { package: true, user: true, workspace: true },
};

/** Codes after which what the page shows is probably out of date, so it reads the list again. */
const STALE_CODES: ReadonlySet<HookSettingsErrorCode> = new Set(['NOT_FOUND', 'HASH_MISMATCH', 'APPROVAL_REQUIRED']);

/**
 * Loads the hooks, the coverage table and the audit lines, and runs one action at a time. Every action ends with a
 * fresh read, so the page never shows a state that Main did not report.
 */
export const useHookSettings = (api: HookSettingsNativeAPI | undefined) => {
  const [state, setState] = useState<HookSettingsState>({
    phase: api ? 'loading' : 'unavailable',
    hooks: [],
    switches: DEFAULT_SWITCHES,
    coverage: [],
    audit: [],
    busy: false,
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return;
    try {
      const [list, coverage, audit] = await Promise.all([
        api.list(),
        api.coverage(),
        api.audit({ limit: AUDIT_LIMIT }),
      ]);
      if (!alive.current) return;
      setState((current) =>
        isHookSettingsFailure(list)
          ? { ...current, phase: 'ready', notice: { kind: 'error', code: list.error } }
          : {
              ...current,
              phase: 'ready',
              hooks: list.data.hooks,
              switches: list.data.switches,
              coverage: coverage.ok ? coverage.data : [],
              audit: audit.ok ? audit.data.toReversed() : [],
            }
      );
    } catch {
      if (alive.current) setState((current) => ({ ...current, phase: 'unavailable' }));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async <T>(call: () => Promise<HookSettingsResult<T>>, okMessage?: string): Promise<HookSettingsResult<T>> => {
      setState((current) => ({ ...current, busy: true }));
      let result: HookSettingsResult<T>;
      try {
        result = await call();
      } catch {
        result = { ok: false, error: 'IO_ERROR' };
      }
      if (!alive.current) return result;
      setState((current) => {
        const { notice: _previous, ...rest } = current;
        return {
          ...rest,
          busy: false,
          ...(isHookSettingsFailure(result)
            ? { notice: { kind: 'error' as const, code: result.error } }
            : okMessage === undefined
              ? {}
              : { notice: { kind: 'ok' as const, message: okMessage } }),
        };
      });
      if (!isHookSettingsFailure(result) || STALE_CODES.has(result.error)) await refresh();
      return result;
    },
    [refresh]
  );

  const dismissNotice = useCallback((): void => {
    setState((current) => {
      const { notice: _dismissed, ...rest } = current;
      return rest;
    });
  }, []);

  return { state, refresh, act, dismissNotice };
};
