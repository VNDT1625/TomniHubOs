/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { applyViuTransaction } from '../commands';
import type { ViuId, ViuProjectState, ViuTransactionResult } from '../types';
import type { ViuHistoryEntry, ViuHistoryJournal } from './types';

export type ViuHistoryExecution = {
  state: ViuProjectState;
  journal: ViuHistoryJournal;
  result: ViuTransactionResult | null;
  entry: ViuHistoryEntry | null;
};

/** Creates an immutable local history journal. */
export const createViuHistoryJournal = (limit = 100): ViuHistoryJournal => {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer.');
  return { past: [], future: [], limit };
};

/** Records one accepted committed result and clears the redo branch. */
export const recordViuHistory = (
  journal: ViuHistoryJournal,
  input: { transactionId: ViuId; summary: string; result: ViuTransactionResult }
): ViuHistoryJournal => {
  if (!input.result.accepted || input.result.normalizedCommands.length === 0) return journal;
  const entry: ViuHistoryEntry = {
    transactionId: input.transactionId,
    summary: input.summary,
    forwardCommands: structuredClone(input.result.normalizedCommands),
    inverseCommands: structuredClone(input.result.inverseCommands),
  };
  return {
    ...journal,
    past: [...journal.past, entry].slice(-journal.limit),
    future: [],
  };
};

const executeHistory = (
  state: ViuProjectState,
  journal: ViuHistoryJournal,
  transactionId: ViuId,
  direction: 'undo' | 'redo'
): ViuHistoryExecution => {
  const source = direction === 'undo' ? journal.past : journal.future;
  const entry = source.at(-1) ?? null;
  if (!entry) return { state, journal, result: null, entry: null };
  const commands = direction === 'undo' ? entry.inverseCommands : entry.forwardCommands;
  const result = applyViuTransaction(state, {
    transactionId,
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'viu-history', kind: 'system' },
    origin: 'inspector',
    commands: [...structuredClone(commands)],
    mode: 'commit',
    summary: `${direction}:${entry.summary}`,
  });
  if (!result.accepted) return { state, journal, result, entry };
  const nextJournal =
    direction === 'undo'
      ? {
          ...journal,
          past: journal.past.slice(0, -1),
          future: [...journal.future, entry],
        }
      : {
          ...journal,
          past: [...journal.past, entry].slice(-journal.limit),
          future: journal.future.slice(0, -1),
        };
  return { state: result.state, journal: nextJournal, result, entry };
};

/** Applies the latest inverse command batch as one new project revision. */
export const undoViuHistory = (
  state: ViuProjectState,
  journal: ViuHistoryJournal,
  transactionId: ViuId
): ViuHistoryExecution => executeHistory(state, journal, transactionId, 'undo');

/** Reapplies the latest undone command batch as one new project revision. */
export const redoViuHistory = (
  state: ViuProjectState,
  journal: ViuHistoryJournal,
  transactionId: ViuId
): ViuHistoryExecution => executeHistory(state, journal, transactionId, 'redo');
