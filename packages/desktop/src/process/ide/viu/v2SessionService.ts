/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  applyViuTransaction,
  createViuFramePlan,
  createPremiumStarterProject,
  mergeViuFrameContributions,
  validateViuProject,
  type CreateViuFramePlanInput,
  type ViuDiagnostic,
  type ViuFrameContribution,
  type ViuFrameLease,
  type ViuFrameMergeResult,
  type ViuFramePlan,
  type ViuProjectState,
  type ViuTransaction,
  type ViuTransactionResult,
} from '@/common/viu';

export type ViuSessionValidation = {
  valid: boolean;
  revision: number;
  diagnostics: ViuDiagnostic[];
};

export type ViuFramePlanSession = {
  plan: ViuFramePlan;
  status: 'active' | 'committed';
  submittedAssignmentIds: string[];
  committedRevision?: number;
};

export type ViuFrameContributionSubmission = {
  replaced: boolean;
  review: ViuFrameMergeResult;
  session: ViuFramePlanSession;
};

export type ViuV2SessionServiceApi = {
  inspect: (workspaceKey: string) => ViuProjectState;
  previewTransaction: (workspaceKey: string, transaction: ViuTransaction) => ViuTransactionResult;
  commitTransaction: (workspaceKey: string, transaction: ViuTransaction) => ViuTransactionResult;
  validate: (workspaceKey: string) => ViuSessionValidation;
  createFramePlan: (workspaceKey: string, input: CreateViuFramePlanInput) => ViuFramePlanSession;
  getFramePlan: (workspaceKey: string, planId: string) => ViuFramePlanSession;
  refreshFrameLease: (
    workspaceKey: string,
    planId: string,
    assignmentId: string,
    lease: ViuFrameLease
  ) => ViuFramePlanSession;
  submitFrameContribution: (
    workspaceKey: string,
    planId: string,
    contribution: ViuFrameContribution
  ) => ViuFrameContributionSubmission;
  reviewFramePlan: (workspaceKey: string, planId: string) => ViuFrameMergeResult;
  commitFramePlan: (workspaceKey: string, planId: string) => ViuFrameMergeResult;
};

export type ViuV2SessionServiceDeps = {
  createProject?: (projectId?: string) => ViuProjectState;
  applyTransaction?: (state: ViuProjectState, transaction: ViuTransaction) => ViuTransactionResult;
  validateProject?: (state: ViuProjectState) => ViuDiagnostic[];
  createProjectId?: () => string;
  now?: () => number;
};

type ActiveFramePlan = {
  plan: ViuFramePlan;
  contributions: Map<string, ViuFrameContribution>;
  status: ViuFramePlanSession['status'];
  committedRevision?: number;
};

const clone = <T>(value: T): T => structuredClone(value);

const deduplicateDiagnostics = (diagnostics: ViuDiagnostic[]): ViuDiagnostic[] => {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const rejectedForValidation = (
  current: ViuProjectState,
  result: ViuTransactionResult,
  diagnostics: ViuDiagnostic[]
): ViuTransactionResult => ({
  ...result,
  accepted: false,
  state: clone(current),
  revision: current.revision,
  diagnostics,
  conflict: result.conflict ?? {
    kind: 'validation',
    message: 'The transaction produced an invalid VIU document.',
  },
});

/**
 * Authoritative in-memory V2 session sequencer.
 *
 * Workspace keys are private map keys only. They are never copied into the
 * project, diagnostics, transaction results, or agent-visible payloads.
 */
export class ViuV2SessionService implements ViuV2SessionServiceApi {
  private readonly sessions = new Map<string, ViuProjectState>();
  private readonly framePlans = new Map<string, Map<string, ActiveFramePlan>>();
  private readonly createProject: (projectId?: string) => ViuProjectState;
  private readonly applyTransaction: (state: ViuProjectState, transaction: ViuTransaction) => ViuTransactionResult;
  private readonly validateProject: (state: ViuProjectState) => ViuDiagnostic[];
  private readonly createProjectId: () => string;
  private readonly now: () => number;

  public constructor(deps: ViuV2SessionServiceDeps = {}) {
    this.createProject = deps.createProject ?? createPremiumStarterProject;
    this.applyTransaction = deps.applyTransaction ?? applyViuTransaction;
    this.validateProject = deps.validateProject ?? validateViuProject;
    this.createProjectId = deps.createProjectId ?? (() => `viu-${randomUUID()}`);
    this.now = deps.now ?? Date.now;
  }

  private normalizeWorkspaceKey(workspaceKey: string): string {
    const normalized = workspaceKey.trim();
    if (!normalized || normalized.includes('\0') || normalized.length > 2_048) {
      throw new Error('A valid opaque workspace key is required.');
    }
    return normalized;
  }

  private readOrCreate(workspaceKey: string): { key: string; state: ViuProjectState } {
    const key = this.normalizeWorkspaceKey(workspaceKey);
    const existing = this.sessions.get(key);
    if (existing) return { key, state: existing };

    const created = this.createProject(this.createProjectId());
    const diagnostics = this.validateProject(created);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new Error('The VIU starter project failed validation.');
    }
    const state = clone(created);
    this.sessions.set(key, state);
    return { key, state };
  }

  public inspect(workspaceKey: string): ViuProjectState {
    return clone(this.readOrCreate(workspaceKey).state);
  }

  private transact(
    workspaceKey: string,
    transaction: ViuTransaction,
    mode: ViuTransaction['mode']
  ): ViuTransactionResult {
    const { key, state: current } = this.readOrCreate(workspaceKey);
    const working = clone(current);
    const normalizedTransaction = clone({ ...transaction, mode });
    const result = this.applyTransaction(working, normalizedTransaction);
    const diagnostics = deduplicateDiagnostics([...result.diagnostics, ...this.validateProject(result.state)]);
    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');

    if (!result.accepted || hasErrors) return rejectedForValidation(current, result, diagnostics);

    const accepted = { ...result, state: clone(result.state), diagnostics };
    if (mode === 'commit') this.sessions.set(key, clone(accepted.state));
    return accepted;
  }

  public previewTransaction(workspaceKey: string, transaction: ViuTransaction): ViuTransactionResult {
    return this.transact(workspaceKey, transaction, 'preview');
  }

  public commitTransaction(workspaceKey: string, transaction: ViuTransaction): ViuTransactionResult {
    return this.transact(workspaceKey, transaction, 'commit');
  }

  private plansFor(workspaceKey: string): { key: string; plans: Map<string, ActiveFramePlan> } {
    const key = this.normalizeWorkspaceKey(workspaceKey);
    let plans = this.framePlans.get(key);
    if (!plans) {
      plans = new Map<string, ActiveFramePlan>();
      this.framePlans.set(key, plans);
    }
    return { key, plans };
  }

  private requireFramePlan(workspaceKey: string, planId: string): { key: string; entry: ActiveFramePlan } {
    const normalizedPlanId = planId.trim();
    if (!normalizedPlanId) throw new Error('A frame plan id is required.');
    const { key, plans } = this.plansFor(workspaceKey);
    const entry = plans.get(normalizedPlanId);
    if (!entry) throw new Error(`Frame plan ${normalizedPlanId} does not exist.`);
    return { key, entry };
  }

  private framePlanSession(entry: ActiveFramePlan): ViuFramePlanSession {
    return clone({
      plan: entry.plan,
      status: entry.status,
      submittedAssignmentIds: [...entry.contributions.keys()].toSorted(),
      ...(entry.committedRevision === undefined ? {} : { committedRevision: entry.committedRevision }),
    });
  }

  public createFramePlan(workspaceKey: string, input: CreateViuFramePlanInput): ViuFramePlanSession {
    const state = this.readOrCreate(workspaceKey).state;
    const { plans } = this.plansFor(workspaceKey);
    if (plans.has(input.planId)) throw new Error(`Frame plan ${input.planId} already exists.`);
    const plan = createViuFramePlan(state, input);
    const entry: ActiveFramePlan = { plan, contributions: new Map(), status: 'active' };
    plans.set(plan.planId, entry);
    return this.framePlanSession(entry);
  }

  public getFramePlan(workspaceKey: string, planId: string): ViuFramePlanSession {
    return this.framePlanSession(this.requireFramePlan(workspaceKey, planId).entry);
  }

  public refreshFrameLease(
    workspaceKey: string,
    planId: string,
    assignmentId: string,
    lease: ViuFrameLease
  ): ViuFramePlanSession {
    const { entry } = this.requireFramePlan(workspaceKey, planId);
    if (entry.status !== 'active') throw new Error(`Frame plan ${planId} is already committed.`);
    const assignment = entry.plan.assignments.find((item) => item.assignmentId === assignmentId);
    if (!assignment) throw new Error(`Assignment ${assignmentId} does not exist in frame plan ${planId}.`);
    if (lease.leaseKey !== assignment.lease.leaseKey || lease.holderId !== assignment.agentId) {
      throw new Error(`Lease does not belong to assignment ${assignmentId}.`);
    }
    if (lease.expiresAt <= lease.acquiredAt) throw new Error('Frame lease has an invalid lifetime.');
    assignment.lease = clone(lease);
    return this.framePlanSession(entry);
  }

  public submitFrameContribution(
    workspaceKey: string,
    planId: string,
    contribution: ViuFrameContribution
  ): ViuFrameContributionSubmission {
    const { entry } = this.requireFramePlan(workspaceKey, planId);
    if (entry.status !== 'active') throw new Error(`Frame plan ${planId} is already committed.`);
    const assignment = entry.plan.assignments.find((item) => item.assignmentId === contribution.assignmentId);
    if (!assignment) throw new Error(`Assignment ${contribution.assignmentId} does not exist in frame plan ${planId}.`);
    const state = this.readOrCreate(workspaceKey).state;
    const isolatedPlan: ViuFramePlan = { ...clone(entry.plan), assignments: [clone(assignment)] };
    const review = mergeViuFrameContributions(state, isolatedPlan, [clone(contribution)], this.now());
    const accepted =
      review.reports.find((report) => report.assignmentId === contribution.assignmentId)?.accepted === true;
    if (!accepted || !review.accepted)
      return { replaced: false, review: clone(review), session: this.framePlanSession(entry) };
    const replaced = entry.contributions.has(contribution.assignmentId);
    entry.contributions.set(contribution.assignmentId, clone(contribution));
    return { replaced, review: clone(review), session: this.framePlanSession(entry) };
  }

  public reviewFramePlan(workspaceKey: string, planId: string): ViuFrameMergeResult {
    const { entry } = this.requireFramePlan(workspaceKey, planId);
    const state = this.readOrCreate(workspaceKey).state;
    return clone(mergeViuFrameContributions(state, entry.plan, [...entry.contributions.values()], this.now()));
  }

  public commitFramePlan(workspaceKey: string, planId: string): ViuFrameMergeResult {
    const { key, entry } = this.requireFramePlan(workspaceKey, planId);
    if (entry.status !== 'active') throw new Error(`Frame plan ${planId} is already committed.`);
    const result = this.reviewFramePlan(workspaceKey, planId);
    if (!result.accepted || !result.complete) return result;
    this.sessions.set(key, clone(result.state));
    entry.status = 'committed';
    entry.committedRevision = result.revision;
    return clone(result);
  }

  public validate(workspaceKey: string): ViuSessionValidation {
    const state = this.readOrCreate(workspaceKey).state;
    const diagnostics = clone(this.validateProject(state));
    return {
      valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
      revision: state.revision,
      diagnostics,
    };
  }
}

/** Default process-wide singleton; wiring may inject a separate service in tests. */
export const viuV2SessionService = new ViuV2SessionService();
