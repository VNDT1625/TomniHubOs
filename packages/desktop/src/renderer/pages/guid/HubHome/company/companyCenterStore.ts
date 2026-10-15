/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { CompanyConfig } from '@process/company/companyConfig';
import type { CompanyRole, CompanyStructure } from '@process/company/companyOrchestrator';

/**
 * Default company id used when the user creates a company without typing an id.
 * Matches the Main-process default in `companyConfig.ts`.
 */
export const DEFAULT_COMPANY_ID = 'company';

// NOTE: these localStorage keys MUST stay in sync with the Company package
// constants (`packages/package-apps/company/src/renderer/company/constants.ts`).
// The base Hub surface and the package share one roster, so a company designed
// here also appears in the package (and vice versa).
/** `localStorage` key under which the renderer remembers the set of known company ids. */
export const KNOWN_COMPANIES_STORAGE_KEY = 'tomny.company.knownIds';
/** `localStorage` key holding the app-level executor-strengths guidance reused per company. */
export const STRENGTHS_GUIDANCE_STORAGE_KEY = 'tomny.company.strengthsGuidance';

/** Upper bound on the stored guidance length (defensive against pathological input). */
export const STRENGTHS_GUIDANCE_MAX_LENGTH = 4000;

/** Characters / sequences that would let an id escape the companies directory. */
const UNSAFE_ID_PATTERN = /[/\\]|\.\./;

/**
 * Validate a company id the way the Main-process store does: non-empty and free
 * of path separators or `..`. Keeps the UI from submitting ids the bridge would
 * reject.
 */
export const isValidCompanyId = (companyId: string): boolean =>
  companyId.length > 0 && !UNSAFE_ID_PATTERN.test(companyId);

/** i18n key for a role's human label, e.g. `company.role.president`. */
export const roleLabelKey = (role: CompanyRole): string => {
  switch (role) {
    case 'president':
      return 'company.role.president';
    case 'division-head':
      return 'company.role.divisionHead';
    case 'worker':
      return 'company.role.worker';
    default:
      return 'company.role.worker';
  }
};

/** Read the remembered company ids from `localStorage` (safe + de-duplicated). */
export const loadKnownCompanies = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KNOWN_COMPANIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const entry of parsed) {
      if (typeof entry === 'string' && isValidCompanyId(entry) && !ids.includes(entry)) {
        ids.push(entry);
      }
    }
    return ids;
  } catch {
    return [];
  }
};

/** Fired on `window` after the roster is saved so other Hub surfaces (the sidebar) can reload. */
export const COMPANY_ROSTER_CHANGED_EVENT = 'tomni-company-roster-changed';

/** Persist the remembered company ids to `localStorage` (best-effort). */
export const saveKnownCompanies = (ids: string[]): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KNOWN_COMPANIES_STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(COMPANY_ROSTER_CHANGED_EVENT));
  } catch {
    // Ignore storage failures (private mode / quota) — the roster is non-critical.
  }
};

/** Read the user's executor-strengths guidance from `localStorage` (safe). */
export const loadStrengthsGuidance = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(STRENGTHS_GUIDANCE_STORAGE_KEY);
    return typeof raw === 'string' ? raw : '';
  } catch {
    return '';
  }
};

/** Persist the user's executor-strengths guidance to `localStorage` (best-effort, length-capped). */
export const saveStrengthsGuidance = (guidance: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STRENGTHS_GUIDANCE_STORAGE_KEY, guidance.slice(0, STRENGTHS_GUIDANCE_MAX_LENGTH));
  } catch {
    // Ignore storage failures (private mode / quota) — the guidance is non-critical.
  }
};

/**
 * Loading status for an async company resource (structure or rules).
 * - `idle`    — nothing requested yet (no active company).
 * - `loading` — a fetch is in flight.
 * - `ready`   — data is available.
 * - `error`   — the company service could not be reached (e.g. the IPC handler
 *   is not registered yet).
 */
export type CompanyLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Outcome of a {@link CompanyCenterState.createFromDescription} call.
 *
 * A flat shape (rather than a discriminated union) so consumers can read
 * `reason` without relying on control-flow narrowing. `reason` is only
 * meaningful when `ok` is `false`. `message` carries the backend error text.
 */
export type CompanyCreateOutcome = { ok: boolean; reason?: 'notWired' | 'error'; message?: string };

/**
 * Shape returned by {@link useCompanyCenterState}: the company roster, the
 * active company's structure and rules, and the actions wired to the company
 * IPC bridge. Self-contained mirror of the Company package's `useCompanyState`
 * (the base app may not import package code), scoped to what the Hub centre
 * surface needs.
 */
export type CompanyCenterState = {
  knownIds: string[];
  activeId: string | null;
  selectCompany: (companyId: string) => void;
  addCompany: (companyId: string) => void;
  /** Delete on disk, then drop from the roster. Resolves to whether the disk delete succeeded. */
  forgetCompany: (companyId: string) => Promise<boolean>;
  structure: CompanyStructure | null;
  structureStatus: CompanyLoadStatus;
  rules: string[];
  rulesStatus: CompanyLoadStatus;
  /** Reload the active company's structure and rules. */
  refresh: () => void;
  /** Design a company from a free-text description via the agent generator. */
  createFromDescription: (companyId: string, description: string) => Promise<CompanyCreateOutcome>;
  /** User-authored guidance on which executor is strong at what (app-level, reused per company). */
  strengthsGuidance: string;
  /** Persist the executor-strengths guidance; reused by every future company generation. */
  saveStrengthsGuidance: (guidance: string) => void;
};

/**
 * Manage the Hub company-centre state.
 *
 * The company bridge addresses companies by id and exposes no "list" channel, so
 * the roster of known company ids is kept locally (persisted to `localStorage`
 * under the same keys the Company package uses). Selecting a company loads its
 * role structure (`getStructure`) and rules (`getRules`); both degrade to an
 * `error` status if the Main-process bridge is not registered yet, which the UI
 * renders as a friendly empty/error state.
 */
export function useCompanyCenterState(): CompanyCenterState {
  const [knownIds, setKnownIds] = useState<string[]>(() => loadKnownCompanies());
  const [activeId, setActiveId] = useState<string | null>(() => loadKnownCompanies()[0] ?? null);
  const [structure, setStructure] = useState<CompanyStructure | null>(null);
  const [structureStatus, setStructureStatus] = useState<CompanyLoadStatus>('idle');
  const [rules, setRules] = useState<string[]>([]);
  const [rulesStatus, setRulesStatus] = useState<CompanyLoadStatus>('idle');
  const [strengthsGuidance, setStrengthsGuidanceState] = useState<string>(() => loadStrengthsGuidance());

  // Guard against state updates after the component unmounts.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Persist the roster whenever it changes.
  useEffect(() => {
    saveKnownCompanies(knownIds);
  }, [knownIds]);

  const rememberId = useCallback((companyId: string) => {
    setKnownIds((prev) => (prev.includes(companyId) ? prev : [...prev, companyId]));
  }, []);

  const loadStructure = useCallback(async (companyId: string) => {
    setStructureStatus('loading');
    try {
      const res = await ipcBridge.company.getStructure.invoke({ companyId });
      if (!aliveRef.current) return;
      if (res.ok) {
        setStructure(res.data);
        setStructureStatus('ready');
      } else {
        setStructure(null);
        setStructureStatus('error');
      }
    } catch {
      if (!aliveRef.current) return;
      setStructure(null);
      setStructureStatus('error');
    }
  }, []);

  const loadRules = useCallback(async (companyId: string) => {
    setRulesStatus('loading');
    try {
      const res = await ipcBridge.company.getRules.invoke({ companyId });
      if (!aliveRef.current) return;
      setRules(res.ok && Array.isArray(res.data) ? res.data : []);
      setRulesStatus(res.ok ? 'ready' : 'error');
    } catch {
      if (!aliveRef.current) return;
      setRules([]);
      setRulesStatus('error');
    }
  }, []);

  // Load the active company's structure + rules whenever it changes.
  useEffect(() => {
    if (!activeId) {
      setStructure(null);
      setStructureStatus('idle');
      setRules([]);
      setRulesStatus('idle');
      return;
    }
    void loadStructure(activeId);
    void loadRules(activeId);
  }, [activeId, loadStructure, loadRules]);

  const selectCompany = useCallback(
    (companyId: string) => {
      rememberId(companyId);
      setActiveId(companyId);
    },
    [rememberId]
  );

  const addCompany = useCallback(
    (companyId: string) => {
      rememberId(companyId);
      setActiveId(companyId);
    },
    [rememberId]
  );

  const forgetCompany = useCallback(async (companyId: string): Promise<boolean> => {
    // Delete the company on disk FIRST and await the result, so the UI only
    // forgets the roster id when the on-disk folder is actually gone. Without
    // awaiting, a failed/slow delete would leave a stale company.json behind
    // and a later create-with-the-same-id would merge the old data back.
    let deletedOk = false;
    try {
      const res = await ipcBridge.company.deleteCompany.invoke({ companyId });
      deletedOk = res.ok;
    } catch {
      deletedOk = false;
    }
    // Forget remembered role→conversation mappings for this company so re-creating
    // it does not re-open the previous (now stale) president/employee chats.
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem('tomny.company.roleConversations');
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const next: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
              if (!key.startsWith(`${companyId}::`)) next[key] = value;
            }
            window.localStorage.setItem('tomny.company.roleConversations', JSON.stringify(next));
          }
        }
      } catch {
        // Storage failures are non-critical.
      }
    }
    if (aliveRef.current) {
      setKnownIds((prev) => {
        const next = prev.filter((id) => id !== companyId);
        setActiveId((current) => (current === companyId ? (next[0] ?? null) : current));
        return next;
      });
    }
    return deletedOk;
  }, []);

  const refresh = useCallback(() => {
    if (activeId) {
      void loadStructure(activeId);
      void loadRules(activeId);
    }
  }, [activeId, loadStructure, loadRules]);

  const createFromDescription = useCallback(
    async (companyId: string, description: string): Promise<CompanyCreateOutcome> => {
      // Switch the active company up front so the Detail tab tracks the
      // in-flight generation right away.
      rememberId(companyId);
      setActiveId(companyId);
      try {
        const res = await ipcBridge.company.createFromDescription.invoke({
          companyId,
          description,
          strengthsGuidance: strengthsGuidance.trim() || undefined,
        });
        if (!aliveRef.current) return { ok: false, reason: 'error' };
        if (res.ok) {
          const config: CompanyConfig = res.data;
          // The id may have been canonicalised by the backend; re-sync.
          if (config.companyId !== companyId) {
            rememberId(config.companyId);
            setActiveId(config.companyId);
          }
          void loadStructure(config.companyId);
          void loadRules(config.companyId);
          return { ok: true };
        }
        const failure = res as Extract<typeof res, { ok: false }>;
        return {
          ok: false,
          reason: failure.code === 'no-model' ? 'notWired' : 'error',
          message: failure.error,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: 'error', message };
      }
    },
    [rememberId, loadStructure, loadRules, strengthsGuidance]
  );

  const persistStrengthsGuidance = useCallback((guidance: string): void => {
    setStrengthsGuidanceState(guidance);
    saveStrengthsGuidance(guidance);
  }, []);

  return {
    knownIds,
    activeId,
    selectCompany,
    addCompany,
    forgetCompany,
    structure,
    structureStatus,
    rules,
    rulesStatus,
    refresh,
    createFromDescription,
    strengthsGuidance,
    saveStrengthsGuidance: persistStrengthsGuidance,
  };
}
