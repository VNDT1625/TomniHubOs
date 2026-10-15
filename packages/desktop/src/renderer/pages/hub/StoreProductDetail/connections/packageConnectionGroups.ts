/**
 * Grouping of one installed package's connections for the cluster view (docs/platform/repotopackage-design.md section 9.4,
 * "Giao diện theo cụm"). Pure: it only reads the display data Main sent and never decides what is on.
 */
import type { PackageConnectionView } from '@/common/types/platform/packageConnections';

/** Connections that cannot run on this machine, sharing one reason: shown as one note, not one warning per row. */
export type BlockedNote = Readonly<{ reason: string; items: readonly PackageConnectionView[] }>;

export type ConnectionGroup = Readonly<{
  kind: string;
  /** Every connection of this kind, in the order Main listed them. */
  items: readonly PackageConnectionView[];
  /** The connections that have their own row (everything that is not unsupported). */
  rows: readonly PackageConnectionView[];
  blocked: readonly BlockedNote[];
  enabledCount: number;
  /** Something is off and says why: the group opens by itself, otherwise it stays collapsed. */
  needsAttention: boolean;
}>;

const KIND_LABELS: Readonly<Record<string, string>> = { mcp: 'MCP', cli: 'CLI' };

/** The label a kind has in the summary line. Technical kind names are kept as they are, as the design names them. */
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

const hasRunsCode = (group: ConnectionGroup): boolean => group.items.some((item) => item.runsCode);

/** Groups by kind: code-running kinds first, then data kinds; within each, the order in which the kinds first appear. */
export const groupByKind = (items: readonly PackageConnectionView[]): readonly ConnectionGroup[] => {
  const byKind = new Map<string, PackageConnectionView[]>();
  for (const item of items) byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
  const groups = [...byKind].map(([kind, members]) => {
    const byReason = new Map<string, PackageConnectionView[]>();
    for (const item of members.filter((candidate) => candidate.status === 'unsupported')) {
      const reason = item.reason ?? '';
      byReason.set(reason, [...(byReason.get(reason) ?? []), item]);
    }
    return {
      kind,
      items: members,
      rows: members.filter((item) => item.status !== 'unsupported'),
      blocked: [...byReason].map(([reason, grouped]) => ({ reason, items: grouped })),
      enabledCount: members.filter((item) => item.enabled).length,
      needsAttention: members.some(
        (item) => !item.enabled && (item.reason !== undefined || item.lastError !== undefined)
      ),
    };
  });
  return [...groups.filter(hasRunsCode), ...groups.filter((group) => !hasRunsCode(group))];
};

/** The summary line of the package, e.g. `1 MCP · 14 hook · 8 skill · 10 rules · 1 CLI`. */
export const kindSummary = (groups: readonly ConnectionGroup[]): string =>
  groups.map((group) => `${group.items.length} ${kindLabel(group.kind)}`).join(' · ');
