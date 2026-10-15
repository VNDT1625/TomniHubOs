/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Puts the context that pipeline stages gathered (retrieved documents and the like) in front of what the
 * model receives, inside an explicit block, while the visible user message stays unchanged.
 */
export const withPipelineContext = (
  modelInput: string | undefined,
  input: string,
  context: string | undefined
): string | undefined => {
  const trimmed = context?.trim();
  if (!trimmed) return modelInput;
  return `[Pipeline context]\n${trimmed}\n[/Pipeline context]\n\n${modelInput ?? input}`;
};
