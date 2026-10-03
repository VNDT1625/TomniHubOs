/**
 * Durable, main-process-only storage for user-created package app groups.
 *
 * Package manifests remain publisher-owned and signed. This state instead
 * records a user's composition of installed applications, scoped either to the
 * local user or to one opaque workspace key.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PACKAGE_APP_GROUP_SCHEMA_VERSION,
  parsePackageAppGroupCreateRequest,
  parsePackageAppGroupDocument,
  parsePackageAppGroupReadRequest,
  parsePackageAppGroupRemoveRequest,
  parsePackageAppGroupRenameRequest,
  parsePackageAppGroupReorderRequest,
  type PackageAppGroupCreateRequest,
  type PackageAppGroupDocument,
  type PackageAppGroupReadRequest,
  type PackageAppGroupRemoveRequest,
  type PackageAppGroupRenameRequest,
  type PackageAppGroupReorderRequest,
  type PackageAppGroupScope,
} from '@/common/packages';

type PackageAppGroupStateDocument = {
  schemaVersion: typeof PACKAGE_APP_GROUP_SCHEMA_VERSION;
  user: PackageAppGroupDocument;
  workspaces: Record<string, PackageAppGroupDocument>;
};

const MAX_WORKSPACE_SCOPES = 1_000;

type PackageAppGroupServiceOptions = {
  filePath: string;
  randomId?: () => string;
};

export type PackageAppGroupService = {
  initialize: () => Promise<void>;
  read: (request: PackageAppGroupReadRequest) => Promise<PackageAppGroupDocument>;
  create: (request: PackageAppGroupCreateRequest) => Promise<PackageAppGroupDocument>;
  rename: (request: PackageAppGroupRenameRequest) => Promise<PackageAppGroupDocument>;
  reorder: (request: PackageAppGroupReorderRequest) => Promise<PackageAppGroupDocument>;
  remove: (request: PackageAppGroupRemoveRequest) => Promise<PackageAppGroupDocument>;
};

export class PackageAppGroupServiceError extends Error {
  public constructor(
    readonly code: 'APP_GROUP_NOT_FOUND' | 'APP_GROUP_ORDER_INVALID' | 'APP_GROUP_ID_CONFLICT' | 'APP_GROUP_SCOPE_LIMIT'
  ) {
    super(code);
    this.name = 'PackageAppGroupServiceError';
  }
}

const clone = <T>(value: T): T => structuredClone(value);

const emptyDocument = (): PackageAppGroupDocument => ({
  schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION,
  groups: [],
});

const emptyState = (): PackageAppGroupStateDocument => ({
  schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION,
  user: emptyDocument(),
  workspaces: Object.create(null) as Record<string, PackageAppGroupDocument>,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (record: Record<string, unknown>, expectedKeys: readonly string[]): boolean => {
  const actual = Object.keys(record).toSorted();
  const expected = [...expectedKeys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const parseStateDocument = (value: unknown): PackageAppGroupStateDocument => {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'user', 'workspaces'])) {
    throw new Error('Invalid package app group state.');
  }
  if (value.schemaVersion !== PACKAGE_APP_GROUP_SCHEMA_VERSION || !isRecord(value.workspaces)) {
    throw new Error('Unsupported package app group state.');
  }

  const workspaces = Object.create(null) as Record<string, PackageAppGroupDocument>;
  if (Object.keys(value.workspaces).length > MAX_WORKSPACE_SCOPES) {
    throw new Error('Package app group workspace scope limit exceeded.');
  }
  for (const [workspaceId, document] of Object.entries(value.workspaces)) {
    parsePackageAppGroupReadRequest({ scope: { kind: 'workspace', workspaceId } });
    workspaces[workspaceId] = parsePackageAppGroupDocument(document);
  }
  return {
    schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION,
    user: parsePackageAppGroupDocument(value.user),
    workspaces,
  };
};

const documentForScope = (
  state: PackageAppGroupStateDocument,
  scope: PackageAppGroupScope,
  createIfMissing: boolean
): PackageAppGroupDocument => {
  if (scope.kind === 'user') return state.user;
  const existing = Object.hasOwn(state.workspaces, scope.workspaceId) ? state.workspaces[scope.workspaceId] : undefined;
  if (existing) return existing;
  if (!createIfMissing) return emptyDocument();
  const document = emptyDocument();
  state.workspaces[scope.workspaceId] = document;
  return document;
};

/**
 * Atomic local state storage. Invalid on-disk data is quarantined before an
 * empty document is created, so malformed state is never treated as trusted.
 */
class JsonPackageAppGroupStore {
  private readonly randomId: () => string;
  private state = emptyState();
  private initialization: Promise<void> | undefined;
  private mutations: Promise<void> = Promise.resolve();

  public constructor(
    private readonly filePath: string,
    randomId: (() => string) | undefined
  ) {
    this.randomId = randomId ?? randomUUID;
  }

  public async initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }

  public async read(scope: PackageAppGroupScope): Promise<PackageAppGroupDocument> {
    await this.initialize();
    await this.mutations;
    return clone(documentForScope(this.state, scope, false));
  }

  public async mutate(
    scope: PackageAppGroupScope,
    mutation: (document: PackageAppGroupDocument) => PackageAppGroupDocument
  ): Promise<PackageAppGroupDocument> {
    await this.initialize();
    const operation = this.mutations.then(async () => {
      const nextState = clone(this.state);
      if (
        scope.kind === 'workspace' &&
        !Object.hasOwn(nextState.workspaces, scope.workspaceId) &&
        Object.keys(nextState.workspaces).length >= MAX_WORKSPACE_SCOPES
      ) {
        throw new PackageAppGroupServiceError('APP_GROUP_SCOPE_LIMIT');
      }
      const nextDocument = mutation(clone(documentForScope(nextState, scope, true)));
      const checkedDocument = parsePackageAppGroupDocument(nextDocument);
      if (scope.kind === 'user') nextState.user = checkedDocument;
      else nextState.workspaces[scope.workspaceId] = checkedDocument;
      await this.write(nextState);
      this.state = nextState;
      return clone(checkedDocument);
    });
    this.mutations = operation.then(
      (): void => undefined,
      (): void => undefined
    );
    return operation;
  }

  private async load(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const serialized = await readFile(this.filePath, 'utf8');
      try {
        this.state = parseStateDocument(JSON.parse(serialized) as unknown);
      } catch {
        const recoveryPath = `${this.filePath}.corrupt-${Date.now()}-${this.randomId()}`;
        await rename(this.filePath, recoveryPath);
        this.state = emptyState();
        await this.write(this.state);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      this.state = emptyState();
      await this.write(this.state);
    }
  }

  private async write(state: PackageAppGroupStateDocument): Promise<void> {
    const temporaryPath = `${this.filePath}.${this.randomId()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch((): undefined => undefined);
      throw error;
    }
  }
}

const groupId = (randomId: () => string): string => `group-${randomId()}`;

/** Creates a main-process service with no renderer or package-manager dependency. */
export const createPackageAppGroupService = ({
  filePath,
  randomId,
}: PackageAppGroupServiceOptions): PackageAppGroupService => {
  const store = new JsonPackageAppGroupStore(filePath, randomId);
  const nextId = randomId ?? randomUUID;

  return {
    initialize: () => store.initialize(),
    read: async (input) => {
      const request = parsePackageAppGroupReadRequest(input);
      return store.read(request.scope);
    },
    create: async (input) => {
      const request = parsePackageAppGroupCreateRequest(input);
      return store.mutate(request.scope, (document) => {
        const id = groupId(nextId);
        if (document.groups.some((group) => group.id === id)) {
          throw new PackageAppGroupServiceError('APP_GROUP_ID_CONFLICT');
        }
        return {
          schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION,
          groups: [...document.groups, { id, name: request.name, members: request.members }],
        };
      });
    },
    rename: async (input) => {
      const request = parsePackageAppGroupRenameRequest(input);
      return store.mutate(request.scope, (document) => {
        let found = false;
        const groups = document.groups.map((group) => {
          if (group.id !== request.groupId) return group;
          found = true;
          return { ...group, name: request.name };
        });
        if (!found) throw new PackageAppGroupServiceError('APP_GROUP_NOT_FOUND');
        return { schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION, groups };
      });
    },
    reorder: async (input) => {
      const request = parsePackageAppGroupReorderRequest(input);
      return store.mutate(request.scope, (document) => {
        const knownGroups = new Map(document.groups.map((group) => [group.id, group]));
        if (request.groupIds.length !== document.groups.length || request.groupIds.some((id) => !knownGroups.has(id))) {
          throw new PackageAppGroupServiceError('APP_GROUP_ORDER_INVALID');
        }
        return {
          schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION,
          groups: request.groupIds.map((id) => knownGroups.get(id)!),
        };
      });
    },
    remove: async (input) => {
      const request = parsePackageAppGroupRemoveRequest(input);
      return store.mutate(request.scope, (document) => {
        const groups = document.groups.filter((group) => group.id !== request.groupId);
        if (groups.length === document.groups.length) throw new PackageAppGroupServiceError('APP_GROUP_NOT_FOUND');
        return { schemaVersion: PACKAGE_APP_GROUP_SCHEMA_VERSION, groups };
      });
    },
  };
};
