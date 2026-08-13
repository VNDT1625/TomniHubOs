import type {
  PackageContributionDiagnosticCode,
  PackageContributionState,
  PackageIdeActivityGroupId,
  PackageIdeSubtabContribution,
  RegisteredPackageContribution,
} from '@/common/packages';

export const IDE_EXTENSION_GROUP_IDS = [
  'codebase',
  'agent-ops',
] as const satisfies readonly PackageIdeActivityGroupId[];

export type IdeExtensionSubtab = RegisteredPackageContribution<PackageIdeSubtabContribution>;

export type IdeExtensionGroup = {
  id: PackageIdeActivityGroupId;
  subtabs: IdeExtensionSubtab[];
};

export type IdeExtensionDiagnosticSummary = {
  code: PackageContributionDiagnosticCode;
  count: number;
};

export type IdeExtensionsPresentation = {
  revision: number;
  groups: IdeExtensionGroup[];
  diagnostics: IdeExtensionDiagnosticSummary[];
  installedCount: number;
};

const compareSubtabs = (a: IdeExtensionSubtab, b: IdeExtensionSubtab): number =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
  a.title.localeCompare(b.title) ||
  a.key.localeCompare(b.key);

export const presentIdeExtensions = (state: PackageContributionState): IdeExtensionsPresentation => {
  const groups = IDE_EXTENSION_GROUP_IDS.map((id) => ({
    id,
    subtabs: state.snapshot.subtabs.filter((subtab) => subtab.activityGroupId === id).toSorted(compareSubtabs),
  }));
  const diagnosticCounts = new Map<PackageContributionDiagnosticCode, number>();
  for (const diagnostic of state.diagnostics) {
    diagnosticCounts.set(diagnostic.code, (diagnosticCounts.get(diagnostic.code) ?? 0) + 1);
  }
  return {
    revision: state.snapshot.revision,
    groups,
    diagnostics: [...diagnosticCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .toSorted((a, b) => a.code.localeCompare(b.code)),
    installedCount: new Set(state.snapshot.packageIds).size,
  };
};
