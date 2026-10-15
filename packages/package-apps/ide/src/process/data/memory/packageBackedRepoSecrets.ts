/**
 * Lets the IDE's guarded commands use the keys in the IDE's own space in the app vault (and the general app keys the
 * person granted it), next to the keys it kept before the app vault existed.
 *
 * Package keys appear as combos: a set is a combo whose id is the vault handle and whose keys are its variable names.
 * Values are resolved in Main through the package's port and are only ever injected into a child process.
 */
import type { PackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';
import type { RepoSecretCombo, RepoSecretContext } from '@package-apps/ide/process/data/memory/repoSecretStore';

type LegacyRepoSecrets = {
  list: (repository: string) => Promise<RepoSecretContext[]>;
  listCombos: (repository: string) => Promise<RepoSecretCombo[]>;
  declare: (repository: string, alias: string, description: string) => Promise<RepoSecretContext>;
  resolveEnvironment: (repository: string, aliases: string[], comboIds?: string[]) => Promise<Record<string, string>>;
  redact: (text: string, values: Record<string, string>) => string;
};

const PACKAGE_HANDLE = /^secret:\/\//u;

export const createPackageBackedRepoSecrets = (
  legacy: LegacyRepoSecrets,
  port: PackageSecretPort
): LegacyRepoSecrets => {
  const packageCombos = async (): Promise<RepoSecretCombo[]> => {
    try {
      return (await port.list()).map((set) => ({
        comboId: set.handle,
        comboLabel: set.origin === 'granted' ? `${set.label} (app key granted to the IDE)` : set.label,
        description: set.note ?? '',
        keys: set.fields.map((field) => ({
          key: field,
          alias: field,
          status: 'set' as const,
          updatedAt: set.updatedAt,
        })),
        updatedAt: set.updatedAt,
      }));
    } catch {
      // The package space is optional; the older keys keep working without it.
      return [];
    }
  };

  return {
    list: (repository) => legacy.list(repository),
    declare: (repository, alias, description) => legacy.declare(repository, alias, description),
    redact: (text, values) => legacy.redact(text, values),
    listCombos: async (repository) => [...(await legacy.listCombos(repository)), ...(await packageCombos())],
    async resolveEnvironment(repository, aliases, comboIds = []) {
      const fromPackage = comboIds.filter((id) => PACKAGE_HANDLE.test(id));
      const fromLegacy = comboIds.filter((id) => !PACKAGE_HANDLE.test(id));
      const environment =
        aliases.length > 0 || fromLegacy.length > 0
          ? await legacy.resolveEnvironment(repository, aliases, fromLegacy)
          : {};
      if (fromPackage.length === 0) return environment;
      const known = new Map((await port.list()).map((set) => [set.handle, set]));
      for (const handle of fromPackage) {
        const set = known.get(handle);
        if (!set) throw new Error('Secret Context combo is unavailable for the IDE.');
        const values = await port.resolve(handle, set.fields);
        for (const [name, value] of Object.entries(values)) environment[name] = value;
      }
      return environment;
    },
  };
};
