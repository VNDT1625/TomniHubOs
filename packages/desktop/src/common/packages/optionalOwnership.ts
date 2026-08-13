import type { PackageManifest } from './types';

type PackageManifestIdentity = Pick<PackageManifest, 'id'>;

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

const isWithinPrefix = (value: string, prefix: string): boolean => value === prefix || value.startsWith(`${prefix}/`);

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

  return { owners: owners.toSorted((left, right) => left.packageId.localeCompare(right.packageId)) };
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
