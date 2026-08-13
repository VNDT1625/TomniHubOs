/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuProjectState } from '../types';
import { appendViuPreviewFeedback } from './feedback';
import { createViuPreviewSnapshot, createViuTeamPreviewPackage } from './preview';
import type {
  CreateViuPreviewFeedbackInput,
  CreateViuPreviewSnapshotInput,
  CreateViuTeamPreviewPackageInput,
  ViuPreviewFeedbackEvent,
  ViuTeamPreviewPackage,
} from './types';

export type ViuPreCodeReviewArchive = {
  version: 1;
  packages: readonly ViuTeamPreviewPackage[];
  feedback: Readonly<Record<string, readonly ViuPreviewFeedbackEvent[]>>;
};

export type ViuPreCodeReviewService = {
  publish: (
    state: ViuProjectState,
    snapshot: CreateViuPreviewSnapshotInput,
    share: CreateViuTeamPreviewPackageInput
  ) => ViuTeamPreviewPackage;
  open: (packageId: string, consumer: 'user-preview' | 'agent-preview') => ViuTeamPreviewPackage;
  listTeamPackages: (teamWorkspaceKey: string) => readonly ViuTeamPreviewPackage[];
  appendFeedback: (packageId: string, input: CreateViuPreviewFeedbackInput) => ViuPreviewFeedbackEvent;
  listFeedback: (packageId: string) => readonly ViuPreviewFeedbackEvent[];
  exportArchive: () => ViuPreCodeReviewArchive;
};

/**
 * Local registry behind the future Team bridge. It stores only frozen preview
 * packages and append-only feedback; no network or live-collaboration side effects.
 */
export function createViuPreCodeReviewService(seed?: ViuPreCodeReviewArchive): ViuPreCodeReviewService {
  const packages = new Map<string, ViuTeamPreviewPackage>();
  const feedback = new Map<string, readonly ViuPreviewFeedbackEvent[]>();

  for (const persisted of seed?.packages ?? []) {
    const rebuiltSnapshot = createViuPreviewSnapshot(persisted.snapshot.project, {
      snapshotId: persisted.snapshot.snapshotId,
      createdAt: persisted.snapshot.createdAt,
      startScreenId: persisted.snapshot.startScreenId,
      metadata: persisted.snapshot.metadata,
    });
    if (rebuiltSnapshot.contentDigest !== persisted.snapshot.contentDigest) {
      throw new Error(`Preview package ${persisted.packageId} failed its content digest check.`);
    }
    const rebuiltPackage = createViuTeamPreviewPackage(rebuiltSnapshot, {
      packageId: persisted.packageId,
      createdAt: persisted.createdAt,
      teamWorkspaceKey: persisted.teamWorkspaceKey,
      ...(persisted.teamTaskId ? { teamTaskId: persisted.teamTaskId } : {}),
    });
    if (packages.has(rebuiltPackage.packageId)) {
      throw new Error(`Preview package ${rebuiltPackage.packageId} is duplicated in the archive.`);
    }
    packages.set(rebuiltPackage.packageId, rebuiltPackage);
    let events: readonly ViuPreviewFeedbackEvent[] = Object.freeze([]);
    for (const event of seed?.feedback[persisted.packageId] ?? []) {
      events = appendViuPreviewFeedback(events, rebuiltSnapshot, event);
    }
    feedback.set(rebuiltPackage.packageId, events);
  }

  const requirePackage = (packageId: string): ViuTeamPreviewPackage => {
    const item = packages.get(packageId);
    if (!item) throw new Error(`Preview package ${packageId} does not exist.`);
    return item;
  };

  return {
    publish: (state, snapshotInput, shareInput) => {
      if (packages.has(shareInput.packageId)) {
        throw new Error(`Preview package ${shareInput.packageId} already exists.`);
      }
      const snapshot = createViuPreviewSnapshot(state, snapshotInput);
      const item = createViuTeamPreviewPackage(snapshot, shareInput);
      packages.set(item.packageId, item);
      feedback.set(item.packageId, Object.freeze([]));
      return item;
    },
    open: (packageId, consumer) => {
      const item = requirePackage(packageId);
      if (!item.consumers.includes(consumer)) throw new Error(`Consumer ${consumer} cannot open this preview.`);
      return item;
    },
    listTeamPackages: (teamWorkspaceKey) =>
      Object.freeze([...packages.values()].filter((item) => item.teamWorkspaceKey === teamWorkspaceKey)),
    appendFeedback: (packageId, input) => {
      const item = requirePackage(packageId);
      const next = appendViuPreviewFeedback(feedback.get(packageId) ?? [], item.snapshot, input);
      feedback.set(packageId, next);
      return next[next.length - 1]!;
    },
    listFeedback: (packageId) => {
      requirePackage(packageId);
      return feedback.get(packageId) ?? Object.freeze([]);
    },
    exportArchive: () => {
      const feedbackRecord: Record<string, readonly ViuPreviewFeedbackEvent[]> = {};
      for (const [packageId, events] of feedback) feedbackRecord[packageId] = structuredClone(events);
      return Object.freeze({
        version: 1 as const,
        packages: Object.freeze(structuredClone([...packages.values()])),
        feedback: Object.freeze(feedbackRecord),
      });
    },
  };
}
