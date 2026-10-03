/**
 * Local OpenAI-compatible engine adapter.
 *
 * This adapter intentionally accepts loopback endpoints only. It is a genuine
 * local target (for example Ollama or LM Studio), never a cloud fallback.
 */

import type { ExperimentalCoreModel } from '../experimentalCoreProtocol';
import {
  requireWorkspace,
  throwIfAborted,
  type CoreAdapter,
  type CoreRunInput,
  type DetectedCoreTarget,
} from './coreAdapter';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/v1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DISCOVERY_TIMEOUT_MS = 1_500;

export type LoopbackOpenAiAdapterOptions = {
  endpoint?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
};

type OpenAiModelResponse = { data?: Array<{ id?: unknown }> };
type OpenAiStreamFrame = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning_content?: unknown;
      reasoning?: unknown;
    };
  }>;
};

type DecodedStreamFrame = {
  content: string;
  reasoning: string;
};

/** Reject every non-loopback endpoint before a request can leave the device. */
export const validateLoopbackOpenAiEndpoint = (value: string): URL => {
  const endpoint = new URL(value);
  if (endpoint.username || endpoint.password) throw new Error('Local engine endpoint must not contain credentials.');
  if (!['http:', 'https:'].includes(endpoint.protocol) || !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase())) {
    throw new Error('Local engine endpoint must use an explicit loopback host.');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/u, '') || '/v1';
  return endpoint;
};

const endpointFromOptions = (options: LoopbackOpenAiAdapterOptions): URL =>
  validateLoopbackOpenAiEndpoint(options.endpoint ?? process.env.TOMNY_LOCAL_OPENAI_URL ?? DEFAULT_ENDPOINT);

const endpointPath = (base: URL, path: string): string => `${base.toString().replace(/\/+$/u, '')}/${path}`;

const modelsFromResponse = (value: unknown): ExperimentalCoreModel[] => {
  const data = (value as OpenAiModelResponse | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  return data.flatMap((candidate, index) => {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ key: id, modelId: id, label: id, isDefault: index === 0 }];
  });
};

const decodeStreamFrame = (raw: string): DecodedStreamFrame => {
  let value: OpenAiStreamFrame;
  try {
    value = JSON.parse(raw) as OpenAiStreamFrame;
  } catch {
    throw new Error('The local engine returned an invalid stream frame.');
  }
  const delta = value.choices?.[0]?.delta;
  const rawReasoning = delta?.reasoning_content ?? delta?.reasoning;
  const reasoning = typeof rawReasoning === 'string' ? rawReasoning : '';

  const rawContent = delta?.content;
  let content = '';
  if (typeof rawContent === 'string') {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content = rawContent
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('');
  }

  return { content, reasoning };
};

const consumeCompletionStream = async (response: Response, input: CoreRunInput): Promise<void> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The local engine did not provide a completion stream.');
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let emittedText = false;
  let inThinkTag = false;

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('data:')) throw new Error('The local engine returned an invalid stream event.');
    const data = trimmed.slice('data:'.length).trim();
    if (data === '[DONE]') {
      completed = true;
      return;
    }
    const { content, reasoning } = decodeStreamFrame(data);
    if (reasoning) {
      emittedText = true;
      input.emit({ type: 'thinking', text: reasoning });
    }
    if (content) {
      // If the model outputs raw <think> tags in content stream (e.g. Ollama deepseek-r1)
      let remaining = content;
      while (remaining.length > 0) {
        if (!inThinkTag) {
          const thinkStart = remaining.indexOf('<think>');
          if (thinkStart !== -1) {
            const before = remaining.slice(0, thinkStart);
            if (before) {
              emittedText = true;
              input.emit({ type: 'delta', text: before });
            }
            inThinkTag = true;
            remaining = remaining.slice(thinkStart + '<think>'.length);
          } else {
            emittedText = true;
            input.emit({ type: 'delta', text: remaining });
            break;
          }
        } else {
          const thinkEnd = remaining.indexOf('</think>');
          if (thinkEnd !== -1) {
            const thinkContent = remaining.slice(0, thinkEnd);
            if (thinkContent) {
              input.emit({ type: 'thinking', text: thinkContent });
            }
            inThinkTag = false;
            remaining = remaining.slice(thinkEnd + '</think>'.length);
          } else {
            input.emit({ type: 'thinking', text: remaining });
            break;
          }
        }
      }
    }
  };

  try {
    while (true) {
      throwIfAborted(input.signal);
      // Stream reads must remain serial to preserve the engine's token order.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }
  throwIfAborted(input.signal);
  if (!completed) throw new Error('The local engine ended the completion stream without a terminal marker.');
  if (!emittedText) throw new Error('The local engine returned an empty completion.');
};

/** Detects a local OpenAI-compatible engine without exposing any remote endpoint. */
export const detectLoopbackOpenAiTarget = async (
  options: LoopbackOpenAiAdapterOptions = {}
): Promise<DetectedCoreTarget> => {
  const endpoint = endpointFromOptions(options);
  const fetchImpl = options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  let detected = false;
  try {
    const response = await fetchImpl(endpointPath(endpoint, 'models'), { method: 'GET', signal });
    detected = response.ok && modelsFromResponse(await response.json()).length > 0;
  } catch {
    detected = false;
  }
  return {
    id: 'local-openai',
    name: 'Local OpenAI-compatible engine',
    protocol: 'loopback-openai',
    candidates: [],
    args: [],
    detail: `Loopback engine at ${endpoint.host}`,
    detected,
    available: detected,
    runnable: true,
  };
};

export class LoopbackOpenAiAdapter implements CoreAdapter {
  public readonly protocol = 'loopback-openai' as const;
  private readonly endpoint: URL;
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

  public constructor(options: LoopbackOpenAiAdapterOptions = {}) {
    this.endpoint = endpointFromOptions(options);
    this.fetchImpl = options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
  }

  public async listModels(_target: DetectedCoreTarget): Promise<ExperimentalCoreModel[]> {
    const response = await this.fetchImpl(endpointPath(this.endpoint, 'models'), { method: 'GET' });
    if (!response.ok) return [];
    return modelsFromResponse(await response.json());
  }

  public async run(input: CoreRunInput): Promise<void> {
    throwIfAborted(input.signal);
    requireWorkspace(input.workspace);
    const models = input.modelKey ? [] : await this.listModels(input.target);
    const model = input.modelKey ?? models[0]?.key;
    if (!model) throw new Error('The local engine did not report an available model.');
    input.emit({ type: 'status', text: 'Running on the local loopback engine.' });
    const response = await this.fetchImpl(endpointPath(this.endpoint, 'chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'You are a local Tomny Hub assistant. Do not claim access to tools, files, or network resources unless their result is present in the prompt.',
          },
          { role: 'user', content: input.prompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Local engine rejected the completion request (${response.status}).`);
    await consumeCompletionStream(response, input);
  }

  public async dispose(): Promise<void> {
    // The external loopback engine remains user-owned and is never terminated by Tomny.
  }
}
