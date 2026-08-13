/** Shared model-message contract for Hub targets and optional package adapters. */
export type ChatContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

/** One message passed to an OpenAI-compatible model target. */
export type ChatMessageInput = { role: string; content: ChatContent };

/** Provider-agnostic one-shot chat invocation with cooperative cancellation. */
export type AgentChat = (params: {
  model: string;
  messages: ChatMessageInput[];
  signal?: AbortSignal;
}) => Promise<string>;
