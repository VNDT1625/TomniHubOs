/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

import { inspectOutboundText } from '@process/services/security';
import type { LayaPredictor } from '@process/services/security/layaSemanticEgressModel';
import {
  createTurnNotePolicy,
  TURN_WORTH_QUESTION,
  type NoteSanitizer,
  type TurnNotePolicy,
  type TurnWorthModel,
} from './turnNotes';

/**
 * Laya may still be loading when a turn ends (the first start takes tens of seconds). The end of a turn must not
 * wait for it, so the heuristic decides whenever the model is not quick enough.
 */
export const WORTH_MODEL_TIMEOUT_MS = 1_500;

const MAX_USER_FOR_MODEL = 600;
const MAX_ASSISTANT_FOR_MODEL = 1_200;

/** Strips secrets from a note with the same scanner the send step uses. Undefined means do not store it. */
export const sanitizeNoteText: NoteSanitizer = async (text) => {
  const inspection = await inspectOutboundText(
    {
      schemaVersion: 1,
      requestId: `session-note:${randomUUID()}`,
      actorId: 'local-user',
      surface: 'chat',
      target: { kind: 'session-memory', id: 'save' },
      parts: [{ id: 'note', text, role: 'metadata', source: 'generated' }],
      requestedCapability: 'session.note.store',
      sensitivity: 'normal',
    },
    { allowSanitize: true, requireApprovalForFindings: false, policyVersion: 'session-note-v1' }
  );
  if (inspection.decision !== 'allow' && inspection.decision !== 'sanitize') return undefined;
  return inspection.safeParts.find((part) => part.id === 'note')?.text;
};

/** Laya's opinion on whether an exchange settles something worth remembering. */
export const createLayaWorthModel =
  (predictor: LayaPredictor, timeoutMs = WORTH_MODEL_TIMEOUT_MS): TurnWorthModel =>
  async (input) => {
    const body = `${input.userText.slice(0, MAX_USER_FOR_MODEL)}\n---\n${input.assistantText.slice(0, MAX_ASSISTANT_FOR_MODEL)}`;
    const result = await predictor({ body }, { worth: TURN_WORTH_QUESTION }, AbortSignal.timeout(timeoutMs));
    const answer = result.answers.worth;
    return answer && 'noul' in answer && Number.isFinite(answer.noul)
      ? Math.min(1, Math.max(0, answer.noul))
      : undefined;
  };

export const createProductionTurnNotePolicy = (predictor: LayaPredictor): TurnNotePolicy =>
  createTurnNotePolicy({ sanitize: sanitizeNoteText, worthModel: createLayaWorthModel(predictor) });
