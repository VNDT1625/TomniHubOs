/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type {
  CreatorPreviewOpenRequest,
  CreatorPreviewPolicy,
  CreatorPreviewQuota,
  CreatorSandboxCapabilities,
} from './creatorPreviewTypes';

export type CreatorPreviewSafetyLimits = CreatorPreviewQuota;

export const DEFAULT_CREATOR_PREVIEW_LIMITS: CreatorPreviewSafetyLimits = {
  ramMiB: 4_096,
  cpuPercent: 100,
  diskMiB: 10_240,
  processes: 64,
  timeoutMs: 30 * 60_000,
};

export class CreatorPreviewPolicyError extends Error {
  constructor(
    readonly kind: 'invalid-request' | 'unenforceable',
    readonly reason: string
  ) {
    super(reason);
    this.name = 'CreatorPreviewPolicyError';
  }
}

const TECHNICAL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

/** Reject arbitrary user text so request metadata can safely enter receipts and events. */
const requireId = (value: unknown, field: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!TECHNICAL_IDENTIFIER_PATTERN.test(normalized)) {
    throw new CreatorPreviewPolicyError('invalid-request', `${field} must be a bounded technical identifier.`);
  }
  return normalized;
};

const requireBoundedInteger = (value: number, maximum: number, field: string): number => {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value) || value > maximum) {
    throw new CreatorPreviewPolicyError('unenforceable', `${field} exceeds the configured safety limit.`);
  }
  return value;
};

const normalizeCapabilities = (values: string[], field: string): string[] => {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(normalized)) {
      throw new CreatorPreviewPolicyError('invalid-request', `${field} contains an invalid capability id.`);
    }
    result.add(normalized);
  }
  return [...result].toSorted();
};

const normalizeOrigin = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CreatorPreviewPolicyError('invalid-request', 'network.allowedOrigins contains an invalid URL origin.');
  }
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
    throw new CreatorPreviewPolicyError('invalid-request', 'Only credential-free HTTP(S) origins are allowed.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin === 'null') {
    throw new CreatorPreviewPolicyError(
      'invalid-request',
      'Network allowlist entries must be exact origins without path, query or hash.'
    );
  }
  return parsed.origin;
};

export const normalizeCreatorPreviewPolicy = (
  policy: CreatorPreviewPolicy,
  limits: CreatorPreviewSafetyLimits = DEFAULT_CREATOR_PREVIEW_LIMITS
): CreatorPreviewPolicy => {
  const requestedCapabilities = normalizeCapabilities(policy.requestedCapabilities, 'requestedCapabilities');
  const grantedCapabilities = normalizeCapabilities(policy.grantedCapabilities, 'grantedCapabilities');
  const requested = new Set(requestedCapabilities);
  if (grantedCapabilities.some((capability) => !requested.has(capability))) {
    throw new CreatorPreviewPolicyError(
      'invalid-request',
      'A granted capability must also be present in requestedCapabilities.'
    );
  }
  const allowedOrigins = [...new Set(policy.network.allowedOrigins.map(normalizeOrigin))].toSorted();
  if (policy.network.mode === 'blocked' && allowedOrigins.length > 0) {
    throw new CreatorPreviewPolicyError('invalid-request', 'Blocked network policy cannot contain allowed origins.');
  }
  if (policy.network.mode === 'allowlist' && allowedOrigins.length === 0) {
    throw new CreatorPreviewPolicyError(
      'invalid-request',
      'Allowlist network policy requires at least one exact origin.'
    );
  }
  return {
    quota: {
      ramMiB: requireBoundedInteger(policy.quota.ramMiB, limits.ramMiB, 'quota.ramMiB'),
      cpuPercent: requireBoundedInteger(policy.quota.cpuPercent, limits.cpuPercent, 'quota.cpuPercent'),
      diskMiB: requireBoundedInteger(policy.quota.diskMiB, limits.diskMiB, 'quota.diskMiB'),
      processes: requireBoundedInteger(policy.quota.processes, limits.processes, 'quota.processes'),
      timeoutMs: requireBoundedInteger(policy.quota.timeoutMs, limits.timeoutMs, 'quota.timeoutMs'),
    },
    network: { mode: policy.network.mode, allowedOrigins },
    requestedCapabilities,
    grantedCapabilities,
  };
};

export const assertPolicyEnforceable = (
  policy: CreatorPreviewPolicy,
  capabilities: CreatorSandboxCapabilities
): void => {
  if (!capabilities.quotaEnforcement) {
    throw new CreatorPreviewPolicyError('unenforceable', 'The sandbox driver cannot enforce resource quotas.');
  }
  if (capabilities.networkIsolation === 'none') {
    throw new CreatorPreviewPolicyError(
      'unenforceable',
      'The sandbox driver cannot enforce default-deny network isolation.'
    );
  }
  if (policy.network.mode === 'allowlist' && capabilities.networkIsolation !== 'allowlist') {
    throw new CreatorPreviewPolicyError(
      'unenforceable',
      'The sandbox driver cannot enforce the requested network allowlist.'
    );
  }
};

export const normalizeCreatorPreviewOpenRequest = (
  request: CreatorPreviewOpenRequest,
  limits?: CreatorPreviewSafetyLimits
): CreatorPreviewOpenRequest => {
  const workspaceRoot = path.resolve(request.workspaceRoot);
  if (!path.isAbsolute(request.workspaceRoot)) {
    throw new CreatorPreviewPolicyError('invalid-request', 'workspaceRoot must be an absolute path.');
  }
  const entrypoint = request.entrypoint.trim().replaceAll('\\', '/');
  if (
    !entrypoint ||
    path.posix.isAbsolute(entrypoint) ||
    /^[a-z]:\//i.test(entrypoint) ||
    entrypoint.startsWith('//')
  ) {
    throw new CreatorPreviewPolicyError('invalid-request', 'entrypoint must be a relative project path.');
  }
  const resolvedEntry = path.resolve(workspaceRoot, entrypoint);
  const relativeEntry = path.relative(workspaceRoot, resolvedEntry);
  if (!relativeEntry || relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
    throw new CreatorPreviewPolicyError('invalid-request', 'entrypoint must resolve to a file inside workspaceRoot.');
  }
  if (request.deadlineAt !== undefined && !Number.isFinite(request.deadlineAt)) {
    throw new CreatorPreviewPolicyError('invalid-request', 'deadlineAt must be a finite Unix timestamp.');
  }
  return {
    ...request,
    previewId: requireId(request.previewId, 'previewId'),
    projectId: requireId(request.projectId, 'projectId'),
    requestId: requireId(request.requestId, 'requestId'),
    correlationId: requireId(request.correlationId ?? request.requestId, 'correlationId'),
    workspaceRoot,
    entrypoint: relativeEntry.replaceAll('\\', '/'),
    policy: normalizeCreatorPreviewPolicy(request.policy, limits),
  };
};

export const creatorPreviewRequestFingerprint = (request: CreatorPreviewOpenRequest): string =>
  JSON.stringify({
    operation: 'open',
    previewId: request.previewId,
    projectId: request.projectId,
    correlationId: request.correlationId,
    workspaceRoot: request.workspaceRoot,
    entrypoint: request.entrypoint,
    policy: request.policy,
    deadlineAt: request.deadlineAt,
  });
