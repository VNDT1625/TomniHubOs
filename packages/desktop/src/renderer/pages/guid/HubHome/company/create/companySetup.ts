/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ListAgentsResponse } from '@process/company/companyBridge';
import type { CompanyStructure, RoleAssignment, RoleNode } from '@process/company/companyOrchestrator';
import { useEffect, useState } from 'react';
import { flattenRoles } from '../companyGroups';

/** Agent pool offered to the form: installed CLIs, assistants, models, MCP servers, skills and modes. */
export type AgentPool = ListAgentsResponse;

/**
 * Load the agent pool once. `null` while loading or when the company service is
 * unreachable; the form then still works with free-text-free defaults.
 */
export function useAgentPool(): AgentPool | null {
  const [pool, setPool] = useState<AgentPool | null>(null);
  useEffect(() => {
    let alive = true;
    void ipcBridge.company.listAgents
      .invoke()
      .then((res) => {
        if (alive && res.ok) setPool(res.data);
      })
      .catch((): void => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return pool;
}

/** `describe`: an agent designs everything from the purpose. `manual`: the user sets the structure. */
export type SetupMode = 'describe' | 'manual';

/** Executor reference: `cli:<id>` or `assistant:<id>`. */
export type ExecutorKey = string;

export type DivisionDraft = { name: string; workers: number };

/** Everything the add-company form collects. Every field except the id is optional. */
export type CompanySetup = {
  mode: SetupMode;
  companyId: string;
  /** The company's purpose; the description the designer works from. */
  purpose: string;
  presidentName: string;
  /** The Boss: the top role that manages everyone. */
  boss?: { executor: ExecutorKey; model?: string };
  /** Executors the company may hire as employees. Empty means "the designer decides". */
  hire: ExecutorKey[];
  /** Company-wide permission mode applied to every role. */
  sessionMode?: string;
  skills: string[];
  mcpServerIds: string[];
  rules: string[];
  /** Designer guidance on which executor is good at what (describe mode). */
  strengths: string;
  /** Manual structure: divisions with their worker counts, or direct workers when empty. */
  divisions: DivisionDraft[];
  directWorkers: number;
};

export type SetupOutcome = { ok: boolean; reason?: 'noModel' | 'error'; message?: string };

const slug = (name: string, taken: Set<string>): string => {
  const base =
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'division';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
};

/** Resolve an executor key against the pool into a role assignment. */
export const toAssignment = (key: ExecutorKey, pool: AgentPool, model?: string): RoleAssignment | null => {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  if (kind === 'cli') {
    const cli = pool.clis.find((item) => item.id === id);
    return cli ? { kind: 'cli', refId: cli.id, label: cli.name, model: model || undefined } : null;
  }
  const assistant = pool.assistants.find((item) => item.id === id);
  return assistant
    ? { kind: 'assistant', refId: assistant.id, label: assistant.name, model: model || assistant.model }
    : null;
};

/** The per-role assignments a setup asks for, keyed by role id. Pure; the caller applies them. */
export const planAssignments = (
  structure: CompanyStructure,
  setup: CompanySetup,
  pool: AgentPool
): Map<string, RoleAssignment> => {
  const plan = new Map<string, RoleAssignment>();
  const fallbackCli = pool.clis.find((cli) => cli.available);
  const hire = setup.hire.map((key) => toAssignment(key, pool)).filter((item): item is RoleAssignment => item !== null);
  const boss = setup.boss ? toAssignment(setup.boss.executor, pool, setup.boss.model) : null;
  const wantsCapabilities = Boolean(setup.sessionMode) || setup.skills.length > 0 || setup.mcpServerIds.length > 0;
  let hired = 0;

  for (const node of flattenRoles(structure.root) as RoleNode[]) {
    let assignment: RoleAssignment | undefined = node.assignment;
    if (node.role === 'president' && boss) assignment = boss;
    // Manual structures have no designer: employees are drawn from the hire pool in turn.
    else if (node.role !== 'president' && setup.mode === 'manual' && hire.length > 0) {
      assignment = hire[hired % hire.length];
      hired += 1;
    }
    if (!assignment && wantsCapabilities && fallbackCli) {
      assignment = { kind: 'cli', refId: fallbackCli.id, label: fallbackCli.name };
    }
    if (!assignment) continue;
    if (wantsCapabilities) {
      assignment = {
        ...assignment,
        capabilities: {
          ...assignment.capabilities,
          ...(setup.sessionMode ? { sessionMode: setup.sessionMode } : {}),
          ...(setup.skills.length > 0 ? { skills: setup.skills } : {}),
          ...(setup.mcpServerIds.length > 0 ? { mcpServerIds: setup.mcpServerIds } : {}),
        },
      };
    }
    if (assignment !== node.assignment) plan.set(node.id, assignment);
  }
  return plan;
};

const designerGuidance = (setup: CompanySetup, pool: AgentPool | null): string => {
  const names = pool
    ? setup.hire.map((key) => toAssignment(key, pool)?.label).filter((label): label is string => Boolean(label))
    : [];
  return [setup.strengths.trim(), names.length > 0 ? `Only assign these executors to roles: ${names.join(', ')}.` : '']
    .filter(Boolean)
    .join('\n');
};

/**
 * Create a company from the form.
 *
 * 1. Describe mode asks the designer for the whole role chart; manual mode
 *    builds the structure the user typed.
 * 2. Rules are saved, then the Boss, hired executors and company-wide
 *    permissions/skills/MCP servers are applied role by role.
 *
 * Later steps are best effort: the company exists once step 1 succeeds, and the
 * settings screen can fix whatever a later step missed.
 */
export const runCompanySetup = async (setup: CompanySetup, pool: AgentPool | null): Promise<SetupOutcome> => {
  const { companyId } = setup;
  try {
    if (setup.mode === 'describe') {
      const res = await ipcBridge.company.createFromDescription.invoke({
        companyId,
        description: setup.purpose,
        presidentName: setup.presidentName.trim() || undefined,
        strengthsGuidance: designerGuidance(setup, pool) || undefined,
      });
      if (!res.ok) {
        const failure = res as Extract<typeof res, { ok: false }>;
        return { ok: false, reason: failure.code === 'no-model' ? 'noModel' : 'error', message: failure.error };
      }
    } else {
      const taken = new Set<string>();
      const res = await ipcBridge.company.updateStructure.invoke({
        companyId,
        presidentName: setup.presidentName.trim() || undefined,
        divisions: setup.divisions
          .filter((division) => division.name.trim())
          .map((division) => ({
            divisionId: slug(division.name, taken),
            name: division.name.trim(),
            workerCount: Math.max(1, Math.floor(division.workers) || 1),
          })),
        directWorkerCount: Math.max(1, Math.floor(setup.directWorkers) || 1),
      });
      if (!res.ok) return { ok: false, reason: 'error', message: (res as Extract<typeof res, { ok: false }>).error };
    }

    if (setup.rules.length > 0) await ipcBridge.company.setRules.invoke({ companyId, rules: setup.rules });

    if (pool) {
      const structureRes = await ipcBridge.company.getStructure.invoke({ companyId });
      if (structureRes.ok) {
        for (const [roleId, assignment] of planAssignments(structureRes.data, setup, pool)) {
          await ipcBridge.company.setAssignment.invoke({ companyId, roleId, assignment });
        }
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
