/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime validators for the Creator Preview IPC boundary.
 *
 * The generic adapter transports untyped JSON. This module builds fresh,
 * allowlisted records so prototype fields, surplus keys and renderer-provided
 * privilege grants never reach the sandbox runtime.
 */

import type {
  CreatorPreviewOpenRequest,
  CreatorPreviewOperationRequest,
  CreatorPreviewPolicy,
  CreatorPreviewQuota,
} from './creatorPreviewTypes';

export type CreatorPreviewBridgeOperation =
  | 'open'
  | 'suspend'
  | 'snapshot'
  | 'reset'
  | 'remove'
  | 'cancel'
  | 'get-state';

export type CreatorPreviewBridgeAccessRequest = {
  operation: CreatorPreviewBridgeOperation;
  previewId: string;
  projectId?: string;
  workspaceRoot?: string;
  entrypoint?: string;
  requestedCapabilities?: readonly string[];
};

/**
 * Main-process admission hook. It must resolve project ownership from a trusted
 * registry; it must not treat renderer payload fields as proof of authority.
 */
export type CreatorPreviewBridgeAccessPolicy<SenderContext = unknown> = {
  authorize(sender: SenderContext, request: CreatorPreviewBridgeAccessRequest): boolean | Promise<boolean>;
};

export type CreatorPreviewBridgeOpenRequest = Omit<CreatorPreviewOpenRequest, 'signal'>;
export type CreatorPreviewBridgeOperationRequest = Omit<CreatorPreviewOperationRequest, 'signal'>;
export type CreatorPreviewBridgeCancelRequest = { previewId: string; requestId: string };
export type CreatorPreviewBridgeStateRequest = { previewId: string };

export class CreatorPreviewBridgePayloadError extends Error {
  constructor(readonly code: 'INVALID_PREVIEW_REQUEST' | 'CREATOR_PREVIEW_UNAUTHORIZED') {
    super(code);
    this.name = 'CreatorPreviewBridgePayloadError';
  }
}

type UnknownRecord = Record<string, unknown>;

const TECHNICAL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PATH_LENGTH = 4_096;
const MAX_ORIGIN_LENGTH = 2_048;
const MAX_CAPABILITIES = 64;
const MAX_ALLOWED_ORIGINS = 64;

const invalid = (): never => {
  throw new CreatorPreviewBridgePayloadError('INVALID_PREVIEW_REQUEST');
};

const unauthorized = (): never => {
  throw new CreatorPreviewBridgePayloadError('CREATOR_PREVIEW_UNAUTHORIZED');
};

const requirePlainRecord = (value: unknown, allowedKeys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    if (Object.getOwnPropertySymbols(value).length > 0) invalid();
    const allowed = new Set(allowedKeys);
    const keys = Object.keys(value);
    if (keys.some((key) => UNSAFE_KEYS.has(key) || !allowed.has(key))) invalid();
    return value as UnknownRecord;
  } catch (error) {
    if (error instanceof CreatorPreviewBridgePayloadError) throw error;
    invalid();
  }
};

const requireTechnicalIdentifier = (value: unknown): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!TECHNICAL_IDENTIFIER_PATTERN.test(normalized)) invalid();
  return normalized;
};

const requireBoundedString = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value !== value.trim())
    return invalid();
  return value;
};

const requireOptionalTechnicalIdentifier = (value: unknown): string | undefined =>
  value === undefined ? undefined : requireTechnicalIdentifier(value);

const requireOptionalDeadline = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid();
  return value;
};

const requirePositiveInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
};

const requireStringArray = (value: unknown, maximum: number, itemMaximum: number): string[] => {
  if (!Array.isArray(value) || value.length > maximum) return invalid();
  return value.map((item) => requireBoundedString(item, itemMaximum));
};

const parseQuota = (value: unknown): CreatorPreviewQuota => {
  const record = requirePlainRecord(value, ['ramMiB', 'cpuPercent', 'diskMiB', 'processes', 'timeoutMs']);
  return {
    ramMiB: requirePositiveInteger(record.ramMiB),
    cpuPercent: requirePositiveInteger(record.cpuPercent),
    diskMiB: requirePositiveInteger(record.diskMiB),
    processes: requirePositiveInteger(record.processes),
    timeoutMs: requirePositiveInteger(record.timeoutMs),
  };
};

const parsePolicy = (value: unknown): CreatorPreviewPolicy => {
  const record = requirePlainRecord(value, ['quota', 'network', 'requestedCapabilities', 'grantedCapabilities']);
  const network = requirePlainRecord(record.network, ['mode', 'allowedOrigins']);
  const mode = network.mode;
  if (mode !== 'blocked' && mode !== 'allowlist') return invalid();
  const requestedCapabilities = requireStringArray(record.requestedCapabilities, MAX_CAPABILITIES, 64);
  const submittedGrantedCapabilities = requireStringArray(record.grantedCapabilities, MAX_CAPABILITIES, 64);
  if (submittedGrantedCapabilities.length > 0) unauthorized();
  return {
    quota: parseQuota(record.quota),
    network: {
      mode,
      allowedOrigins: requireStringArray(network.allowedOrigins, MAX_ALLOWED_ORIGINS, MAX_ORIGIN_LENGTH),
    },
    requestedCapabilities,
    // Permission grants are selected only by a trusted main-process policy.
    grantedCapabilities: [],
  };
};

export const parseCreatorPreviewOpenRequest = (value: unknown): CreatorPreviewBridgeOpenRequest => {
  const record = requirePlainRecord(value, [
    'previewId',
    'projectId',
    'requestId',
    'correlationId',
    'workspaceRoot',
    'entrypoint',
    'policy',
    'deadlineAt',
  ]);
  return {
    previewId: requireTechnicalIdentifier(record.previewId),
    projectId: requireTechnicalIdentifier(record.projectId),
    requestId: requireTechnicalIdentifier(record.requestId),
    correlationId: requireOptionalTechnicalIdentifier(record.correlationId),
    workspaceRoot: requireBoundedString(record.workspaceRoot, MAX_PATH_LENGTH),
    entrypoint: requireBoundedString(record.entrypoint, MAX_PATH_LENGTH),
    policy: parsePolicy(record.policy),
    deadlineAt: requireOptionalDeadline(record.deadlineAt),
  };
};

export const parseCreatorPreviewOperationRequest = (value: unknown): CreatorPreviewBridgeOperationRequest => {
  const record = requirePlainRecord(value, ['previewId', 'requestId', 'correlationId']);
  return {
    previewId: requireTechnicalIdentifier(record.previewId),
    requestId: requireTechnicalIdentifier(record.requestId),
    correlationId: requireOptionalTechnicalIdentifier(record.correlationId),
  };
};

export const parseCreatorPreviewCancelRequest = (value: unknown): CreatorPreviewBridgeCancelRequest => {
  const record = requirePlainRecord(value, ['previewId', 'requestId']);
  return {
    previewId: requireTechnicalIdentifier(record.previewId),
    requestId: requireTechnicalIdentifier(record.requestId),
  };
};

export const parseCreatorPreviewStateRequest = (value: unknown): CreatorPreviewBridgeStateRequest => {
  const record = requirePlainRecord(value, ['previewId']);
  return { previewId: requireTechnicalIdentifier(record.previewId) };
};
