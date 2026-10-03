/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import { z } from 'zod';
import type {
  AcquisitionGrant,
  CapabilityCandidate,
  CapabilityQuery,
  CapabilityResolution,
  CommissionEntry,
  CommerceOrder,
  CommerceOrderLifecycle,
  Entitlement,
  PackageIdentity,
  PackageMainContribution,
  PackageManifest,
  PackageSyscallEnvelope,
  PaymentEvent,
  ProductOffer,
  PublisherPayable,
  Refund,
  StoreSignedPublisherKeyCertificate,
  StoreSignedPublisherKeyRevocation,
} from './types';

const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const CONTRIBUTION_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SURFACE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const PERMISSION = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const SHA256_INTEGRITY = /^sha256-[a-f0-9]{64}$/;
const MAX_PACKAGE_ID_LENGTH = 200;
const MAX_CONTRIBUTION_ID_LENGTH = 160;
const MAX_SURFACE_LENGTH = 512;
const MAX_PERMISSION_LENGTH = 160;
const MAX_SEMVER_LENGTH = 128;
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;

const nonBlank = z.string().trim().min(1);
const packageId = z.string().max(MAX_PACKAGE_ID_LENGTH).regex(PACKAGE_ID);
const semverVersion = z
  .string()
  .max(MAX_SEMVER_LENGTH)
  .refine((value) => semver.valid(value) !== null, 'Expected a valid semantic version');
const semverRange = z
  .string()
  .max(MAX_SEMVER_LENGTH)
  .refine((value) => semver.validRange(value) !== null, 'Expected a valid semantic range');
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Expected an HTTPS URL');

const contributionId = z.string().max(MAX_CONTRIBUTION_ID_LENGTH).regex(CONTRIBUTION_ID);
const surface = z.string().max(MAX_SURFACE_LENGTH).regex(SURFACE);
const permission = z.string().max(MAX_PERMISSION_LENGTH).regex(PERMISSION);
const contributionTitle = nonBlank.max(120);
const contributionTitleKey = nonBlank.max(200).optional();
const contributionOrder = z.number().int().min(-10_000).max(10_000).optional();
const activityGroupId = z.enum(['codebase', 'agent-ops']);
const aiDataClass = z.enum(['workspace', 'conversation', 'personal', 'artifact', 'secret-handle']);
const aiOperationSchema = z
  .object({
    id: contributionId,
    capability: contributionId,
    inputSchemaVersion: z.literal(1),
    dataClasses: z.array(aiDataClass).min(1).max(10),
    destinationIds: z.array(contributionId).max(50),
  })
  .strict();
const packageMainContributionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.enum(['browser-host-v1', 'design-viu-v1', 'terminal-host-v1']),
  })
  .strict();
const packageMainContributionsSchema = z
  .array(packageMainContributionSchema)
  .min(1)
  .max(8)
  .superRefine((entries, context) => {
    const ids = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (ids.has(entry.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'Main contribution ids must be unique',
        });
      }
      ids.add(entry.id);
    }
  });
const packageContributionsSchema = z
  .object({
    version: z.literal(1),
    apps: z
      .array(
        z
          .object({
            id: contributionId,
            title: contributionTitle,
            titleKey: contributionTitleKey,
            moduleId: contributionId,
            order: contributionOrder,
          })
          .strict()
      )
      // One Package App exposes one user-facing Surface. Additional modules
      // remain internal contributions of that Surface, not extra applications.
      .max(1)
      .optional(),

    themes: z
      .array(
        z
          .object({
            id: contributionId,
            name: nonBlank.max(120),
            cover: z.string().optional(),
            css: z.string(),
          })
          .strict()
      )
      .max(50)
      .optional(),
    ide: z
      .object({
        hostApiVersion: semverRange,
        activityGroups: z
          .array(
            z
              .object({
                id: activityGroupId,
                title: contributionTitle,
                titleKey: contributionTitleKey,
                order: contributionOrder,
              })
              .strict()
          )
          .max(100)
          .optional(),
        subtabs: z
          .array(
            z
              .object({
                id: contributionId,
                title: contributionTitle,
                titleKey: contributionTitleKey,
                activityGroupId,
                moduleId: contributionId,
                activation: z.enum(['on-open', 'on-startup']),
                order: contributionOrder,
              })
              .strict()
          )
          .max(100)
          .optional(),
        commands: z
          .array(z.object({ id: contributionId, title: contributionTitle, titleKey: contributionTitleKey }).strict())
          .max(100)
          .optional(),
        settings: z
          .array(
            z.discriminatedUnion('type', [
              z
                .object({
                  id: contributionId,
                  title: contributionTitle,
                  titleKey: contributionTitleKey,
                  type: z.literal('boolean'),
                  default: z.boolean().optional(),
                })
                .strict(),
              z
                .object({
                  id: contributionId,
                  title: contributionTitle,
                  titleKey: contributionTitleKey,
                  type: z.literal('number'),
                  default: z.number().finite().optional(),
                })
                .strict(),
              z
                .object({
                  id: contributionId,
                  title: contributionTitle,
                  titleKey: contributionTitleKey,
                  type: z.literal('string'),
                  default: z.string().max(10_000).optional(),
                })
                .strict(),
            ])
          )
          .max(100)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const packageManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: packageId,
    publisherId: packageId,
    name: nonBlank.max(120),
    description: nonBlank.max(1000),
    type: z.enum(['app', 'ui', 'agent-capsule']),
    bundleKind: z.enum(['single', 'suite']),
    version: semverVersion,
    engines: z.object({ tomni: semverRange }).strict(),
    modules: z
      .array(
        z
          .object({
            id: contributionId,
            title: nonBlank.max(120),
            surface,
            pinnable: z.boolean(),
            runtime: z.enum(['sandboxed-web', 'trusted-react']).optional(),
            entrypoint: surface.optional(),
            styleEntrypoint: surface.optional(),
          })
          .strict()
      )
      .max(100),
    permissions: z.array(permission).max(100),
    dependencies: z.array(z.object({ id: packageId, version: semverRange }).strict()).max(100),
    aiAccess: z
      .object({
        schemaVersion: z.literal(1),
        operations: z.array(aiOperationSchema).min(1).max(100),
      })
      .strict()
      .optional(),

    contributions: packageContributionsSchema.optional(),
    mainContributions: packageMainContributionsSchema.optional(),
    tags: z.array(nonBlank.max(64)).max(50),
    screenshots: z
      .array(
        z
          .object({
            url: httpsUrl,
            alt: nonBlank.max(240).optional(),
          })
          .strict()
      )
      .max(10)
      .optional(),
    artifact: z
      .object({
        integrity: z.string().regex(SHA256_INTEGRITY),
        sizeBytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
        signature: z
          .object({
            algorithm: z.literal('ed25519'),
            keyId: nonBlank.max(128),
            value: nonBlank.max(128),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.type === 'app' && manifest.modules.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['modules'], message: 'App packages need a module' });
    }

    const moduleIds = new Set<string>();
    for (const [index, module] of manifest.modules.entries()) {
      if (moduleIds.has(module.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modules', index, 'id'],
          message: 'Module ids must be unique',
        });
      }
      moduleIds.add(module.id);

      if (module.runtime === 'sandboxed-web' && !module.entrypoint?.toLocaleLowerCase().endsWith('.html')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modules', index, 'entrypoint'],
          message: 'Sandboxed web modules need an HTML entrypoint',
        });
      }
      if (module.runtime === 'trusted-react' && !module.entrypoint?.toLocaleLowerCase().endsWith('.js')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modules', index, 'entrypoint'],
          message: 'Trusted React modules need a JavaScript entrypoint',
        });
      }
      if (module.styleEntrypoint && !module.styleEntrypoint.toLocaleLowerCase().endsWith('.css')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modules', index, 'styleEntrypoint'],
          message: 'Package module styles need a CSS entrypoint',
        });
      }
    }

    const dependencyIds = new Set<string>();
    for (const [index, dependency] of manifest.dependencies.entries()) {
      if (dependency.id === manifest.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dependencies', index, 'id'],
          message: 'A package cannot depend on itself',
        });
      }
      if (dependencyIds.has(dependency.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dependencies', index, 'id'],
          message: 'Dependency ids must be unique',
        });
      }
      dependencyIds.add(dependency.id);
    }

    const permissionIds = new Set<string>();
    for (const [index, permissionId] of manifest.permissions.entries()) {
      if (permissionIds.has(permissionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['permissions', index],
          message: 'Package permissions must be unique',
        });
      }
      permissionIds.add(permissionId);
    }

    const aiOperationIds = new Set<string>();
    for (const [index, operation] of manifest.aiAccess?.operations.entries() ?? []) {
      if (aiOperationIds.has(operation.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aiAccess', 'operations', index, 'id'],
          message: 'AI operation ids must be unique',
        });
      }
      aiOperationIds.add(operation.id);
      if (new Set(operation.dataClasses).size !== operation.dataClasses.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aiAccess', 'operations', index, 'dataClasses'],
          message: 'AI operation data classes must be unique',
        });
      }
      if (new Set(operation.destinationIds).size !== operation.destinationIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aiAccess', 'operations', index, 'destinationIds'],
          message: 'AI operation destination ids must be unique',
        });
      }
    }

    if (manifest.mainContributions) {
      if (manifest.id !== 'com.tomni.design-studio' || manifest.publisherId !== 'com.tomni') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mainContributions'],
          message: 'design-viu-v1 is reserved for com.tomni.design-studio',
        });
      }
    }

    const contributions = manifest.contributions;
    if (!contributions) return;
    if (contributions.ide && manifest.id !== 'com.tomni.ide') {
      if (manifest.type !== 'ui') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['type'],
          message: 'Only UI packages may extend the IDE',
        });
      }
      if (!manifest.dependencies.some((entry) => entry.id === 'com.tomni.ide')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dependencies'],
          message: 'IDE contributions must depend on com.tomni.ide',
        });
      }
    }
    const moduleIdsForContributions = new Set(manifest.modules.map((module) => module.id));
    const validateUniqueIds = (entries: readonly unknown[] | undefined, path: string): void => {
      const ids = new Set<string>();
      for (const [index, entry] of (entries ?? []).entries()) {
        if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'string') continue;
        if (ids.has(entry.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contributions', path, index, 'id'],
            message: 'Contribution ids must be unique within their kind',
          });
        }
        ids.add(entry.id);
      }
    };
    validateUniqueIds(contributions.apps, 'apps');

    validateUniqueIds(contributions.themes, 'themes');
    validateUniqueIds(contributions.ide?.activityGroups, 'ide.activityGroups');
    validateUniqueIds(contributions.ide?.subtabs, 'ide.subtabs');
    validateUniqueIds(contributions.ide?.commands, 'ide.commands');
    validateUniqueIds(contributions.ide?.settings, 'ide.settings');
    for (const [index, contribution] of (contributions.apps ?? []).entries()) {
      if (!moduleIdsForContributions.has(contribution.moduleId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contributions', 'apps', index, 'moduleId'],
          message: 'App contribution references an unknown module',
        });
      }
    }
    for (const [index, contribution] of (contributions.ide?.subtabs ?? []).entries()) {
      if (!moduleIdsForContributions.has(contribution.moduleId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contributions', 'ide', 'subtabs', index, 'moduleId'],
          message: 'IDE subtab references an unknown module',
        });
      }
    }

    if (manifest.type !== 'app' && (contributions.apps?.length ?? 0) > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contributions', 'apps'],
        message: 'Only app packages may contribute Apps Library entries',
      });
    }
    if (manifest.id !== 'com.tomni.ide' && (contributions.ide?.activityGroups?.length ?? 0) > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contributions', 'ide', 'activityGroups'],
        message: 'IDE activity groups are owned by com.tomni.ide',
      });
    }
  });

export const parsePackageManifest = (value: unknown): PackageManifest =>
  packageManifestSchema.parse(value) as PackageManifest;

/** Parses an inert, bounded Main-contribution mirror carried by a signed catalog entry. */
export const parsePackageMainContributions = (value: unknown): PackageMainContribution[] =>
  packageMainContributionsSchema.parse(value) as PackageMainContribution[];

export const isPackageCompatible = (manifest: PackageManifest, appVersion: string): boolean =>
  semver.valid(appVersion) !== null &&
  semver.satisfies(appVersion, manifest.engines.tomni, { includePrerelease: true });

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(',')}}`;
};

export const packageSignaturePayload = (manifest: PackageManifest): string => {
  if (!manifest.artifact) throw new Error(`Package ${manifest.id} does not declare an artifact.`);
  const signedManifest = {
    ...manifest,
    artifact: {
      ...manifest.artifact,
      signature: {
        algorithm: manifest.artifact.signature.algorithm,
        keyId: manifest.artifact.signature.keyId,
      },
    },
  };
  return canonicalize(signedManifest);
};

const contractId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
const contractText = z.string().trim().min(1).max(500);
const contractIsoTime = z.string().datetime({ offset: true });
const ed25519SignatureSchema = z
  .object({
    algorithm: z.literal('ed25519'),
    keyId: contractId,
    value: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
const ed25519PublicKeyPem = z
  .string()
  .max(1_024)
  .regex(/^-----BEGIN PUBLIC KEY-----\r?\nMCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=\r?\n-----END PUBLIC KEY-----\r?\n?$/);
const publisherCertificateSchema = z
  .object({
    schemaVersion: z.literal(1),
    certificateId: contractId,
    publisherId: packageId.refine(
      (value) => value !== 'com.tomni' && !value.startsWith('com.tomni.'),
      'A Store publisher certificate cannot enroll a protected Tomni namespace'
    ),
    signingKey: z
      .object({
        keyId: contractId,
        algorithm: z.literal('ed25519'),
        publicKeyPem: ed25519PublicKeyPem,
        spkiSha256: z.string().regex(/^sha256-[a-f0-9]{64}$/),
      })
      .strict(),
    issuedAt: contractIsoTime,
    expiresAt: contractIsoTime,
    signature: ed25519SignatureSchema,
  })
  .strict()
  .superRefine((certificate, context) => {
    if (Date.parse(certificate.expiresAt) <= Date.parse(certificate.issuedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'The publisher certificate must expire after it is issued',
      });
    }
  });

const publisherKeyRevocationSchema = z
  .object({
    schemaVersion: z.literal(1),
    revocationId: contractId,
    certificateId: contractId,
    publisherId: packageId.refine(
      (value) => value !== 'com.tomni' && !value.startsWith('com.tomni.'),
      'A Store publisher key revocation cannot target a protected Tomni namespace'
    ),
    signingKeyId: contractId,
    revokedAt: contractIsoTime,
    reasonCode: contractId,
    signature: ed25519SignatureSchema,
  })
  .strict();

/**
 * Produces the canonical Store-signature payload for a publisher key
 * certificate. Verification and Store-root pinning remain Main-only duties.
 */
export const storePublisherKeyCertificateSignaturePayload = (certificate: StoreSignedPublisherKeyCertificate): string =>
  canonicalize({
    schemaVersion: certificate.schemaVersion,
    certificateId: certificate.certificateId,
    publisherId: certificate.publisherId,
    signingKey: certificate.signingKey,
    issuedAt: certificate.issuedAt,
    expiresAt: certificate.expiresAt,
    signature: { algorithm: certificate.signature.algorithm, keyId: certificate.signature.keyId },
  });

/** Produces the canonical Store-signature payload for a publisher-key withdrawal. */
export const storePublisherKeyRevocationSignaturePayload = (revocation: StoreSignedPublisherKeyRevocation): string =>
  canonicalize({
    schemaVersion: revocation.schemaVersion,
    revocationId: revocation.revocationId,
    certificateId: revocation.certificateId,
    publisherId: revocation.publisherId,
    signingKeyId: revocation.signingKeyId,
    revokedAt: revocation.revokedAt,
    reasonCode: revocation.reasonCode,
    signature: { algorithm: revocation.signature.algorithm, keyId: revocation.signature.keyId },
  });
const contractPackageIdentitySchema = z
  .object({ packageId, packageVersion: semverVersion, publisherId: packageId })
  .strict();
const dataLocationSchema = z.enum(['local-only', 'region-bound', 'remote-allowed']);
const moneyMinorSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const productOfferSchema = z
  .object({
    schemaVersion: z.literal(1),
    offerId: contractId,
    productId: contractId,
    package: contractPackageIdentitySchema,
    sellerKind: z.enum(['first-party', 'third-party']),
    price: moneyMinorSchema,
    taxTreatment: z.enum(['exclusive', 'inclusive', 'not-applicable']),
    revision: contractId,
    active: z.boolean(),
  })
  .strict();

export const capabilityQuerySchema = z
  .object({
    schemaVersion: z.literal(1),
    queryId: contractId,
    requester: contractPackageIdentitySchema,
    capability: permission,
    purpose: contractText,
    dataLocation: dataLocationSchema,
    requireUi: z.boolean(),
    requireOffline: z.boolean(),
    idempotencyKey: contractId,
  })
  .strict();
const capabilityCandidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidateId: contractId,
    package: contractPackageIdentitySchema,
    contribution: z.object({ package: contractPackageIdentitySchema, contributionId }).strict().optional(),
    capability: permission,
    state: z.enum(['ready-local', 'ready-remote', 'installable', 'unavailable']),
    trusted: z.boolean(),
    compatible: z.boolean(),
    healthy: z.boolean(),
    dataLocation: dataLocationSchema,
    supportsUi: z.boolean(),
    supportsOffline: z.boolean(),
    reasonCodes: z.array(contractId).max(32),
  })
  .strict();
export const capabilityResolutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    queryId: contractId,
    candidates: z.array(capabilityCandidateSchema).max(100),
    selectedCandidateId: contractId.optional(),
    evaluatedAt: contractIsoTime,
  })
  .strict()
  .superRefine((resolution, context) => {
    if (
      resolution.selectedCandidateId !== undefined &&
      !resolution.candidates.some((candidate) => candidate.candidateId === resolution.selectedCandidateId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedCandidateId'],
        message: 'Selected candidate is absent.',
      });
    }
  });
export const packageSyscallEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    caller: contractPackageIdentitySchema,
    runId: contractId,
    capabilityGrantId: contractId,
    syscall: permission,
    idempotencyKey: contractId,
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(10 * 60 * 1000),
    cancellationToken: contractId,
    resourceBudgetMb: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024),
  })
  .strict();

export const commerceOrderSchema = z
  .object({
    schemaVersion: z.literal(1),
    orderId: contractId,
    accountId: contractId,
    offer: productOfferSchema,
    state: z.enum(['created', 'payment-pending', 'paid', 'failed', 'cancelled', 'refunded']),
    idempotencyKey: contractId,
    createdAt: contractIsoTime,
    updatedAt: contractIsoTime,
  })
  .strict();
export const paymentEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    paymentEventId: contractId,
    orderId: contractId,
    providerEventId: contractId,
    kind: z.enum(['authorized', 'captured', 'failed', 'refunded']),
    amount: moneyMinorSchema,
    idempotencyKey: contractId,
    occurredAt: contractIsoTime,
  })
  .strict();
export const refundSchema = z
  .object({
    schemaVersion: z.literal(1),
    refundId: contractId,
    orderId: contractId,
    paymentEventId: contractId,
    amount: moneyMinorSchema,
    reasonCode: contractId,
    idempotencyKey: contractId,
    createdAt: contractIsoTime,
  })
  .strict();
export const entitlementSchema = z
  .object({
    schemaVersion: z.literal(1),
    entitlementId: contractId,
    accountId: contractId,
    offerId: contractId,
    package: contractPackageIdentitySchema,
    state: z.enum(['active', 'revoked', 'expired']),
    issuedAt: contractIsoTime,
    expiresAt: contractIsoTime.optional(),
  })
  .strict();
export const acquisitionGrantSchema = z
  .object({
    schemaVersion: z.literal(1),
    grantId: contractId,
    accountId: contractId,
    offerId: contractId,
    package: contractPackageIdentitySchema,
    entitlementId: contractId,
    policyVersion: contractId,
    expiresAt: contractIsoTime.optional(),
    offlineRule: z.enum(['none', 'validated-install-retained']).optional(),
  })
  .strict()
  .superRefine((grant, context) => {
    if (grant.expiresAt === undefined && grant.offlineRule === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Acquisition grant requires expiry or offline rule.' });
    }
  });
type OptionalPackageIdentity = Readonly<{ packageId?: string; packageVersion?: string; publisherId?: string }>;
type OptionalMoneyMinor = Readonly<{ currency?: string; amountMinor?: number }>;
const samePackageIdentity = (left: OptionalPackageIdentity, right: OptionalPackageIdentity): boolean =>
  left.packageId === right.packageId &&
  left.packageVersion === right.packageVersion &&
  left.publisherId === right.publisherId;
const sameMoneyMinor = (left: OptionalMoneyMinor, right: OptionalMoneyMinor): boolean =>
  left.currency === right.currency && left.amountMinor === right.amountMinor;
const firstDuplicate = (values: readonly string[]): string | undefined => {
  const seen = new Set<string>();
  return values.find((value) => (seen.has(value) ? true : (seen.add(value), false)));
};
const expectedPaymentKinds = (state: CommerceOrder['state']): readonly PaymentEvent['kind'][] | undefined => {
  switch (state) {
    case 'created':
      return [];
    case 'payment-pending':
      return ['authorized'];
    case 'paid':
      return ['authorized', 'captured'];
    case 'failed':
      return ['authorized', 'failed'];
    case 'cancelled':
      return undefined;
    case 'refunded':
      return ['authorized', 'captured', 'refunded'];
  }
};

/**
 * Validates one complete current Store lifecycle from append-only payment and refund evidence.
 * This is ordinary-payment state only: it cannot mint, reserve, settle, or spend Tomni Credit.
 */
export const commerceOrderLifecycleSchema = z
  .object({
    order: commerceOrderSchema,
    paymentEvents: z.array(paymentEventSchema).max(3),
    refunds: z.array(refundSchema).max(1),
    entitlement: entitlementSchema.optional(),
    activeGrant: acquisitionGrantSchema.optional(),
  })
  .strict()
  .superRefine((lifecycle, context) => {
    const { activeGrant, entitlement, order, paymentEvents, refunds } = lifecycle;
    const issue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    };
    const orderCreatedAt = Date.parse(order.createdAt);
    const orderUpdatedAt = Date.parse(order.updatedAt);
    const paymentIdentifiers: Array<readonly [key: keyof PaymentEvent, values: readonly string[]]> = [
      ['paymentEventId', paymentEvents.map((event) => event.paymentEventId)],
      ['providerEventId', paymentEvents.map((event) => event.providerEventId)],
      ['idempotencyKey', paymentEvents.map((event) => event.idempotencyKey)],
    ];
    for (const [field, values] of paymentIdentifiers) {
      const duplicate = firstDuplicate(values);
      if (duplicate !== undefined) issue(['paymentEvents'], `Duplicate payment ${field}: ${duplicate}.`);
    }
    const expectedKinds = expectedPaymentKinds(order.state);
    const actualKinds = paymentEvents.map((event) => event.kind);
    const cancelledPaymentShape =
      order.state === 'cancelled' &&
      (actualKinds.length === 0 || (actualKinds.length === 1 && actualKinds[0] === 'authorized'));
    if (
      !cancelledPaymentShape &&
      (expectedKinds === undefined ||
        expectedKinds.length !== actualKinds.length ||
        expectedKinds.some((kind, index) => kind !== actualKinds[index]))
    ) {
      issue(['paymentEvents'], `Payment evidence does not match the ${order.state} order state.`);
    }

    let latestEvidenceAt = orderCreatedAt;
    let previousEventAt = orderCreatedAt;
    paymentEvents.forEach((event, index) => {
      const occurredAt = Date.parse(event.occurredAt);
      if (event.orderId !== order.orderId)
        issue(['paymentEvents', index, 'orderId'], 'Payment event is bound to another order.');
      if (!sameMoneyMinor(event.amount, order.offer.price)) {
        issue(['paymentEvents', index, 'amount'], 'Payment amount must equal the authoritative offer price.');
      }
      if (occurredAt < previousEventAt) {
        issue(['paymentEvents', index, 'occurredAt'], 'Payment events must be in authoritative occurrence order.');
      }
      previousEventAt = occurredAt;
      latestEvidenceAt = Math.max(latestEvidenceAt, occurredAt);
    });
    const capturedPayment = paymentEvents.find((event) => event.kind === 'captured');

    if (order.state === 'refunded') {
      const refund = refunds[0];
      if (refund === undefined) {
        issue(['refunds'], 'A refunded order requires exactly one refund record.');
      } else {
        const refundCreatedAt = Date.parse(refund.createdAt);
        if (refund.orderId !== order.orderId) issue(['refunds', 0, 'orderId'], 'Refund is bound to another order.');
        if (refund.paymentEventId !== capturedPayment?.paymentEventId) {
          issue(['refunds', 0, 'paymentEventId'], 'Refund must compensate the captured payment event.');
        }
        if (!sameMoneyMinor(refund.amount, order.offer.price)) {
          issue(['refunds', 0, 'amount'], 'The MVP refund must exactly reverse the authoritative offer price.');
        }
        if (refundCreatedAt < previousEventAt) {
          issue(['refunds', 0, 'createdAt'], 'Refund cannot predate the payment evidence it compensates.');
        }
        latestEvidenceAt = Math.max(latestEvidenceAt, refundCreatedAt);
      }
    } else if (refunds.length !== 0) {
      issue(['refunds'], 'Only a refunded order may retain a refund record.');
    }

    if (orderUpdatedAt < latestEvidenceAt) {
      issue(['order', 'updatedAt'], 'Order update time cannot predate its latest commercial evidence.');
    }

    const requiresEntitlement = order.state === 'paid' || order.state === 'refunded';
    if (requiresEntitlement && entitlement === undefined) {
      issue(['entitlement'], 'A paid or refunded order requires entitlement evidence.');
    }
    if (!requiresEntitlement && entitlement !== undefined) {
      issue(['entitlement'], 'Only paid or refunded orders may retain entitlement evidence.');
    }
    if (entitlement !== undefined) {
      if (entitlement.accountId !== order.accountId)
        issue(['entitlement', 'accountId'], 'Entitlement is bound to another account.');
      if (entitlement.offerId !== order.offer.offerId)
        issue(['entitlement', 'offerId'], 'Entitlement is bound to another offer.');
      if (!samePackageIdentity(entitlement.package, order.offer.package)) {
        issue(['entitlement', 'package'], 'Entitlement package identity must match the purchased offer.');
      }
      if (Date.parse(entitlement.issuedAt) < orderCreatedAt) {
        issue(['entitlement', 'issuedAt'], 'Entitlement cannot predate order creation.');
      }
      if (
        requiresEntitlement &&
        (capturedPayment === undefined || Date.parse(entitlement.issuedAt) < Date.parse(capturedPayment.occurredAt))
      ) {
        issue(['entitlement', 'issuedAt'], 'Entitlement requires prior authoritative payment capture.');
      }
      if (order.state === 'paid' && entitlement.state !== 'active') {
        issue(['entitlement', 'state'], 'A paid order requires an active entitlement.');
      }
      if (order.state === 'refunded' && entitlement.state !== 'revoked') {
        issue(['entitlement', 'state'], 'A refunded order requires a revoked entitlement.');
      }
    }

    if (activeGrant !== undefined) {
      if (order.state !== 'paid' || entitlement?.state !== 'active') {
        issue(['activeGrant'], 'An active acquisition grant requires a paid order and active entitlement.');
      }
      if (activeGrant.accountId !== order.accountId)
        issue(['activeGrant', 'accountId'], 'Grant is bound to another account.');
      if (activeGrant.offerId !== order.offer.offerId)
        issue(['activeGrant', 'offerId'], 'Grant is bound to another offer.');
      if (!samePackageIdentity(activeGrant.package, order.offer.package)) {
        issue(['activeGrant', 'package'], 'Grant package identity must match the purchased offer.');
      }
      if (activeGrant.entitlementId !== entitlement?.entitlementId) {
        issue(['activeGrant', 'entitlementId'], 'Grant must bind the active entitlement.');
      }
    }
  });

const sameCurrency = (values: readonly { currency?: string }[]): boolean => {
  const currency = values[0]?.currency;
  return typeof currency === 'string' && values.every((value) => value.currency === currency);
};
export const commissionEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    commissionId: contractId,
    orderId: contractId,
    gross: moneyMinorSchema,
    tax: moneyMinorSchema,
    refunded: moneyMinorSchema,
    publisherPayable: moneyMinorSchema,
    tomniCommission: moneyMinorSchema,
    rateBasisPoints: z.literal(1500),
  })
  .strict()
  .superRefine((entry, context) => {
    const amounts = [entry.gross, entry.tax, entry.refunded, entry.publisherPayable, entry.tomniCommission];
    if (!sameCurrency(amounts)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Commission currencies must match.' });
      return;
    }
    if (
      entry.publisherPayable.amountMinor + entry.tomniCommission.amountMinor !==
      entry.gross.amountMinor - entry.tax.amountMinor - entry.refunded.amountMinor
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Commission amounts do not reconcile.' });
    }
  });
export const publisherPayableSchema = z
  .object({
    schemaVersion: z.literal(1),
    payableId: contractId,
    publisherId: packageId,
    commissionId: contractId,
    amount: moneyMinorSchema,
    state: z.enum(['accrued', 'reversed', 'paid']),
  })
  .strict();

export const parseCapabilityQuery = (value: unknown): CapabilityQuery =>
  capabilityQuerySchema.parse(value) as CapabilityQuery;
export const parseCapabilityCandidate = (value: unknown): CapabilityCandidate =>
  capabilityCandidateSchema.parse(value) as CapabilityCandidate;
export const parseCapabilityResolution = (value: unknown): CapabilityResolution =>
  capabilityResolutionSchema.parse(value) as CapabilityResolution;
export const parsePackageSyscallEnvelope = (value: unknown): PackageSyscallEnvelope =>
  packageSyscallEnvelopeSchema.parse(value) as PackageSyscallEnvelope;
export const parseProductOffer = (value: unknown): ProductOffer => productOfferSchema.parse(value) as ProductOffer;
export const parseCommerceOrder = (value: unknown): CommerceOrder => commerceOrderSchema.parse(value) as CommerceOrder;
export const parseCommerceOrderLifecycle = (value: unknown): CommerceOrderLifecycle =>
  commerceOrderLifecycleSchema.parse(value) as CommerceOrderLifecycle;
export const parsePaymentEvent = (value: unknown): PaymentEvent => paymentEventSchema.parse(value) as PaymentEvent;
export const parseRefund = (value: unknown): Refund => refundSchema.parse(value) as Refund;
export const parseEntitlement = (value: unknown): Entitlement => entitlementSchema.parse(value) as Entitlement;
export const parseAcquisitionGrant = (value: unknown): AcquisitionGrant =>
  acquisitionGrantSchema.parse(value) as AcquisitionGrant;
export const parseCommissionEntry = (value: unknown): CommissionEntry =>
  commissionEntrySchema.parse(value) as CommissionEntry;
export const parsePublisherPayable = (value: unknown): PublisherPayable =>
  publisherPayableSchema.parse(value) as PublisherPayable;
export const parseStoreSignedPublisherKeyCertificate = (value: unknown): StoreSignedPublisherKeyCertificate =>
  publisherCertificateSchema.parse(value) as StoreSignedPublisherKeyCertificate;
/** Strict data parser; Store-root signature verification remains loader-owned. */
export const parseStoreSignedPublisherKeyRevocation = (value: unknown): StoreSignedPublisherKeyRevocation =>
  publisherKeyRevocationSchema.parse(value) as StoreSignedPublisherKeyRevocation;
export const parsePackageIdentity = (value: unknown): PackageIdentity =>
  contractPackageIdentitySchema.parse(value) as PackageIdentity;
