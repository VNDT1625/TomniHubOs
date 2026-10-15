/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

export type OptimisticSend<Result> = Readonly<{
  /** The id the main process persists the user message under; the bubble is drawn with the same one. */
  userMessageId: string;
  showBubble: () => void;
  removeBubble: (messageId: string) => void;
  /** Work that must finish before sending but must never delay the bubble, such as a team warm-up. */
  beforeSend?: () => Promise<void>;
  send: (loadingId: string) => Promise<Result>;
}>;

/**
 * The person's message appears first. Everything slow (the chat pipeline, a model that is still starting, a
 * team warm-up) happens after it, and a failure takes the bubble back so the message can be sent again.
 */
export const sendWithOptimisticBubble = async <Result>(options: OptimisticSend<Result>): Promise<Result> => {
  options.showBubble();
  try {
    await options.beforeSend?.();
    return await options.send(options.userMessageId);
  } catch (error) {
    options.removeBubble(options.userMessageId);
    throw error;
  }
};
