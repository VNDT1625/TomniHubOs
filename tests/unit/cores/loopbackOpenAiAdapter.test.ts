import { describe, expect, it, vi } from 'vitest';
import {
  detectLoopbackOpenAiTarget,
  LoopbackOpenAiAdapter,
  validateLoopbackOpenAiEndpoint,
} from '../../../packages/desktop/src/process/experimentalCore/adapters/loopbackOpenAiAdapter';

const target = {
  id: 'local-openai',
  name: 'Local OpenAI-compatible engine',
  protocol: 'loopback-openai' as const,
  candidates: [],
  args: [],
  detail: 'Loopback engine',
  detected: true,
  available: true,
  runnable: true,
};

const requireLocalReleaseProof = process.env.TOMNI_REQUIRE_LOCAL_E2E === '1';

describe('loopback OpenAI adapter', () => {
  it('rejects every non-loopback endpoint before it can be used', () => {
    expect(() => validateLoopbackOpenAiEndpoint('https://api.example.test/v1')).toThrow('loopback');
    expect(() => validateLoopbackOpenAiEndpoint('http://user:pass@127.0.0.1:11434/v1')).toThrow('credentials');
    expect(validateLoopbackOpenAiEndpoint('http://localhost:1234/v1/').toString()).toBe('http://localhost:1234/v1');
  });

  it('discovers a real local model endpoint only after a successful model probe', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ id: 'qwen-local' }] }), { status: 200 })
    );
    await expect(
      detectLoopbackOpenAiTarget({ endpoint: 'http://127.0.0.1:11434/v1', fetchImpl })
    ).resolves.toMatchObject({
      id: 'local-openai',
      available: true,
      detected: true,
      protocol: 'loopback-openai',
    });
    await expect(
      detectLoopbackOpenAiTarget({ endpoint: 'http://127.0.0.1:11434/v1', fetchImpl: async () => new Response('{}') })
    ).resolves.toMatchObject({
      available: false,
      detected: false,
    });
  });

  it('runs only against the loopback engine and reports its completion', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Local "}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/models'))
        return new Response(JSON.stringify({ data: [{ id: 'qwen-local' }] }), { status: 200 });
      return new Response(stream, { status: 200 });
    });
    const adapter = new LoopbackOpenAiAdapter({ endpoint: 'http://127.0.0.1:11434/v1', fetchImpl });
    const events: unknown[] = [];
    await adapter.run({
      sessionId: 'session_1',
      target,
      prompt: 'Answer locally.',
      workspace: 'C:/workspace',
      modelKey: 'qwen-local',
      permissionMode: 'workspace-write',
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      requestPermission: async () => true,
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:11434/v1/chat/completions']);
    expect(events).toContainEqual({ type: 'delta', text: 'Local ' });
    expect(events).toContainEqual({ type: 'delta', text: 'answer' });
  });

  it('keeps an ordinary local conversation on loopback when external network access is blocked', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"Offline local answer"}}]}\n\ndata: [DONE]\n')
        );
        controller.close();
      },
    });
    const networkBlockedFetch = vi.fn(async (url: string) => {
      const requestUrl = new URL(url);
      if (requestUrl.hostname !== '127.0.0.1') {
        throw new Error(`External network access is blocked: ${requestUrl.origin}`);
      }
      if (requestUrl.pathname === '/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'qwen-local' }] }), { status: 200 });
      }
      if (requestUrl.pathname === '/v1/chat/completions') return new Response(stream, { status: 200 });
      throw new Error(`Unexpected local endpoint: ${requestUrl.pathname}`);
    });

    const detected = await detectLoopbackOpenAiTarget({
      endpoint: 'http://127.0.0.1:11434/v1',
      fetchImpl: networkBlockedFetch,
    });
    expect(detected).toMatchObject({ available: true, detected: true, protocol: 'loopback-openai' });

    const adapter = new LoopbackOpenAiAdapter({
      endpoint: 'http://127.0.0.1:11434/v1',
      fetchImpl: networkBlockedFetch,
    });
    const events: unknown[] = [];
    await adapter.run({
      sessionId: 'offline-local-conversation',
      target: detected,
      prompt: 'Give me a short answer while I am offline.',
      workspace: 'C:/workspace',
      modelKey: 'qwen-local',
      permissionMode: 'read-only',
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      requestPermission: async () => false,
    });

    expect(networkBlockedFetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:11434/v1/models',
      'http://127.0.0.1:11434/v1/chat/completions',
    ]);
    expect(events).toEqual([
      { type: 'status', text: 'Running on the local loopback engine.' },
      { type: 'delta', text: 'Offline local answer' },
    ]);
  });

  it('fails closed when a loopback engine closes a stream without a terminal marker', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n'));
        controller.close();
      },
    });
    const adapter = new LoopbackOpenAiAdapter({
      endpoint: 'http://127.0.0.1:11434/v1',
      fetchImpl: async () => new Response(stream, { status: 200 }),
    });
    await expect(
      adapter.run({
        sessionId: 'session_1',
        target,
        prompt: 'Answer locally.',
        workspace: 'C:/workspace',
        modelKey: 'qwen-local',
        permissionMode: 'workspace-write',
        signal: new AbortController().signal,
        emit: () => undefined,
        requestPermission: async () => true,
      })
    ).rejects.toThrow('terminal marker');
  });

  it.skipIf(!requireLocalReleaseProof)(
    'executes an offline completion against the configured real local engine',
    async () => {
      const endpoint = process.env.TOMNI_LOCAL_OPENAI_URL?.trim();
      const model = process.env.TOMNI_LOCAL_OPENAI_MODEL?.trim();
      if (!endpoint) throw new Error('TOMNI_LOCAL_OPENAI_URL must identify the release-test loopback endpoint.');
      if (!model) throw new Error('TOMNI_LOCAL_OPENAI_MODEL must identify an installed local model.');

      const detected = await detectLoopbackOpenAiTarget({ endpoint });
      expect(detected).toMatchObject({ available: true, detected: true, protocol: 'loopback-openai' });
      const adapter = new LoopbackOpenAiAdapter({ endpoint });
      await expect(adapter.listModels(detected)).resolves.toContainEqual(expect.objectContaining({ modelId: model }));

      const output: string[] = [];
      await adapter.run({
        sessionId: 'release-local-proof',
        target: detected,
        prompt: 'Reply with a short acknowledgement that local inference is available.',
        workspace: process.cwd(),
        modelKey: model,
        permissionMode: 'read-only',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => {
          if (event.type === 'delta') output.push(event.text);
        },
        requestPermission: async () => false,
      });
      expect(output.join('').trim()).not.toBe('');
    },
    75_000
  );
});
