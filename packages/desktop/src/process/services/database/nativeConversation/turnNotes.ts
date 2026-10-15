/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session notes. The model never receives the whole conversation: every completed turn is judged, and the
 * ones worth remembering become a short note in the session Save. Notes are extracted, never generated, so
 * they cannot invent anything, and each carries the id of the message it came from so the original can be
 * read back.
 */

export type TurnNoteInput = Readonly<{
  /** Id of the assistant message, kept in the note so the full text can be fetched later. */
  messageId: string;
  userText: string;
  assistantText: string;
  state: 'finish' | 'stopped' | 'error';
}>;

/** Optional model opinion on a turn, 0..1. Returns undefined when no model is available. */
export type TurnWorthModel = (input: TurnNoteInput) => Promise<number | undefined>;

/** Cleans a note before it is stored. Returns undefined when the note must not be stored at all. */
export type NoteSanitizer = (text: string) => Promise<string | undefined>;

export type TurnNotePolicy = Readonly<{
  /** The note to store for this turn, or undefined when the turn is not worth remembering. */
  noteFor: (input: TurnNoteInput) => Promise<string | undefined>;
  /** A note of what was asked when the turn ended without an answer, so a later "continue" can pick it up. */
  unfinishedFor: (input: TurnNoteInput) => Promise<string | undefined>;
  /** Cleans any text headed for the Save, for example an action capsule. */
  sanitize: NoteSanitizer;
}>;

/** A turn scoring below this is not stored. */
export const MIN_NOTE_WORTH = 0.35;

const MAX_USER_CHARS = 400;
const MAX_ASSISTANT_CHARS = 700;

const GREETING =
  /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|oke|sure|chào|xin chào|cảm ơn|cám ơn|được rồi|ừ|ờ)\b/iu;
const PATH =
  /(?:[\w.-]+[\\/])+[\w.-]+\.[a-z0-9]{1,6}\b|\b[\w-]+\.(?:ts|tsx|js|jsx|rs|py|json|md|css|yml|yaml|toml)\b/iu;
const CUE =
  /\b(always|never|must|must not|should not|do not|don't|decided|decision|plan|todo|remember|constraint|requirement)\b|luôn|đừng|không được|phải|quyết định|kế hoạch|ghi nhớ|yêu cầu|ràng buộc/iu;
const FENCE = /```[\s\S]*?```/gu;

const words = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length;

const clip = (text: string, maxChars: number): string => {
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  return flat.length <= maxChars ? flat : `${flat.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

/**
 * Deterministic worth of a turn, 0..1. It is the floor when no model is available and the prior when one is:
 * code, file paths, decisions and constraints raise it; greetings and one-line replies keep it near zero.
 */
export const scoreTurnWorth = (input: Pick<TurnNoteInput, 'userText' | 'assistantText'>): number => {
  const user = input.userText.trim();
  const assistant = input.assistantText.trim();
  if (!assistant) return 0;
  const hasStructure = PATH.test(assistant) || PATH.test(user) || assistant.includes('```');
  if (!hasStructure && words(user) <= 4 && assistant.length < 200) return GREETING.test(user) ? 0 : 0.1;

  let score = 0;
  if (assistant.includes('```') || (assistant.match(/`[^`\n]+`/gu)?.length ?? 0) >= 2) score += 0.25;
  if (PATH.test(assistant) || PATH.test(user)) score += 0.25;
  if (CUE.test(user) || CUE.test(assistant)) score += 0.2;
  if (assistant.length > 600) score += 0.2;
  if (user.length > 200) score += 0.15;
  if (/^\s*\d+[.)]\s/mu.test(assistant)) score += 0.1;
  return Math.min(1, score);
};

const sentences = (text: string): string[] =>
  text
    .replaceAll(FENCE, ' [code block] ')
    .split(/(?<=[.!?。])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);

/** First sentences plus every later sentence that names a file, code, decision or constraint, in order. */
const extractAssistant = (text: string, maxChars: number): string => {
  const all = sentences(text);
  const chosen = new Set<number>([0, 1].filter((index) => index < all.length));
  all.forEach((sentence, index) => {
    if (PATH.test(sentence) || CUE.test(sentence) || /`[^`\n]+`/u.test(sentence)) chosen.add(index);
  });
  const picked: string[] = [];
  let used = 0;
  for (const index of [...chosen].toSorted((a, b) => a - b)) {
    const sentence = all[index];
    if (used + sentence.length + 1 > maxChars) {
      if (picked.length === 0) picked.push(clip(sentence, maxChars));
      break;
    }
    picked.push(sentence);
    used += sentence.length + 1;
  }
  return picked.join(' ');
};

/** The note text for one turn. */
export const buildTurnNote = (input: TurnNoteInput): string =>
  [
    `Turn note [msg:${input.messageId}]`,
    `User: ${clip(input.userText, MAX_USER_CHARS)}`,
    `Assistant: ${extractAssistant(input.assistantText, MAX_ASSISTANT_CHARS)}`,
  ].join('\n');

/** The host's own automatic resume instruction says nothing about the task. */
const RESUME_INSTRUCTION = /tiếp tục công việc đang dở|continue the unfinished work/iu;
const MIN_UNFINISHED_REQUEST_CHARS = 8;

/** What was asked and how far the answer got, for a turn that ended before it finished. */
export const buildUnfinishedNote = (input: TurnNoteInput): string => {
  const progress = extractAssistant(input.assistantText, MAX_ASSISTANT_CHARS);
  return [
    `Unfinished request [msg:${input.messageId}]`,
    `User: ${clip(input.userText, MAX_USER_CHARS)}`,
    `Progress: ${progress || 'none before it stopped'}`,
  ].join('\n');
};

export type TurnNotePolicyOptions = Readonly<{
  sanitize: NoteSanitizer;
  /** Model opinion. When present it outweighs the heuristic; when it returns nothing the heuristic decides. */
  worthModel?: TurnWorthModel;
  minWorth?: number;
}>;

export const createTurnNotePolicy = (options: TurnNotePolicyOptions): TurnNotePolicy => {
  const minWorth = options.minWorth ?? MIN_NOTE_WORTH;
  return {
    sanitize: options.sanitize,
    unfinishedFor: async (input) => {
      if (input.state === 'finish') return undefined;
      const request = input.userText.trim();
      if (request.length < MIN_UNFINISHED_REQUEST_CHARS || RESUME_INSTRUCTION.test(request)) return undefined;
      return options.sanitize(buildUnfinishedNote(input));
    },
    noteFor: async (input) => {
      // A failed or stopped turn answered nothing; the next turn starts from what was actually settled.
      if (input.state !== 'finish' || !input.assistantText.trim()) return undefined;
      const heuristic = scoreTurnWorth(input);
      let opinion: number | undefined;
      try {
        opinion = await options.worthModel?.(input);
      } catch {
        opinion = undefined;
      }
      const worth = opinion === undefined ? heuristic : 0.4 * heuristic + 0.6 * opinion;
      if (worth < minWorth) return undefined;
      return options.sanitize(buildTurnNote(input));
    },
  };
};

/** The Laya question behind {@link TurnWorthModel}: one yes/no about the exchange. */
export const TURN_WORTH_QUESTION = Object.freeze({
  type: 'noul' as const,
  instructions:
    'Does this exchange settle a decision, constraint, fact, file, plan or unresolved problem that must be remembered for later turns, as opposed to a greeting, thanks or small talk?',
});
