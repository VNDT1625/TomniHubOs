/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure rules for an assistant's example prompts. The editor and the save path both use these, so the caps hold
 * whatever the UI state is: at most `ASSISTANT_LIMITS.promptMax` entries, each at most `promptLength` characters.
 */

import { ASSISTANT_LIMITS } from './assistantSchema';

/** Trims each prompt, drops empty ones, cuts overlong text and keeps at most the allowed count. */
export const normalizePrompts = (prompts: readonly string[]): string[] =>
  prompts
    .map((prompt) => prompt.trim().slice(0, ASSISTANT_LIMITS.promptLength))
    .filter((prompt) => prompt.length > 0)
    .slice(0, ASSISTANT_LIMITS.promptMax);

/** True when another prompt line may be added. */
export const canAddPrompt = (prompts: readonly string[]): boolean => prompts.length < ASSISTANT_LIMITS.promptMax;

/** Returns a new list with an empty line appended, or the same list when the cap is reached. */
export const addPromptLine = (prompts: readonly string[]): string[] =>
  canAddPrompt(prompts) ? [...prompts, ''] : [...prompts];

/** Returns a new list with the line at `index` replaced; out-of-range indexes change nothing. */
export const updatePromptLine = (prompts: readonly string[], index: number, value: string): string[] =>
  prompts.map((prompt, position) => (position === index ? value.slice(0, ASSISTANT_LIMITS.promptLength) : prompt));

/** Returns a new list without the line at `index`. */
export const removePromptLine = (prompts: readonly string[], index: number): string[] =>
  prompts.filter((_prompt, position) => position !== index);
