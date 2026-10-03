/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { LinkedMicrosoftAppRecord, PackageManifest } from '../../../../common/packages';
import { CatalogFederationError, type InstalledMicrosoftAppIdentity } from './types';

const MAX_QUERY_LENGTH = 200;
export const MAX_RESULTS_PER_SOURCE = 50;
const SAFE_PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const SAFE_MICROSOFT_PRODUCT_ID = /^[A-Z0-9]{8,32}$/;
const SAFE_PACKAGE_FAMILY_NAME = /^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/;
const DENIED_ACTIVATION_PROTOCOLS = new Set(['data:', 'file:', 'javascript:', 'shell:', 'vbscript:']);

export type AutomatedPackageReviewReason =
  | 'REVIEW_FINGERPRINT_CHANGED'
  | 'PACKAGE_TYPE_REQUIRES_REVIEW'
  | 'RUNTIME_REQUIRES_REVIEW'
  | 'PERMISSIONS_REQUIRE_REVIEW'
  | 'DEPENDENCIES_REQUIRE_REVIEW'
  | 'NATIVE_CODE_REQUIRES_REVIEW'
  | 'NATIVE_CODE_UNKNOWN'
  | 'AI_OPERATIONS_REQUIRE_REVIEW'
  | 'AI_OPERATIONS_UNKNOWN'
  | 'DESTINATIONS_REQUIRE_REVIEW'
  | 'DESTINATIONS_UNKNOWN';

/**
 * A publisher-safe explanation of one deterministic technical review outcome.
 * Evidence deliberately names only the review class; it never includes archive
 * paths, bytes, destinations, signing material, or other untrusted artifact data.
 */
export type AutomatedPackageReviewFinding = Readonly<{
  code: AutomatedPackageReviewReason;
  severity: 'warning';
  evidence: string;
  remediation: string;
}>;

export type AutomatedPackageReviewInput = Readonly<{
  manifest: PackageManifest;
  inspection: Readonly<{
    hasNativeCode: boolean | 'unknown';
    aiOperations: readonly string[] | 'unknown';
    destinations: readonly string[] | 'unknown';
  }>;
  /** The exact fingerprint produced by the previous review, if one exists. */
  priorApprovalFingerprint?: string;
}>;

export type AutomatedPackageReviewDecision = Readonly<{
  disposition: 'auto-approved' | 'human-review-required';
  fingerprint: string;
  reasons: readonly AutomatedPackageReviewReason[];
  findings: readonly AutomatedPackageReviewFinding[];
}>;

const REVIEW_FINDING_DETAILS: Readonly<
  Record<AutomatedPackageReviewReason, Omit<AutomatedPackageReviewFinding, 'code'>>
> = {
  REVIEW_FINGERPRINT_CHANGED: {
    severity: 'warning',
    evidence: 'The submitted technical review state differs from the prior approval.',
    remediation: 'Request a new authoritative review for this exact package version.',
  },
  PACKAGE_TYPE_REQUIRES_REVIEW: {
    severity: 'warning',
    evidence: 'The package type is outside the automatic technical review scope.',
    remediation: 'Request authoritative review for the declared package type.',
  },
  RUNTIME_REQUIRES_REVIEW: {
    severity: 'warning',
    evidence: 'The package declares a runtime outside the automatic technical review scope.',
    remediation: 'Request authoritative review for the declared runtime.',
  },
  PERMISSIONS_REQUIRE_REVIEW: {
    severity: 'warning',
    evidence: 'The package declares one or more permissions.',
    remediation: 'Request authoritative review for the declared permissions.',
  },
  DEPENDENCIES_REQUIRE_REVIEW: {
    severity: 'warning',
    evidence: 'The package declares one or more dependencies.',
    remediation: 'Request authoritative review for the declared dependencies.',
  },
  NATIVE_CODE_REQUIRES_REVIEW: {
    severity: 'warning',
    evidence: 'The technical inspection reports native code.',
    remediation: 'Request authoritative review for the inspected native code.',
  },
  NATIVE_CODE_UNKNOWN: {
    severity: 'warning',
    evidence: 'The technical inspection could not determine whether native code is present.',
    remediation: 'Provide a complete inspection, then request authoritative review.',
  },
  AI_OPERATIONS_REQUIRE_REVIEW: {
    severity: 'warning',
    evidence: 'The technical inspection reports one or more AI operations.',
    remediation: 'Request authoritative review for the inspected AI operations.',
  },
  AI_OPERATIONS_UNKNOWN: {
    severity: 'warning',
    evidence: 'The technical inspection could not determine the package AI operations.',
    remediation: 'Provide a complete inspection, then request authoritative review.',
  },
  DESTINATIONS_REQUIRE_REVIEW: {
    severity: 'warning',
    evidence: 'The technical inspection reports one or more outbound destinations.',
    remediation: 'Request authoritative review for the inspected outbound access.',
  },
  DESTINATIONS_UNKNOWN: {
    severity: 'warning',
    evidence: 'The technical inspection could not determine outbound destinations.',
    remediation: 'Provide a complete inspection, then request authoritative review.',
  },
};

export const automatedPackageReviewFindings = (
  reasons: readonly AutomatedPackageReviewReason[]
): readonly AutomatedPackageReviewFinding[] =>
  Object.freeze(
    reasons.map((code) =>
      Object.freeze({
        code,
        ...REVIEW_FINDING_DETAILS[code],
      })
    )
  );

const canonicalizeReviewValue = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeReviewValue).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeReviewValue(entry)}`)
    .join(',')}}`;
};

const normalizedInspectionValues = (value: readonly string[]): string[] =>
  [...new Set(value.map((item) => item.trim()))].toSorted();

/**
 * Produces a deterministic, fail-closed review decision for Store admission.
 * A prior approval is valid only for this exact manifest plus the inspected
 * native-code, AI-operation, and destination findings.
 */
export const decideAutomatedPackageReview = (input: AutomatedPackageReviewInput): AutomatedPackageReviewDecision => {
  const aiOperations =
    input.inspection.aiOperations === 'unknown' ? 'unknown' : normalizedInspectionValues(input.inspection.aiOperations);
  const destinations =
    input.inspection.destinations === 'unknown' ? 'unknown' : normalizedInspectionValues(input.inspection.destinations);
  const fingerprint = `sha256-${createHash('sha256')
    .update(
      canonicalizeReviewValue({
        manifest: input.manifest,
        inspection: {
          hasNativeCode: input.inspection.hasNativeCode,
          aiOperations,
          destinations,
        },
      })
    )
    .digest('hex')}`;
  const reasons: AutomatedPackageReviewReason[] = [];

  if (input.priorApprovalFingerprint !== undefined && input.priorApprovalFingerprint !== fingerprint) {
    reasons.push('REVIEW_FINGERPRINT_CHANGED');
  }
  if (input.manifest.type !== 'app') reasons.push('PACKAGE_TYPE_REQUIRES_REVIEW');
  if (input.manifest.modules.some((module) => module.runtime !== 'sandboxed-web')) {
    reasons.push('RUNTIME_REQUIRES_REVIEW');
  }
  if (input.manifest.permissions.length > 0) reasons.push('PERMISSIONS_REQUIRE_REVIEW');
  if (input.manifest.dependencies.length > 0) reasons.push('DEPENDENCIES_REQUIRE_REVIEW');
  if (input.inspection.hasNativeCode === 'unknown') reasons.push('NATIVE_CODE_UNKNOWN');
  if (input.inspection.hasNativeCode === true) reasons.push('NATIVE_CODE_REQUIRES_REVIEW');
  if (aiOperations === 'unknown') reasons.push('AI_OPERATIONS_UNKNOWN');
  if (Array.isArray(aiOperations) && aiOperations.length > 0) reasons.push('AI_OPERATIONS_REQUIRE_REVIEW');
  if (destinations === 'unknown') reasons.push('DESTINATIONS_UNKNOWN');
  if (Array.isArray(destinations) && destinations.length > 0) reasons.push('DESTINATIONS_REQUIRE_REVIEW');

  return {
    disposition: reasons.length === 0 ? 'auto-approved' : 'human-review-required',
    fingerprint,
    reasons,
    findings: automatedPackageReviewFindings(reasons),
  };
};

const containsControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

export const normalizeProductId = (value: string): string => value.trim().toUpperCase();

export const parseMicrosoftProductId = (value: string): string => {
  const productId = normalizeProductId(value);
  if (!SAFE_MICROSOFT_PRODUCT_ID.test(productId)) {
    throw new CatalogFederationError('CATALOG_REQUEST_INVALID', 'Microsoft Store product ID is invalid.');
  }
  return productId;
};

export const parseRegion = (value: string): string => {
  const region = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) {
    throw new CatalogFederationError('CATALOG_REQUEST_INVALID', 'Catalog region must be a two-letter code.');
  }
  return region;
};

export const parseLimit = (value: number | undefined): number => {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULTS_PER_SOURCE) {
    throw new CatalogFederationError(
      'CATALOG_REQUEST_INVALID',
      `Catalog result limit must be between 1 and ${MAX_RESULTS_PER_SOURCE}.`
    );
  }
  return value;
};

export const parseSearchQuery = (value: string): string => {
  const query = value.trim();
  if (!query || query.length > MAX_QUERY_LENGTH || containsControlCharacters(query) || query.startsWith('-')) {
    throw new CatalogFederationError('CATALOG_REQUEST_INVALID', 'Catalog search query is invalid.');
  }
  return query;
};

const safeIsoDate = (value: string, field: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new CatalogFederationError('LINKED_APP_INVALID', `${field} must be a valid ISO date.`);
  }
  return value;
};

const parseWindowsVersion = (value: string, field: string): readonly number[] => {
  const parts = value.split('.');
  if (parts.length < 1 || parts.length > 4) {
    throw new CatalogFederationError('LINKED_APP_INVALID', `${field} must contain one to four numeric parts.`);
  }
  const parsed = parts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isInteger(part) || part < 0 || part > 65_535)) {
    throw new CatalogFederationError('LINKED_APP_INVALID', `${field} contains an invalid numeric part.`);
  }
  return [...parsed, ...Array.from({ length: 4 - parsed.length }, () => 0)];
};

const compareWindowsVersions = (left: readonly number[], right: readonly number[]): number => {
  for (let index = 0; index < 4; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
};

const validateActivationUri = (value: string): string => {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch (error) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked app activation URI is invalid.', { cause: error });
  }
  if (DENIED_ACTIVATION_PROTOCOLS.has(uri.protocol.toLocaleLowerCase())) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked app activation protocol is not allowed.');
  }
  return uri.toString();
};

const stringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new CatalogFederationError('LINKED_APP_INVALID', `${field} must be an array of non-empty strings.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
};

export const parseLinkedMicrosoftAppRecord = (value: unknown): LinkedMicrosoftAppRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked Microsoft app record must be an object.');
  }
  const raw = value as Record<string, unknown>;
  const microsoft = raw.microsoft as Record<string, unknown> | undefined;
  const requirements = raw.requirements as Record<string, unknown> | undefined;
  const review = raw.review as Record<string, unknown> | undefined;
  if (raw.schemaVersion !== 1 || typeof raw.id !== 'string' || !SAFE_PACKAGE_ID.test(raw.id)) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked Microsoft app identity is invalid.');
  }
  if (
    raw.tomniPackageId !== undefined &&
    (typeof raw.tomniPackageId !== 'string' || !SAFE_PACKAGE_ID.test(raw.tomniPackageId))
  ) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked Tomni package identity is invalid.');
  }
  const productId = typeof microsoft?.productId === 'string' ? normalizeProductId(microsoft.productId) : '';
  if (!SAFE_MICROSOFT_PRODUCT_ID.test(productId)) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Microsoft Store product ID is invalid.');
  }
  if (
    typeof microsoft?.packageFamilyName !== 'string' ||
    !SAFE_PACKAGE_FAMILY_NAME.test(microsoft.packageFamilyName) ||
    typeof microsoft.publisherIdentity !== 'string' ||
    !microsoft.publisherIdentity.trim()
  ) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Microsoft package identity is invalid.');
  }
  const rawVersion = microsoft.version as Record<string, unknown> | undefined;
  const minimumInclusive =
    typeof rawVersion?.minimumInclusive === 'string' ? rawVersion.minimumInclusive.trim() : undefined;
  const maximumExclusive =
    typeof rawVersion?.maximumExclusive === 'string' ? rawVersion.maximumExclusive.trim() : undefined;
  const minimumParts = minimumInclusive ? parseWindowsVersion(minimumInclusive, 'minimumInclusive') : undefined;
  const maximumParts = maximumExclusive ? parseWindowsVersion(maximumExclusive, 'maximumExclusive') : undefined;
  if (minimumParts && maximumParts && compareWindowsVersions(minimumParts, maximumParts) >= 0) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked app version range is empty.');
  }
  if (!requirements || !['free', 'paid', 'unknown'].includes(String(requirements.license))) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked app license requirement is invalid.');
  }
  if (
    !review ||
    typeof review.revision !== 'string' ||
    !review.revision.trim() ||
    !['healthy', 'degraded', 'blocked'].includes(String(review.health)) ||
    typeof review.killSwitch !== 'boolean'
  ) {
    throw new CatalogFederationError('LINKED_APP_INVALID', 'Linked app review state is invalid.');
  }
  const activation = raw.activation as Record<string, unknown> | undefined;
  const connectors = raw.connectors as Record<string, unknown> | undefined;
  return {
    schemaVersion: 1,
    id: raw.id,
    ...(typeof raw.tomniPackageId === 'string' ? { tomniPackageId: raw.tomniPackageId } : {}),
    microsoft: {
      productId,
      packageFamilyName: microsoft.packageFamilyName,
      publisherIdentity: microsoft.publisherIdentity.trim(),
      version: {
        ...(minimumInclusive ? { minimumInclusive } : {}),
        ...(maximumExclusive ? { maximumExclusive } : {}),
      },
    },
    ...(activation?.uri !== undefined ? { activation: { uri: validateActivationUri(String(activation.uri)) } } : {}),
    ...(connectors
      ? {
          connectors: {
            ...(connectors.appActions !== undefined
              ? { appActions: stringArray(connectors.appActions, 'connectors.appActions') }
              : {}),
            ...(typeof connectors.agentLauncher === 'string' && connectors.agentLauncher.trim()
              ? { agentLauncher: connectors.agentLauncher.trim() }
              : {}),
            ...(typeof connectors.mcpServerId === 'string' && connectors.mcpServerId.trim()
              ? { mcpServerId: connectors.mcpServerId.trim() }
              : {}),
          },
        }
      : {}),
    permissions: stringArray(raw.permissions, 'permissions'),
    requirements: {
      ...(requirements.regions !== undefined
        ? { regions: stringArray(requirements.regions, 'requirements.regions').map(parseRegion) }
        : {}),
      ...(requirements.deviceFamilies !== undefined
        ? { deviceFamilies: stringArray(requirements.deviceFamilies, 'requirements.deviceFamilies') }
        : {}),
      license: requirements.license as LinkedMicrosoftAppRecord['requirements']['license'],
    },
    review: {
      revision: review.revision.trim(),
      reviewedAt: safeIsoDate(String(review.reviewedAt ?? ''), 'review.reviewedAt'),
      health: review.health as LinkedMicrosoftAppRecord['review']['health'],
      killSwitch: review.killSwitch,
    },
  };
};

export const assertLinkedAppMayRun = (record: LinkedMicrosoftAppRecord, region: string): void => {
  if (record.review.killSwitch || record.review.health === 'blocked') {
    throw new CatalogFederationError('LINKED_APP_BLOCKED', 'Linked Microsoft app is blocked by review policy.');
  }
  if (record.review.health !== 'healthy') {
    throw new CatalogFederationError('LINKED_APP_NOT_REVIEWED', 'Linked Microsoft app is not healthy for activation.');
  }
  if (record.requirements.regions && !record.requirements.regions.includes(region)) {
    throw new CatalogFederationError('LINKED_APP_BLOCKED', 'Linked Microsoft app is unavailable in this region.');
  }
};

export const verifyLinkedIdentity = (
  record: LinkedMicrosoftAppRecord,
  identity: InstalledMicrosoftAppIdentity | undefined
): InstalledMicrosoftAppIdentity => {
  if (
    !identity ||
    identity.packageFamilyName !== record.microsoft.packageFamilyName ||
    identity.publisherIdentity !== record.microsoft.publisherIdentity
  ) {
    throw new CatalogFederationError(
      'LINKED_APP_IDENTITY_MISMATCH',
      'Installed Microsoft app identity does not match the reviewed link.'
    );
  }
  const installed = parseWindowsVersion(identity.version, 'installed version');
  const minimum = record.microsoft.version.minimumInclusive
    ? parseWindowsVersion(record.microsoft.version.minimumInclusive, 'minimumInclusive')
    : undefined;
  const maximum = record.microsoft.version.maximumExclusive
    ? parseWindowsVersion(record.microsoft.version.maximumExclusive, 'maximumExclusive')
    : undefined;
  if (
    (minimum && compareWindowsVersions(installed, minimum) < 0) ||
    (maximum && compareWindowsVersions(installed, maximum) >= 0)
  ) {
    throw new CatalogFederationError(
      'LINKED_APP_VERSION_INCOMPATIBLE',
      'Installed Microsoft app version is outside the reviewed range.'
    );
  }
  return identity;
};
