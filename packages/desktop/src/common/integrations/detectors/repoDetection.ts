/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bridge between the repository classifier and the detectors (design sections 7 and 18, task T1.10). The
 * classifier still decides the legacy archetype; this module builds the connections and open items of the result by
 * running every registered detector over an inventory made from the classifier's input and merging the output with
 * what the classifier's own branches (skills, the MCP launch recipe, services) already produced. The classifier's
 * output enters as one more detector result, so the same dedupe, host-preference and coverage (criterion C2) rules
 * apply to it.
 *
 * The inventory holds only what the caller read: the file list, the root `package.json` and the snippets. A
 * declaration file the caller did not read has no text, so its detector sees the file name but cannot parse it.
 */

import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { MAX_CONNECTIONS, MAX_OPEN_ITEMS } from '@/common/packages/adapter/primitives';
import { detectors } from './index';
import { createInventory } from './inventory';
import { detectAll } from './merge';
import type { DetectionReport, Detector, DetectorResult, RepoInventory } from './types';

/** What the classifier's own branches produced; it takes part in the merge like a detector. */
export type ClassifierFindings = Readonly<{
  connections: readonly AdapterConnection[];
  openItems: readonly AdapterOpenItem[];
  /** Folders (relative, `''` is the root) the classifier recognized as agent skills. */
  skillRoots: readonly string[];
}>;

export type RepoDetectionInput = Readonly<{
  /** Repository-relative paths. */
  files: readonly string[];
  /** The root `package.json`, as text or as a parsed object. */
  packageJson?: Record<string, unknown> | string;
  /** Text of the files the caller read, by repository-relative path. */
  snippets: Readonly<Record<string, string>>;
  findings: ClassifierFindings;
}>;

export const CLASSIFIER_DETECTOR_ID = 'classifier';
const SKILL_FILE = /(?:^|\/)skill\.md$/iu;

const packageJsonText = (raw: RepoDetectionInput['packageJson']): string | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return undefined;
  }
};

/** Files the classifier's skill branch covered: every SKILL.md at or below a skill root. */
const skillFilesOf = (inventory: RepoInventory, roots: readonly string[]): string[] =>
  inventory.files.filter((file) => {
    if (!SKILL_FILE.test(file)) return false;
    const folder = file.slice(0, Math.max(0, file.length - 'SKILL.md'.length - 1));
    return roots.some((root) => root === '' || folder === root || folder.startsWith(`${root}/`));
  });

const classifierDetector = (findings: ClassifierFindings): Detector => ({
  id: CLASSIFIER_DETECTOR_ID,
  version: 1,
  detect: (inventory): DetectorResult => ({
    connections: findings.connections,
    openItems: findings.openItems,
    reasons: [],
    claimed: skillFilesOf(inventory, findings.skillRoots),
  }),
});

const buildInventory = (input: RepoDetectionInput): RepoInventory => {
  const rootPackage = packageJsonText(input.packageJson);
  return createInventory({
    files: input.files,
    readText: (path) => (path === 'package.json' && rootPackage !== undefined ? rootPackage : input.snippets[path]),
  });
};

type LaunchFacts = Readonly<{ command?: string; args?: readonly string[]; cwd?: string; url?: string }>;

const launchSignature = (connection: AdapterConnection): string | undefined => {
  if (connection.kind !== 'mcp') return undefined;
  const facts = connection as LaunchFacts;
  return JSON.stringify([facts.url ?? null, facts.command ?? null, facts.args ?? null, facts.cwd ?? null]);
};

/**
 * The classifier's launch recipe and the `mcp-published` detector read the same `package.json`, so they can name one
 * server twice under two ids. The classifier's connection keeps its id (it has been the id of the package so far);
 * a detector connection that starts exactly the same program is dropped. Servers that differ are never touched.
 */
const withoutRepeatedLaunch = (
  connections: readonly AdapterConnection[],
  classifierConnections: readonly AdapterConnection[]
): readonly AdapterConnection[] => {
  const owned = new Map<string, string>();
  for (const connection of classifierConnections) {
    const signature = launchSignature(connection);
    if (signature !== undefined && 'id' in connection) owned.set(signature, connection.id);
  }
  return connections.filter((connection) => {
    const signature = launchSignature(connection);
    const owner = signature === undefined ? undefined : owned.get(signature);
    return owner === undefined || !('id' in connection) || connection.id === owner;
  });
};

/**
 * Runs the registered detectors and merges them with the classifier's findings. The result never holds more than
 * `MAX_CONNECTIONS` connections or `MAX_OPEN_ITEMS` open items, the most an adapter document can carry; what is cut is
 * said in an open item. `detectors` lists the real detectors only (`<id>@<version>`), not the classifier.
 */
export const detectRepository = (input: RepoDetectionInput): DetectionReport => {
  const inventory = buildInventory(input);
  const merged = detectAll(inventory, [...detectors, classifierDetector(input.findings)]);
  const report = { ...merged, connections: withoutRepeatedLaunch(merged.connections, input.findings.connections) };
  const reportedDetectors = report.detectors.filter((entry) => !entry.startsWith(`${CLASSIFIER_DETECTOR_ID}@`));
  const tooManyConnections = report.connections.length > MAX_CONNECTIONS;
  const openItems: AdapterOpenItem[] = [
    ...(tooManyConnections
      ? [
          {
            kind: 'unrecognized' as const,
            note: `Repo có ${report.connections.length} kết nối; chỉ giữ ${MAX_CONNECTIONS} kết nối đầu tiên.`,
          },
        ]
      : []),
    ...report.openItems,
  ];
  return {
    ...report,
    detectors: reportedDetectors,
    connections: tooManyConnections ? report.connections.slice(0, MAX_CONNECTIONS) : report.connections,
    openItems: openItems.slice(0, MAX_OPEN_ITEMS),
  };
};
