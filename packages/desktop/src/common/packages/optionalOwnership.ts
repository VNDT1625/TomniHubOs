import type { PackageCatalogEntry, PackageManifest } from './types';

type PackageManifestIdentity = Pick<PackageManifest, 'id'>;

/**
 * Legacy source roots are resolved through a catalog module ID so the package
 * identity always comes from the signed/catalog manifest rather than a copied ID.
 */
export type OptionalPackageOwnershipCatalogRoot = Readonly<{
  moduleId: string;
  importPathPrefixes: readonly string[];
  artifactPathPrefixes: readonly string[];
}>;

/** Declares source and artifact paths that a downloadable package exclusively owns. */
export type OptionalPackageOwnershipDeclaration = {
  manifest: PackageManifestIdentity;
  importPathPrefixes: readonly string[];
  artifactPathPrefixes: readonly string[];
};

export type OptionalPackageOwnershipDenylist = Readonly<{
  owners: readonly OptionalPackageOwnershipOwner[];
}>;

type OptionalPackageOwnershipOwner = Readonly<{
  packageId: string;
  importPathPrefixes: readonly string[];
  artifactPathPrefixes: readonly string[];
}>;

export type OptionalOwnershipSourceFile = Readonly<{
  path: string;
  content: string;
}>;

export type OptionalOwnershipViolation = Readonly<{
  kind: 'core-imports-optional-package' | 'base-artifact-owns-optional-package';
  packageId: string;
  path: string;
  referencedPath: string;
}>;

export type OptionalOwnershipAuditInput = Readonly<{
  denylist: OptionalPackageOwnershipDenylist;
  coreSourceFiles: readonly OptionalOwnershipSourceFile[];
  baseArtifactInputs: readonly string[];
}>;

export type OptionalOwnershipAuditResult = Readonly<{
  violations: readonly OptionalOwnershipViolation[];
}>;

const STATIC_IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?[^;\n'"]*?\sfrom\s+(['"])([^'"]+)\1|\bimport\s+(['"])([^'"]+)\3/g;
const DYNAMIC_IMPORT_PATTERN = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

const normalizePath = (value: string): string => {
  const parts: string[] = [];
  for (const part of value.trim().replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
};

const isWithinPrefix = (value: string, prefix: string): boolean =>
  value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}.`);

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].toSorted();

const extractModuleSpecifiers = (content: string): string[] => {
  const specifiers: string[] = [];
  for (const match of content.matchAll(STATIC_IMPORT_PATTERN)) {
    const specifier = match[2] ?? match[4];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  for (const match of content.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    const specifier = match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return uniqueSorted(specifiers.map(normalizePath));
};

const findOwner = (
  owners: readonly OptionalPackageOwnershipOwner[],
  path: string,
  field: 'importPathPrefixes' | 'artifactPathPrefixes'
) => owners.find((owner) => owner[field].some((prefix) => isWithinPrefix(path, prefix)));

const assertNonOverlappingOwnership = (owners: readonly OptionalPackageOwnershipOwner[]): void => {
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index]!;
    for (const candidate of owners.slice(index + 1)) {
      for (const field of ['importPathPrefixes', 'artifactPathPrefixes'] as const) {
        for (const prefix of owner[field]) {
          if (candidate[field].some((other) => isWithinPrefix(prefix, other) || isWithinPrefix(other, prefix))) {
            throw new Error(
              `Optional package ownership prefixes overlap between ${owner.packageId} and ${candidate.packageId}.`
            );
          }
        }
      }
    }
  }
};

/**
 * Builds a fail-closed optional ownership denylist from package-manifest identities.
 * A future downloadable package becomes auditable by adding its own declaration;
 * the scanner never relies on hard-coded package IDs.
 */
export const createOptionalPackageOwnershipDenylist = (
  declarations: readonly OptionalPackageOwnershipDeclaration[]
): OptionalPackageOwnershipDenylist => {
  const packageIds = new Set<string>();
  const owners = declarations.map((declaration) => {
    const packageId = declaration.manifest.id.trim();
    const importPathPrefixes = uniqueSorted(declaration.importPathPrefixes.map(normalizePath).filter(Boolean));
    const artifactPathPrefixes = uniqueSorted(declaration.artifactPathPrefixes.map(normalizePath).filter(Boolean));

    if (!packageId || packageIds.has(packageId)) {
      throw new Error('Optional package ownership declarations must have unique manifest IDs.');
    }
    if (importPathPrefixes.length === 0 && artifactPathPrefixes.length === 0) {
      throw new Error(`Optional package ${packageId} must declare an import or artifact ownership prefix.`);
    }

    packageIds.add(packageId);
    return { packageId, importPathPrefixes, artifactPathPrefixes };
  });

  const sortedOwners = owners.toSorted((left, right) => left.packageId.localeCompare(right.packageId));
  assertNonOverlappingOwnership(sortedOwners);
  return { owners: sortedOwners };
};

/**
 * Generates ownership declarations from catalog manifest module identities.
 * Package-app source roots follow the published module ID convention; callers
 * supply explicit legacy roots until the source has physically moved.
 */
export const createOptionalPackageOwnershipDenylistFromCatalog = (
  catalog: readonly Pick<PackageCatalogEntry, 'manifest'>[],
  legacyRoots: readonly OptionalPackageOwnershipCatalogRoot[] = []
): OptionalPackageOwnershipDenylist => {
  const packageIdsByModule = new Map<string, string>();
  const declarations = catalog.map((entry) => ({
    manifest: entry.manifest,
    importPathPrefixes: entry.manifest.modules.map((module) => `@renderer/package-apps/${module.id}`),
    artifactPathPrefixes: entry.manifest.modules.map(
      (module) => `packages/desktop/src/renderer/package-apps/${module.id}`
    ),
  }));

  for (const entry of catalog) {
    for (const module of entry.manifest.modules) {
      const existingPackageId = packageIdsByModule.get(module.id);
      if (existingPackageId && existingPackageId !== entry.manifest.id) {
        throw new Error(`Catalog module ${module.id} belongs to more than one optional package.`);
      }
      packageIdsByModule.set(module.id, entry.manifest.id);
    }
  }

  for (const root of legacyRoots) {
    const packageId = packageIdsByModule.get(root.moduleId);
    if (!packageId) {
      throw new Error(`Legacy optional ownership root references unknown catalog module ${root.moduleId}.`);
    }
    const declaration = declarations.find((candidate) => candidate.manifest.id === packageId);
    if (!declaration) {
      throw new Error(`Catalog package ${packageId} has no ownership declaration.`);
    }
    declaration.importPathPrefixes = [...declaration.importPathPrefixes, ...root.importPathPrefixes];
    declaration.artifactPathPrefixes = [...declaration.artifactPathPrefixes, ...root.artifactPathPrefixes];
  }

  return createOptionalPackageOwnershipDenylist(declarations);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const collectGraphModulePaths = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

/**
 * Extracts source module paths from Vite/Rollup or esbuild-style graph metadata.
 * Invalid graph input rejects instead of silently producing an empty audit.
 */
export const collectBaseArtifactInputsFromGraph = (graph: unknown): readonly string[] => {
  if (!isRecord(graph)) throw new Error('Base artifact graph must be an object.');

  const paths = [
    ...collectGraphModulePaths(graph.inputs),
    ...collectGraphModulePaths(graph.modules),
    ...Object.values(isRecord(graph.outputs) ? graph.outputs : {}).flatMap((output) =>
      isRecord(output) ? collectGraphModulePaths(output.modules) : []
    ),
  ];
  const normalized = uniqueSorted(paths.map(normalizePath).filter(Boolean));
  if (normalized.length === 0) throw new Error('Base artifact graph must expose input or output module paths.');
  return normalized;
};

/** Scans core imports and base artifact inputs for paths owned by optional packages. */
export const scanOptionalPackageOwnership = ({
  denylist,
  coreSourceFiles,
  baseArtifactInputs,
}: OptionalOwnershipAuditInput): OptionalOwnershipAuditResult => {
  const violations: OptionalOwnershipViolation[] = [];

  for (const file of [...coreSourceFiles].toSorted((left, right) => left.path.localeCompare(right.path))) {
    for (const specifier of extractModuleSpecifiers(file.content)) {
      const owner = findOwner(denylist.owners, specifier, 'importPathPrefixes');
      if (owner) {
        violations.push({
          kind: 'core-imports-optional-package',
          packageId: owner.packageId,
          path: normalizePath(file.path),
          referencedPath: specifier,
        });
      }
    }
  }

  for (const artifactInput of uniqueSorted(baseArtifactInputs.map(normalizePath))) {
    const owner = findOwner(denylist.owners, artifactInput, 'artifactPathPrefixes');
    if (owner) {
      violations.push({
        kind: 'base-artifact-owns-optional-package',
        packageId: owner.packageId,
        path: artifactInput,
        referencedPath: artifactInput,
      });
    }
  }

  return {
    violations: violations.toSorted((left, right) =>
      `${left.kind}:${left.packageId}:${left.path}:${left.referencedPath}`.localeCompare(
        `${right.kind}:${right.packageId}:${right.path}:${right.referencedPath}`
      )
    ),
  };
};

/** Throws a stable audit failure that build and release gates can consume. */
export const assertOptionalPackageOwnershipClean = (result: OptionalOwnershipAuditResult): void => {
  if (result.violations.length === 0) return;
  const findings = result.violations
    .map((violation) => `${violation.kind}:${violation.packageId}:${violation.path}`)
    .join(', ');
  throw new Error(`Optional package ownership audit failed: ${findings}`);
};
