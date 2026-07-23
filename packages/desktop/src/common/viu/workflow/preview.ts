/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuProjectState } from '../types';
import { validateViuProject } from '../validation';
import type {
  CreateViuPreviewSnapshotInput,
  CreateViuTeamPreviewPackageInput,
  ViuPreviewSnapshot,
  ViuTeamPreviewPackage,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value as object, key));
    Object.freeze(value);
  }
  return value;
};

const stableJson = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const digestProject = (state: ViuProjectState): string => {
  let hash = 2_166_136_261;
  const serialized = stableJson(state);
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

/** Builds a frozen, versioned artifact for both the human and agent preview runtimes. */
export function createViuPreviewSnapshot(
  state: ViuProjectState,
  input: CreateViuPreviewSnapshotInput
): ViuPreviewSnapshot {
  if (!input.snapshotId.trim()) throw new Error('Snapshot id is required.');
  if (!Number.isFinite(input.createdAt)) throw new Error('Snapshot creation time must be finite.');
  if (!input.metadata.title.trim()) throw new Error('Snapshot title is required.');
  if (!input.metadata.createdBy.trim()) throw new Error('Snapshot creator is required.');

  const startScreen = state.screens[input.startScreenId];
  if (!startScreen) throw new Error(`Start screen ${input.startScreenId} does not exist.`);
  const diagnostics = validateViuProject(state);
  const blocking = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (blocking) throw new Error(`Cannot publish invalid VIU preview: ${blocking.message}`);

  const project = clone(state);
  const snapshot: ViuPreviewSnapshot = {
    snapshotId: input.snapshotId,
    formatVersion: 1,
    projectId: state.projectId,
    projectRevision: state.revision,
    createdAt: input.createdAt,
    startScreenId: startScreen.id,
    startRoute: startScreen.route,
    screenIds: state.screenOrder.filter((screenId) => Boolean(state.screens[screenId])),
    contentDigest: digestProject(project),
    metadata: clone(input.metadata),
    diagnostics: clone(diagnostics),
    project,
  };
  return deepFreeze(snapshot);
}

/** Wraps one immutable snapshot in a local Team share contract; it performs no network send. */
export function createViuTeamPreviewPackage(
  snapshot: ViuPreviewSnapshot,
  input: CreateViuTeamPreviewPackageInput
): ViuTeamPreviewPackage {
  if (!input.packageId.trim()) throw new Error('Preview package id is required.');
  if (!input.teamWorkspaceKey.trim()) throw new Error('Team workspace key is required.');
  if (!Number.isFinite(input.createdAt)) throw new Error('Preview package creation time must be finite.');

  return deepFreeze({
    packageId: input.packageId,
    version: 1 as const,
    createdAt: input.createdAt,
    teamWorkspaceKey: input.teamWorkspaceKey,
    ...(input.teamTaskId ? { teamTaskId: input.teamTaskId } : {}),
    access: 'team-test' as const,
    consumers: ['user-preview', 'agent-preview'] as const,
    snapshot,
  });
}
