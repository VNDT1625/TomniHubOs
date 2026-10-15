/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { CompanyStructure, RoleNode } from '@process/company/companyOrchestrator';
import { useCallback, useEffect, useState } from 'react';
import { COMPANY_ROSTER_CHANGED_EVENT, loadKnownCompanies } from './companyCenterStore';
import { findRole } from './companyGroups';
import { ensureRoleConversation } from './companyRoleChat';

/** Company folder shown in the sidebar. `structure` is null while loading or when unavailable. */
export type CompanyTreeEntry = { companyId: string; structure: CompanyStructure | null };

const fetchStructure = async (companyId: string): Promise<CompanyStructure | null> => {
  try {
    const res = await ipcBridge.company.getStructure.invoke({ companyId });
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
};

const fetchRules = async (companyId: string): Promise<string[]> => {
  try {
    const res = await ipcBridge.company.getRules.invoke({ companyId });
    return res.ok && Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
};

/**
 * Companies as folders: the remembered roster plus each company's role tree.
 * Reloads when the roster changes (the centre surface fires
 * {@link COMPANY_ROSTER_CHANGED_EVENT}) and when `refreshKey` changes.
 */
export function useCompanyTree(enabled: boolean, refreshKey = 0): CompanyTreeEntry[] {
  const [entries, setEntries] = useState<CompanyTreeEntry[]>([]);
  const [rosterVersion, setRosterVersion] = useState(0);

  useEffect(() => {
    const bump = (): void => setRosterVersion((version) => version + 1);
    window.addEventListener(COMPANY_ROSTER_CHANGED_EVENT, bump);
    return () => window.removeEventListener(COMPANY_ROSTER_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const ids = loadKnownCompanies();
    setEntries(ids.map((companyId): CompanyTreeEntry => ({ companyId, structure: null })));
    void Promise.all(
      ids.map(
        async (companyId): Promise<CompanyTreeEntry> => ({ companyId, structure: await fetchStructure(companyId) })
      )
    ).then((loaded) => {
      if (alive) setEntries(loaded);
    });
    return () => {
      alive = false;
    };
  }, [enabled, refreshKey, rosterVersion]);

  return entries;
}

/**
 * Open the private 1-1 conversation with one agent of a company.
 *
 * @returns the conversation id, or `null` when the agent cannot be reached.
 */
export const useOpenCompanyAgent = (language: string) =>
  useCallback(
    async (companyId: string, roleId: string, structureHint?: CompanyStructure | null): Promise<string | null> => {
      const structure = structureHint ?? (await fetchStructure(companyId));
      const role: RoleNode | undefined = structure ? findRole(structure, roleId) : undefined;
      if (!structure || !role) return null;
      const rules = await fetchRules(companyId);
      return ensureRoleConversation({ companyId, companyName: companyId, role, structure, rules, language });
    },
    [language]
  );
