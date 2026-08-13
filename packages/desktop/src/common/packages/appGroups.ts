/**
 * User-owned app group contracts. A group is local workspace state, never package manifest metadata.
 * Keeping this outside signed manifests lets users compose installed apps without changing publisher-owned artifacts.
 */

import { z } from 'zod';

const APP_GROUP_SCHEMA_VERSION = 1 as const;
const APP_GROUP_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const CONTRIBUTION_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAX_APP_GROUP_ID_LENGTH = 160;
const MAX_PACKAGE_ID_LENGTH = 200;
const MAX_CONTRIBUTION_ID_LENGTH = 160;
const RESERVED_WORKSPACE_IDS = new Set(['constructor', 'hasownproperty', 'prototype', 'tostring', 'valueof']);

export const PACKAGE_APP_GROUP_SCHEMA_VERSION = APP_GROUP_SCHEMA_VERSION;

export type PackageAppGroupMemberRole = 'core' | 'optional';

/**
 * Stable app identity: package id + manifest contribution id + module id.
 * Version is deliberately excluded so a group survives a verified package update.
 */
export type PackageAppIdentity = {
  packageId: string;
  appId: string;
  moduleId: string;
};

export type PackageAppGroupMember = PackageAppIdentity & {
  role: PackageAppGroupMemberRole;
};

export type PackageAppGroup = {
  id: string;
  name: string;
  members: PackageAppGroupMember[];
};

export type PackageAppGroupDocument = {
  schemaVersion: typeof PACKAGE_APP_GROUP_SCHEMA_VERSION;
  groups: PackageAppGroup[];
};

/**
 * User-owned groups can be global to the signed-in local user or limited to a
 * single workspace. The workspace identifier is an opaque stable key; it is
 * never a filesystem path supplied by a renderer.
 */
export type PackageAppGroupScope = { kind: 'user' } | { kind: 'workspace'; workspaceId: string };

export type PackageAppGroupReadRequest = {
  scope: PackageAppGroupScope;
};

export type PackageAppGroupCreateRequest = {
  scope: PackageAppGroupScope;
  name: string;
  members: PackageAppGroupMember[];
};

export type PackageAppGroupRenameRequest = {
  scope: PackageAppGroupScope;
  groupId: string;
  name: string;
};

/** Reorders every group in one scope; partial reorder requests are rejected. */
export type PackageAppGroupReorderRequest = {
  scope: PackageAppGroupScope;
  groupIds: string[];
};

export type PackageAppGroupRemoveRequest = {
  scope: PackageAppGroupScope;
  groupId: string;
};

export type ResolvedPackageAppGroupMember = PackageAppGroupMember & {
  availability: 'ready' | 'missing';
};

export type ResolvedPackageAppGroup = Omit<PackageAppGroup, 'members'> & {
  members: ResolvedPackageAppGroupMember[];
};

const appIdentityKey = (identity: PackageAppIdentity): string =>
  identity.packageId + '/' + identity.appId + '/' + identity.moduleId;

const appGroupIdSchema = z.string().max(MAX_APP_GROUP_ID_LENGTH).regex(APP_GROUP_ID);
const packageIdSchema = z.string().max(MAX_PACKAGE_ID_LENGTH).regex(PACKAGE_ID);
const contributionIdSchema = z.string().max(MAX_CONTRIBUTION_ID_LENGTH).regex(CONTRIBUTION_ID);

const appIdentitySchema = z
  .object({ packageId: packageIdSchema, appId: contributionIdSchema, moduleId: contributionIdSchema })
  .strict();

const appGroupMemberSchema = appIdentitySchema.extend({ role: z.enum(['core', 'optional']) }).strict();

const appGroupSchema = z
  .object({
    id: appGroupIdSchema,
    name: z.string().trim().min(1).max(120),
    members: z.array(appGroupMemberSchema).max(100),
  })
  .strict()
  .superRefine((group, context) => {
    const members = new Set<string>();
    for (const [index, member] of group.members.entries()) {
      const key = appIdentityKey(member as PackageAppIdentity);
      if (members.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index],
          message: 'App group members must have unique package/app/module identities',
        });
      }
      members.add(key);
    }
  });

const appGroupDocumentSchema = z
  .object({
    schemaVersion: z.literal(PACKAGE_APP_GROUP_SCHEMA_VERSION),
    groups: z.array(appGroupSchema).max(100),
  })
  .strict()
  .superRefine((document, context) => {
    const groupIds = new Set<string>();
    for (const [index, group] of document.groups.entries()) {
      if (groupIds.has(group.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['groups', index, 'id'],
          message: 'App group ids must be unique',
        });
      }
      groupIds.add(group.id);
    }
  });

const appGroupScopeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('user') }).strict(),
    z.object({ kind: z.literal('workspace'), workspaceId: contributionIdSchema }).strict(),
  ])
  .superRefine((scope, context) => {
    if (scope.kind === 'workspace' && RESERVED_WORKSPACE_IDS.has(scope.workspaceId.toLowerCase())) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaceId'], message: 'Workspace id is reserved' });
    }
  });

const appGroupMemberListSchema = z
  .array(appGroupMemberSchema)
  .min(1)
  .max(100)
  .superRefine((members, context) => {
    const identities = new Set<string>();
    for (const [index, member] of members.entries()) {
      const key = appIdentityKey(member as PackageAppIdentity);
      if (identities.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'App group members must have unique package/app/module identities',
        });
      }
      identities.add(key);
    }
  });

const appGroupReadRequestSchema = z.object({ scope: appGroupScopeSchema }).strict();

const appGroupCreateRequestSchema = z
  .object({
    scope: appGroupScopeSchema,
    name: z.string().trim().min(1).max(120),
    members: appGroupMemberListSchema,
  })
  .strict();

const appGroupRenameRequestSchema = z
  .object({
    scope: appGroupScopeSchema,
    groupId: appGroupIdSchema,
    name: z.string().trim().min(1).max(120),
  })
  .strict();

const appGroupReorderRequestSchema = z
  .object({
    scope: appGroupScopeSchema,
    groupIds: z.array(appGroupIdSchema).max(100),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.groupIds).size !== request.groupIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['groupIds'], message: 'App group ids must be unique' });
    }
  });

const appGroupRemoveRequestSchema = z.object({ scope: appGroupScopeSchema, groupId: appGroupIdSchema }).strict();

/** Parse persisted user-owned app groups without reading package manifests or package state. */
export const parsePackageAppGroupDocument = (input: unknown): PackageAppGroupDocument =>
  appGroupDocumentSchema.parse(input) as PackageAppGroupDocument;

/** Parses an untrusted read request at the Electron boundary. */
export const parsePackageAppGroupReadRequest = (input: unknown): PackageAppGroupReadRequest =>
  appGroupReadRequestSchema.parse(input) as PackageAppGroupReadRequest;

/** Parses an untrusted create request at the Electron boundary. */
export const parsePackageAppGroupCreateRequest = (input: unknown): PackageAppGroupCreateRequest =>
  appGroupCreateRequestSchema.parse(input) as PackageAppGroupCreateRequest;

/** Parses an untrusted rename request at the Electron boundary. */
export const parsePackageAppGroupRenameRequest = (input: unknown): PackageAppGroupRenameRequest =>
  appGroupRenameRequestSchema.parse(input) as PackageAppGroupRenameRequest;

/** Parses an untrusted complete ordering request at the Electron boundary. */
export const parsePackageAppGroupReorderRequest = (input: unknown): PackageAppGroupReorderRequest =>
  appGroupReorderRequestSchema.parse(input) as PackageAppGroupReorderRequest;

/** Parses an untrusted remove request at the Electron boundary. */
export const parsePackageAppGroupRemoveRequest = (input: unknown): PackageAppGroupRemoveRequest =>
  appGroupRemoveRequestSchema.parse(input) as PackageAppGroupRemoveRequest;
/** Returns a copy whose membership is resolved only against installed app identities supplied by the caller. */
export const resolvePackageAppGroup = (
  group: PackageAppGroup,
  installedApps: readonly PackageAppIdentity[]
): ResolvedPackageAppGroup => {
  const installed = new Set(installedApps.map(appIdentityKey));
  return {
    id: group.id,
    name: group.name,
    members: group.members.map((member) => ({
      ...member,
      availability: installed.has(appIdentityKey(member)) ? 'ready' : 'missing',
    })),
  };
};
