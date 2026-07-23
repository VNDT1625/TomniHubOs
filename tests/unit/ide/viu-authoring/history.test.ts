/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { applyViuTransaction, createPremiumStarterProject } from '@/common/viu';
import {
  createTextContentViuBatch,
  createViuHistoryJournal,
  recordViuHistory,
  redoViuHistory,
  undoViuHistory,
} from '@/common/viu/authoring';
import type { ViuProjectState } from '@/common/viu';

const semanticDigest = (state: ViuProjectState): string => {
  const candidate = structuredClone(state);
  candidate.revision = 0;
  Object.values(candidate.nodes).forEach((node) => {
    node.version = 0;
  });
  return JSON.stringify(candidate);
};

const commitText = (state: ViuProjectState, value: string, transactionId: string) => {
  const batch = createTextContentViuBatch(state, { nodeIds: ['node-home-title'], anchorId: 'node-home-title' }, value);
  return applyViuTransaction(state, {
    transactionId,
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'history-user', kind: 'user' },
    origin: 'inspector',
    commands: [...batch.commands],
    mode: 'commit',
    summary: 'Edit title',
  });
};

describe('VIU authoring history journal', () => {
  it('undoes and redoes a committed authoring session as one history entry', () => {
    const initial = createPremiumStarterProject();
    const committed = commitText(initial, 'A single editing session', 'edit-1');
    expect(committed.accepted).toBe(true);
    let journal = recordViuHistory(createViuHistoryJournal(), {
      transactionId: 'edit-1',
      summary: 'Edit title',
      result: committed,
    });

    const undone = undoViuHistory(committed.state, journal, 'undo-1');
    journal = undone.journal;
    const redone = redoViuHistory(undone.state, journal, 'redo-1');

    expect(semanticDigest(undone.state)).toBe(semanticDigest(initial));
    expect(semanticDigest(redone.state)).toBe(semanticDigest(committed.state));
    expect(redone.journal.past).toHaveLength(1);
  });

  it('clears the redo branch after a new committed edit', () => {
    const initial = createPremiumStarterProject();
    const first = commitText(initial, 'First', 'edit-first');
    const recorded = recordViuHistory(createViuHistoryJournal(), {
      transactionId: 'edit-first',
      summary: 'First edit',
      result: first,
    });
    const undone = undoViuHistory(first.state, recorded, 'undo-first');
    const second = commitText(undone.state, 'Second', 'edit-second');
    const nextJournal = recordViuHistory(undone.journal, {
      transactionId: 'edit-second',
      summary: 'Second edit',
      result: second,
    });

    expect(nextJournal.future).toHaveLength(0);
    expect(nextJournal.past.at(-1)?.transactionId).toBe('edit-second');
  });

  it('does not record rejected or empty transactions', () => {
    const state = createPremiumStarterProject();
    const rejected = applyViuTransaction(state, {
      transactionId: 'stale',
      documentId: state.projectId,
      baseRevision: 999,
      actor: { id: 'history-user', kind: 'user' },
      origin: 'inspector',
      commands: [],
      mode: 'commit',
      summary: 'Stale edit',
    });
    const journal = createViuHistoryJournal();

    expect(recordViuHistory(journal, { transactionId: 'stale', summary: 'Stale edit', result: rejected })).toBe(
      journal
    );
  });
});
