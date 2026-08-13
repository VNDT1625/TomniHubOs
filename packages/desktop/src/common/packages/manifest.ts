/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import { z } from 'zod';
import type { PackageManifest } from './types';

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
      .max(100)
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

    contributions: packageContributionsSchema.optional(),
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
    for (const [index, permission] of manifest.permissions.entries()) {
      if (permissionIds.has(permission)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['permissions', index],
          message: 'Package permissions must be unique',
        });
      }
      permissionIds.add(permission);
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
