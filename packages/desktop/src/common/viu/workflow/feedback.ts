/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuId } from '../types';
import type { CreateViuPreviewFeedbackInput, ViuPreviewFeedbackEvent, ViuPreviewSnapshot } from './types';

const clone = <T>(value: T): T => structuredClone(value);

const nodeBelongsToScreen = (snapshot: ViuPreviewSnapshot, nodeId: ViuId, screenId: ViuId): boolean => {
  const screen = snapshot.project.screens[screenId];
  if (!screen) return false;
  const pending = [screen.rootNodeId];
  const visited = new Set<ViuId>();
  while (pending.length > 0) {
    const currentId = pending.pop();
    if (!currentId || visited.has(currentId)) continue;
    if (currentId === nodeId) return true;
    visited.add(currentId);
    pending.push(...(snapshot.project.nodes[currentId]?.childIds ?? []));
  }
  return false;
};

/**
 * Appends a tester observation without mutating or replacing existing events.
 * Anchors are checked against the exact immutable snapshot being reviewed.
 */
export function appendViuPreviewFeedback(
  events: readonly ViuPreviewFeedbackEvent[],
  snapshot: ViuPreviewSnapshot,
  input: CreateViuPreviewFeedbackInput
): readonly ViuPreviewFeedbackEvent[] {
  if (!input.feedbackId.trim()) throw new Error('Feedback id is required.');
  if (events.some((event) => event.feedbackId === input.feedbackId)) {
    throw new Error(`Feedback ${input.feedbackId} already exists.`);
  }
  if (!input.authorId.trim()) throw new Error('Feedback author is required.');
  if (!input.body.trim()) throw new Error('Feedback body is required.');
  if (!Number.isFinite(input.createdAt)) throw new Error('Feedback creation time must be finite.');
  if (input.screenId && !snapshot.project.screens[input.screenId]) {
    throw new Error(`Feedback screen ${input.screenId} does not exist in snapshot ${snapshot.snapshotId}.`);
  }
  if (input.nodeId && !input.screenId) throw new Error('Node feedback must include its screen.');
  if (input.nodeId && input.screenId && !nodeBelongsToScreen(snapshot, input.nodeId, input.screenId)) {
    throw new Error(`Feedback node ${input.nodeId} does not belong to screen ${input.screenId}.`);
  }

  const event: ViuPreviewFeedbackEvent = Object.freeze({
    ...clone(input),
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.projectRevision,
  });
  return Object.freeze([...events, event]);
}
