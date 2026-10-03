/**
 * Versioned, evaluation-only data for causal User Intelligence. It accepts
 * synthetic fixtures or explicitly consented user records; it does not train
 * a model or permit private runtime context to become training data.
 */
export const CAUSAL_EVALUATION_DATASET_VERSION = 2 as const;

export type CausalEvaluationScope = {
  kind: 'global' | 'surface' | 'workspace' | 'package' | 'session';
  id?: string;
};

export type CausalEvaluationReason = { kind: 'known'; text: string } | { kind: 'missing' };

export type CausalEvaluationSource =
  | {
      kind: 'synthetic';
      fixtureId: string;
      provenance: { schemaVersion: 1; generatorVersion: string; licenseId: string };
    }
  | {
      kind: 'consented-user';
      consent: {
        programId: string;
        policyVersion: string;
        grantedAt: number;
        /** Required when this evaluation record contains private user context. */
        privateDataApproved: boolean;
        /** Required when this evaluation record contains sensitive user context. */
        sensitiveDataApproved: boolean;
        /** Exact destination approval required before private context is projected to cloud. */
        cloudProjectionDestinationId?: string;
      };
    };

export type CausalEvaluationProjectionTarget = {
  scope: CausalEvaluationScope;
  placement: 'local' | 'cloud';
  destinationId: string;
};

export const WITHDRAWAL_PROPAGATION_TARGETS = [
  'projection',
  'search',
  'package-context',
  'corpus',
  'index',
  'cache',
  'queued-job',
  'evaluation-artifact',
  'backup',
] as const;

export type CausalEvaluationWithdrawalPropagationTarget = (typeof WITHDRAWAL_PROPAGATION_TARGETS)[number];
export type CausalEvaluationWithdrawalPropagationEvidence = {
  schemaVersion: 1;
  deletionLedgerVersion: string;
  occurredAt: number;
  targets: Array<{
    target: CausalEvaluationWithdrawalPropagationTarget;
    state: 'removed' | 'tombstoned' | 'quarantined';
    verifiedAt: number;
  }>;
};

export type CausalEvaluationRecord = {
  id: string;
  source: CausalEvaluationSource;
  dataClass: 'non-sensitive' | 'private' | 'sensitive';
  context: string;
  originEvidence: string;
  reason: CausalEvaluationReason;
  scope: CausalEvaluationScope;
  proposal: string;
  outcome: 'helpful' | 'not_helpful' | 'rejected' | 'needs_reason';
  /** Count is evidence only. It cannot turn an unexplained action into a rule. */
  observationCount: number;
  operation: 'upsert' | 'correct' | 'delete' | 'withdraw-consent';
  /** Existing record IDs invalidated by this correction, deletion, or consent withdrawal. */
  affects: string[];
  /** Required for deletion and consent-withdrawal records. */
  propagationEvidence?: CausalEvaluationWithdrawalPropagationEvidence;
};

export type CausalEvaluationDataset = {
  version: typeof CAUSAL_EVALUATION_DATASET_VERSION;
  projectionTarget: CausalEvaluationProjectionTarget;
  records: CausalEvaluationRecord[];
};

export type CausalEvaluationIssueCode =
  | 'INVALID_DATASET_VERSION'
  | 'INVALID_PROJECTION_TARGET'
  | 'INVALID_RECORD'
  | 'DUPLICATE_RECORD_ID'
  | 'MISSING_PROVENANCE'
  | 'UNCONSENTED_USER_DATA'
  | 'CONSENT_POLICY_VERSION_REQUIRED'
  | 'PRIVATE_DATA_CONSENT_REQUIRED'
  | 'SENSITIVE_DATA_CONSENT_REQUIRED'
  | 'CLOUD_PROJECTION_CONSENT_REQUIRED'
  | 'CAUSAL_STAGE_REQUIRED'
  | 'INVALID_SCOPE'
  | 'INVALID_OBSERVATION_COUNT'
  | 'INVALID_OPERATION_AFFECTS'
  | 'INVALID_WITHDRAWAL_PROPAGATION_EVIDENCE';

export type CausalEvaluationIssue = { recordId?: string; code: CausalEvaluationIssueCode };
export type CausalEvaluationValidation = { valid: boolean; issues: CausalEvaluationIssue[] };

export type CausalEvaluationLabel = 'projectable' | 'needs_reason' | 'not_projectable' | 'removed';
export type CausalEvaluationScore = {
  recordId: string;
  label: CausalEvaluationLabel;
  score: number;
  reasons: string[];
};
export type CausalEvaluationResult = {
  validation: CausalEvaluationValidation;
  scores: CausalEvaluationScore[];
  projectionCandidates: CausalEvaluationRecord[];
};

const MAX_TEXT_LENGTH = 4_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBoundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
const isSafeTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isBoundedText);

const hasValidScope = (scope: unknown): scope is CausalEvaluationScope => {
  if (!isRecord(scope)) return false;
  if (!['global', 'surface', 'workspace', 'package', 'session'].includes(String(scope.kind))) return false;
  return scope.kind === 'global' ? scope.id === undefined : isBoundedText(scope.id);
};

const hasValidProjectionTarget = (target: unknown): target is CausalEvaluationProjectionTarget =>
  isRecord(target) &&
  hasValidScope(target.scope) &&
  (target.placement === 'local' || target.placement === 'cloud') &&
  isBoundedText(target.destinationId);

const hasValidPropagationEvidence = (value: unknown): value is CausalEvaluationWithdrawalPropagationEvidence => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isBoundedText(value.deletionLedgerVersion)) return false;
  if (!isSafeTimestamp(value.occurredAt) || !Array.isArray(value.targets)) return false;
  const targetIds = new Set<string>();
  for (const target of value.targets) {
    if (
      !isRecord(target) ||
      !WITHDRAWAL_PROPAGATION_TARGETS.includes(target.target as CausalEvaluationWithdrawalPropagationTarget) ||
      !['removed', 'tombstoned', 'quarantined'].includes(String(target.state)) ||
      !isSafeTimestamp(target.verifiedAt) ||
      target.verifiedAt < value.occurredAt ||
      targetIds.has(String(target.target))
    ) {
      return false;
    }
    targetIds.add(String(target.target));
  }
  return (
    targetIds.size === WITHDRAWAL_PROPAGATION_TARGETS.length &&
    WITHDRAWAL_PROPAGATION_TARGETS.every((target) => targetIds.has(target))
  );
};

const validateSource = (
  source: unknown,
  dataClass: unknown,
  projectionTarget: CausalEvaluationProjectionTarget,
  recordId: string
): CausalEvaluationIssue[] => {
  if (!isRecord(source)) return [{ recordId, code: 'UNCONSENTED_USER_DATA' }];
  if (source.kind === 'synthetic') {
    const provenance = source.provenance;
    if (
      !isBoundedText(source.fixtureId) ||
      !isRecord(provenance) ||
      provenance.schemaVersion !== 1 ||
      !isBoundedText(provenance.generatorVersion) ||
      !isBoundedText(provenance.licenseId)
    ) {
      return [{ recordId, code: 'MISSING_PROVENANCE' }];
    }
    return [];
  }
  if (source.kind !== 'consented-user' || !isRecord(source.consent)) {
    return [{ recordId, code: 'UNCONSENTED_USER_DATA' }];
  }
  const consent = source.consent;
  const issues: CausalEvaluationIssue[] = [];
  if (!isBoundedText(consent.programId) || !isSafeTimestamp(consent.grantedAt)) {
    issues.push({ recordId, code: 'UNCONSENTED_USER_DATA' });
  }
  if (!isBoundedText(consent.policyVersion)) issues.push({ recordId, code: 'CONSENT_POLICY_VERSION_REQUIRED' });
  if ((dataClass === 'private' || dataClass === 'sensitive') && consent.privateDataApproved !== true) {
    issues.push({ recordId, code: 'PRIVATE_DATA_CONSENT_REQUIRED' });
  }
  if (dataClass === 'sensitive' && consent.sensitiveDataApproved !== true) {
    issues.push({ recordId, code: 'SENSITIVE_DATA_CONSENT_REQUIRED' });
  }
  if (
    projectionTarget.placement === 'cloud' &&
    (dataClass === 'private' || dataClass === 'sensitive') &&
    consent.cloudProjectionDestinationId !== projectionTarget.destinationId
  ) {
    issues.push({ recordId, code: 'CLOUD_PROJECTION_CONSENT_REQUIRED' });
  }
  return issues;
};

const hasValidReason = (reason: unknown): boolean =>
  isRecord(reason) &&
  ((reason.kind === 'known' && isBoundedText(reason.text)) || (reason.kind === 'missing' && !('text' in reason)));

/** Validates provenance, consent, causal stages, and withdrawal propagation before evaluation. */
export const validateCausalEvaluationDataset = (input: unknown): CausalEvaluationValidation => {
  if (!isRecord(input) || input.version !== CAUSAL_EVALUATION_DATASET_VERSION || !Array.isArray(input.records)) {
    return { valid: false, issues: [{ code: 'INVALID_DATASET_VERSION' }] };
  }
  if (!hasValidProjectionTarget(input.projectionTarget)) {
    return { valid: false, issues: [{ code: 'INVALID_PROJECTION_TARGET' }] };
  }
  const issues: CausalEvaluationIssue[] = [];
  const ids = new Set<string>();
  for (const item of input.records) {
    if (!isRecord(item) || !isBoundedText(item.id)) {
      issues.push({ code: 'INVALID_RECORD' });
      continue;
    }
    const recordId = item.id;
    if (ids.has(recordId)) issues.push({ recordId, code: 'DUPLICATE_RECORD_ID' });
    ids.add(recordId);
    if (!['non-sensitive', 'private', 'sensitive'].includes(String(item.dataClass))) {
      issues.push({ recordId, code: 'INVALID_RECORD' });
    }
    issues.push(...validateSource(item.source, item.dataClass, input.projectionTarget, recordId));
    if (!isBoundedText(item.context) || !isBoundedText(item.originEvidence) || !isBoundedText(item.proposal)) {
      issues.push({ recordId, code: 'CAUSAL_STAGE_REQUIRED' });
    }
    if (!hasValidReason(item.reason)) issues.push({ recordId, code: 'CAUSAL_STAGE_REQUIRED' });
    if (!hasValidScope(item.scope)) issues.push({ recordId, code: 'INVALID_SCOPE' });
    if (!['helpful', 'not_helpful', 'rejected', 'needs_reason'].includes(String(item.outcome))) {
      issues.push({ recordId, code: 'CAUSAL_STAGE_REQUIRED' });
    }
    if (!Number.isSafeInteger(item.observationCount) || (item.observationCount as number) < 1) {
      issues.push({ recordId, code: 'INVALID_OBSERVATION_COUNT' });
    }
    const operation = item.operation;
    if (
      !['upsert', 'correct', 'delete', 'withdraw-consent'].includes(String(operation)) ||
      !isStringArray(item.affects)
    ) {
      issues.push({ recordId, code: 'INVALID_OPERATION_AFFECTS' });
    } else if (
      (operation === 'upsert' && item.affects.length !== 0) ||
      (operation !== 'upsert' && (item.affects.length === 0 || item.affects.includes(recordId)))
    ) {
      issues.push({ recordId, code: 'INVALID_OPERATION_AFFECTS' });
    }
    if (operation === 'delete' || operation === 'withdraw-consent') {
      if (!hasValidPropagationEvidence(item.propagationEvidence)) {
        issues.push({ recordId, code: 'INVALID_WITHDRAWAL_PROPAGATION_EVIDENCE' });
      }
    } else if (item.propagationEvidence !== undefined) {
      issues.push({ recordId, code: 'INVALID_WITHDRAWAL_PROPAGATION_EVIDENCE' });
    }
  }
  return { valid: issues.length === 0, issues };
};

const scopesMatch = (recordScope: CausalEvaluationScope, targetScope: CausalEvaluationScope): boolean =>
  recordScope.kind === targetScope.kind && recordScope.id === targetScope.id;

const scoreRecord = (
  record: CausalEvaluationRecord,
  projectionTarget: CausalEvaluationProjectionTarget,
  removedIds: ReadonlySet<string>
): CausalEvaluationScore => {
  if (removedIds.has(record.id)) {
    return { recordId: record.id, label: 'removed', score: 0, reasons: ['AFFECTED_BY_CORRECTION_OR_DELETION'] };
  }
  if (record.operation === 'delete' || record.operation === 'withdraw-consent') {
    return {
      recordId: record.id,
      label: 'not_projectable',
      score: 0,
      reasons: ['DELETION_OR_CONSENT_WITHDRAWAL_EVENT'],
    };
  }
  if (record.reason.kind === 'missing') {
    return {
      recordId: record.id,
      label: 'needs_reason',
      score: 0,
      reasons: ['REASONLESS_REPETITION_REQUIRES_QUESTION'],
    };
  }
  if (!scopesMatch(record.scope, projectionTarget.scope)) {
    return { recordId: record.id, label: 'not_projectable', score: 0, reasons: ['SCOPED_CONFLICT_OR_MISMATCH'] };
  }
  if (record.outcome !== 'helpful') {
    return { recordId: record.id, label: 'not_projectable', score: 0, reasons: ['OUTCOME_NOT_REUSABLE'] };
  }
  return { recordId: record.id, label: 'projectable', score: 100, reasons: ['CAUSAL_CHAIN_CONFIRMED'] };
};

/**
 * Scores a validated dataset deterministically. Corrections/deletions remove
 * all affected candidates independent of event order; a target-scope mismatch
 * and reasonless repetition are never projected as reusable preferences.
 */
export const scoreCausalEvaluationDataset = (input: unknown): CausalEvaluationResult => {
  const validation = validateCausalEvaluationDataset(input);
  if (!validation.valid) return { validation, scores: [], projectionCandidates: [] };
  const dataset = input as CausalEvaluationDataset;
  const removedIds = new Set(
    dataset.records.filter((record) => record.operation !== 'upsert').flatMap((record) => record.affects)
  );
  const scores = dataset.records.map((record) => scoreRecord(record, dataset.projectionTarget, removedIds));
  const projectableIds = new Set(
    scores.filter((score) => score.label === 'projectable').map((score) => score.recordId)
  );
  return {
    validation,
    scores,
    projectionCandidates: dataset.records.filter((record) => projectableIds.has(record.id)),
  };
};
