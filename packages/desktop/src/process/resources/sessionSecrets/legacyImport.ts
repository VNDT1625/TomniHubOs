import {
  recoverSecretSource,
  stableSecretRecoveryHandle,
  type SecretRecoveryReport,
  type SecretRecoverySnapshot,
  type SecretVault,
} from '@process/agentRuntime/secretVault';

/** Lazily reads keys a package kept in its own storage before the app vault existed. Values stay in Main. */
export type LegacySecretSource = () => Promise<SecretRecoverySnapshot>;

/** The package-scoped, repeatable identity of a legacy record, so importing twice never duplicates a set. */
const packageSourceId = (packageId: string, sourceId: string): string => `package:${packageId}\0${sourceId}`;

const intoPackageScope = (packageId: string, load: LegacySecretSource): LegacySecretSource => {
  return async () => {
    const snapshot = await load();
    return {
      ...snapshot,
      candidates: snapshot.candidates.map((candidate) => ({
        ...candidate,
        sourceId: packageSourceId(packageId, candidate.sourceId),
        input: { ...candidate.input, scope: { kind: 'package', packageId } },
      })),
    };
  };
};

/** How many legacy records are not in the app vault yet. Counts only; nothing about them leaves Main. */
export const countPendingLegacySecrets = async (
  vault: Pick<SecretVault, 'list'>,
  packageId: string,
  load: LegacySecretSource
): Promise<number> => {
  const [snapshot, known] = await Promise.all([load(), vault.list()]);
  const handles = new Set(known.map((item) => item.handle));
  return snapshot.candidates.filter(
    (candidate) => !handles.has(stableSecretRecoveryHandle(packageSourceId(packageId, candidate.sourceId)))
  ).length;
};

/**
 * Copies the legacy records into the package's own scope in the app vault. The source is left untouched, existing
 * sets are never overwritten, and the report carries counts only.
 */
export const importLegacySecrets = (
  vault: SecretVault,
  packageId: string,
  load: LegacySecretSource
): Promise<SecretRecoveryReport> => recoverSecretSource(vault, intoPackageScope(packageId, load));
