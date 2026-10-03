import { randomUUID } from 'node:crypto';

import type { OutcomeReceipt } from '@/common/foundation/receiptTypes';
import type { SurfacePlanningStep } from '@/common/packages';
import type { HubGoalSurfacePlanCache } from '@/process/bridge/foundationBridge';

export type SurfaceAiActionControllerErrorCode =
  | 'SURFACE_AI_ACTION_PLAN_UNAVAILABLE'
  | 'SURFACE_AI_ACTION_STEP_INVALID'
  | 'SURFACE_AI_ACTION_OWNER_MISMATCH'
  | 'SURFACE_AI_ACTION_ACCOUNT_MISMATCH'
  | 'SURFACE_AI_ACTION_UNAVAILABLE'
  | 'SURFACE_AI_ACTION_IN_FLIGHT';

export class SurfaceAiActionControllerError extends Error {
  public constructor(public readonly code: SurfaceAiActionControllerErrorCode) {
    super(code);
    this.name = 'SurfaceAiActionControllerError';
  }
}

export type SurfaceAiActionSafeReceipt = Readonly<{
  receiptId: string;
  runId: string;
  status: OutcomeReceipt['status'];
  createdAt: number;
  targetId?: string;
  evidenceRefs: readonly string[];
}>;

export type SurfaceAiActionPreparation = Readonly<{
  actionId: string;
  consent: Readonly<{ packageId: string; operationId: string }>;
}>;

type ReadyLocalPlanStep = SurfacePlanningStep &
  Readonly<{
    kind: 'execute-local';
  }>;

type ActionRecord = Readonly<{
  actionId: string;
  accountId: string;
  ownerId: string;
  modelSelectionReceipt: string;
  goal: string;
  planStep: ReadyLocalPlanStep;
  expiresAt: number;
  controller: AbortController;
  inFlight: boolean;
}>;

export type SurfaceAiActionController = Readonly<{
  prepare: (
    input: Readonly<{ planId: string; stepIndex: number; accountId: string; ownerId: string }>
  ) => Promise<SurfaceAiActionPreparation>;
  execute: (
    input: Readonly<{ actionId: string; consentId: string; accountId: string; ownerId: string }>
  ) => Promise<SurfaceAiActionSafeReceipt>;
  cancel: (input: Readonly<{ actionId: string; accountId: string; ownerId: string }>) => boolean;
  revokeAccount: (accountId: string) => void;
  revokeOwner: (ownerId: string) => void;
  /** Main lifecycle cancellation for sign-out/expiry; no caller identity is accepted. */
  revokeAll: () => void;
}>;

export type SurfaceAiActionControllerDeps = Readonly<{
  planCache: HubGoalSurfacePlanCache;
  /** Fresh Main-only Store selection supplies the exact consent declaration. */
  selectConsent: (planStep: ReadyLocalPlanStep) => Promise<Readonly<{ packageId: string; operationId: string }>>;
  execute: (
    input: Readonly<{
      goal: string;
      planStep: ReadyLocalPlanStep;
      consentId: string;
      modelSelectionReceipt: string;
      signal: AbortSignal;
    }>
  ) => Promise<Readonly<{ receipt: OutcomeReceipt; targetId?: string }>>;
  createActionId?: () => string;
  now?: () => number;
  ttlMs?: number;
}>;

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_EVIDENCE_REFS = 64;
const safeIdentifier = /^[A-Za-z0-9._:@/-]+$/;

const requireIdentifier = (value: unknown, code: SurfaceAiActionControllerErrorCode): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !safeIdentifier.test(value)
  ) {
    throw new SurfaceAiActionControllerError(code);
  }
  return value;
};

const validStepIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 128;

const safeReceipt = (result: Readonly<{ receipt: OutcomeReceipt; targetId?: string }>): SurfaceAiActionSafeReceipt => {
  const { receipt } = result;
  const evidenceRefs = [...new Set(receipt.evidenceRefs.filter((value) => safeIdentifier.test(value)))].slice(
    0,
    MAX_EVIDENCE_REFS
  );
  return Object.freeze({
    receiptId: receipt.receiptId,
    runId: receipt.runId,
    status: receipt.status,
    createdAt: receipt.createdAt,
    ...(result.targetId === undefined ? {} : { targetId: result.targetId }),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
};

/**
 * Holds a raw goal only in ephemeral Main memory between a C3 plan and one C4
 * local action. Renderer callers receive opaque IDs, never a mutable plan,
 * selected runtime, model target, raw goal, or package operation transport.
 */
export const createSurfaceAiActionController = (deps: SurfaceAiActionControllerDeps): SurfaceAiActionController => {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? 5 * 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30 * 60_000) {
    throw new Error('SURFACE_AI_ACTION_CONTROLLER_TTL_INVALID');
  }
  const createActionId = deps.createActionId ?? randomUUID;
  const records = new Map<string, ActionRecord>();

  const clearExpired = (): void => {
    const current = now();
    for (const [actionId, record] of records) {
      if (record.expiresAt <= current) {
        record.controller.abort();
        records.delete(actionId);
      }
    }
  };
  const recordFor = (actionId: unknown, accountId: unknown, ownerId: unknown): ActionRecord => {
    clearExpired();
    const normalizedActionId = requireIdentifier(actionId, 'SURFACE_AI_ACTION_UNAVAILABLE');
    const normalizedAccountId = requireIdentifier(accountId, 'SURFACE_AI_ACTION_ACCOUNT_MISMATCH');
    const normalizedOwnerId = requireIdentifier(ownerId, 'SURFACE_AI_ACTION_OWNER_MISMATCH');
    const record = records.get(normalizedActionId);
    if (!record) throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_UNAVAILABLE');
    if (record.accountId !== normalizedAccountId)
      throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_ACCOUNT_MISMATCH');
    if (record.ownerId !== normalizedOwnerId)
      throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_OWNER_MISMATCH');
    return record;
  };

  return Object.freeze({
    prepare: async ({ planId, stepIndex, accountId, ownerId }) => {
      const normalizedPlanId = requireIdentifier(planId, 'SURFACE_AI_ACTION_PLAN_UNAVAILABLE');
      const normalizedAccountId = requireIdentifier(accountId, 'SURFACE_AI_ACTION_ACCOUNT_MISMATCH');
      const normalizedOwnerId = requireIdentifier(ownerId, 'SURFACE_AI_ACTION_OWNER_MISMATCH');
      if (!validStepIndex(stepIndex)) throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_STEP_INVALID');
      const plan = deps.planCache.take(normalizedPlanId, normalizedAccountId, normalizedOwnerId);
      if (!plan) throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_PLAN_UNAVAILABLE');
      const modelSelectionReceipt = requireIdentifier(plan.modelSelectionReceipt, 'SURFACE_AI_ACTION_PLAN_UNAVAILABLE');
      const step = plan.plan.steps[stepIndex];
      if (!step || step.kind !== 'execute-local')
        throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_STEP_INVALID');
      const consent = await deps.selectConsent(step as ReadyLocalPlanStep);
      const packageId = requireIdentifier(consent.packageId, 'SURFACE_AI_ACTION_STEP_INVALID');
      const operationId = requireIdentifier(consent.operationId, 'SURFACE_AI_ACTION_STEP_INVALID');
      if (packageId !== step.candidate.package.packageId) {
        throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_STEP_INVALID');
      }
      const actionId = requireIdentifier(createActionId(), 'SURFACE_AI_ACTION_UNAVAILABLE');
      if (records.has(actionId)) throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_UNAVAILABLE');
      const record: ActionRecord = Object.freeze({
        actionId,
        accountId: normalizedAccountId,
        ownerId: normalizedOwnerId,
        modelSelectionReceipt,
        goal: plan.goal,
        planStep: structuredClone(step) as ReadyLocalPlanStep,
        expiresAt: now() + ttlMs,
        controller: new AbortController(),
        inFlight: false,
      });
      records.set(actionId, record);
      return Object.freeze({
        actionId,
        consent: Object.freeze({ packageId, operationId }),
      });
    },
    execute: async ({ actionId, consentId, accountId, ownerId }) => {
      const record = recordFor(actionId, accountId, ownerId);
      if (record.inFlight) throw new SurfaceAiActionControllerError('SURFACE_AI_ACTION_IN_FLIGHT');
      const normalizedConsentId = requireIdentifier(consentId, 'SURFACE_AI_ACTION_UNAVAILABLE');
      records.set(record.actionId, Object.freeze({ ...record, inFlight: true }));
      try {
        return safeReceipt(
          await deps.execute({
            goal: record.goal,
            planStep: record.planStep,
            consentId: normalizedConsentId,
            modelSelectionReceipt: record.modelSelectionReceipt,
            signal: record.controller.signal,
          })
        );
      } finally {
        records.delete(record.actionId);
      }
    },
    cancel: ({ actionId, accountId, ownerId }) => {
      const record = recordFor(actionId, accountId, ownerId);
      record.controller.abort();
      records.delete(record.actionId);
      return true;
    },
    revokeAccount: (accountId) => {
      const normalizedAccountId = requireIdentifier(accountId, 'SURFACE_AI_ACTION_ACCOUNT_MISMATCH');
      for (const [actionId, record] of records) {
        if (record.accountId === normalizedAccountId) {
          record.controller.abort();
          records.delete(actionId);
        }
      }
    },
    revokeOwner: (ownerId) => {
      const normalizedOwnerId = requireIdentifier(ownerId, 'SURFACE_AI_ACTION_OWNER_MISMATCH');
      for (const [actionId, record] of records) {
        if (record.ownerId === normalizedOwnerId) {
          record.controller.abort();
          records.delete(actionId);
        }
      }
    },
    revokeAll: () => {
      for (const [actionId, record] of records) {
        record.controller.abort();
        records.delete(actionId);
      }
    },
  });
};
