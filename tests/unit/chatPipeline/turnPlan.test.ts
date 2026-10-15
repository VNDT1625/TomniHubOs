import { describe, expect, it } from 'vitest';

import {
  buildOutboundParts,
  composeSendParams,
  createToolSelectionMemory,
} from '../../../packages/desktop/src/process/services/chatPipeline/turnPlan';

const grounding = (capabilityIds: string[], applied = true) => ({ toolSchema: { capabilityIds, applied } });

describe('buildOutboundParts', () => {
  it('sends the pipeline’s rewritten query and keeps the hidden model input in step with it', () => {
    const parts = buildOutboundParts(
      { finalQuery: 'my password is [REDACTED]' },
      { input: 'my password is hunter2', model_input: '[goal] my password is hunter2 [lang]' }
    );
    expect(parts.map((part) => part.id)).toEqual(['input', 'model-input']);
    expect(parts[0].text).toBe('my password is [REDACTED]');
    expect(parts[1].text).toBe('[goal] my password is [REDACTED] [lang]');
    expect(JSON.stringify(parts)).not.toContain('hunter2');
  });

  it('includes attached-file paths in an inspectable model-input part', () => {
    const parts = buildOutboundParts(
      { finalQuery: 'compare these files' },
      { input: 'compare these files', files: ['/workspace/before.txt', '/workspace/after.txt'] }
    );

    expect(parts).toEqual([
      { id: 'input', text: 'compare these files', role: 'user', source: 'user' },
      {
        id: 'model-input',
        text: 'compare these files\n[Attached file: /workspace/before.txt]\n[Attached file: /workspace/after.txt]',
        role: 'user',
        source: 'generated',
      },
    ]);
  });

  it('adds retrieved context as its own inspectable part, and nothing when there is none', () => {
    const withContext = buildOutboundParts({ finalQuery: 'q', finalContext: '  docs  ' }, { input: 'q' });
    expect(withContext.map((part) => part.id)).toEqual(['input', 'pipeline-context']);
    expect(withContext[1]).toMatchObject({ text: 'docs', role: 'metadata', source: 'tool' });

    expect(buildOutboundParts({ finalQuery: 'q', finalContext: '   ' }, { input: 'q' })).toHaveLength(1);
    expect(buildOutboundParts({ finalQuery: 'q' }, { input: 'q' })).toHaveLength(1);
  });
});

describe('composeSendParams', () => {
  const parts = [
    { id: 'input', text: 'safe question' },
    { id: 'model-input', text: 'safe hidden prompt' },
    { id: 'pipeline-context', text: 'safe docs' },
  ];

  it('puts inspected context in front of the model input and leaves the visible message alone', () => {
    const sent = composeSendParams(
      { input: 'raw', model_input: 'raw hidden', conversation_id: 'c1' },
      parts,
      undefined
    );
    expect(sent.input).toBe('safe question');
    expect(sent.conversation_id).toBe('c1');
    expect(sent.model_input).toBe('[Pipeline context]\nsafe docs\n[/Pipeline context]\n\nsafe hidden prompt');
  });

  it('uses the visible message as the model input when there is none, still carrying the context', () => {
    const sent = composeSendParams({ input: 'raw' }, [parts[0], parts[2]], undefined);
    expect(sent.model_input).toBe('[Pipeline context]\nsafe docs\n[/Pipeline context]\n\nsafe question');
  });

  it('leaves the model input untouched when no context was gathered', () => {
    expect(composeSendParams({ input: 'raw' }, [parts[0]], undefined).model_input).toBeUndefined();
    expect(composeSendParams({ input: 'raw', model_input: 'x' }, [parts[0], parts[1]], undefined).model_input).toBe(
      'safe hidden prompt'
    );
  });

  it('never lets the renderer choose tool groups', () => {
    const forged = { input: 'raw', toolSelection: ['surface.ide', 'surface.browser'] } as { input: string };
    expect(composeSendParams(forged, [parts[0]], undefined).toolSelection).toBeUndefined();
    expect(composeSendParams(forged, [parts[0]], ['core.testing']).toolSelection).toEqual(['core.testing']);
  });

  it('refuses to send when inspection returned no safe user input', () => {
    expect(() => composeSendParams({ input: 'raw' }, [parts[1]], undefined)).toThrow('no safe user input');
  });
});

describe('tool selection memory', () => {
  it('only grows within a conversation, and is sorted so the CLI process key is stable', () => {
    const memory = createToolSelectionMemory();
    expect(memory.next('c1', grounding([]))).toEqual([]);
    expect(memory.next('c1', grounding(['core.testing']))).toEqual(['core.testing']);
    expect(memory.next('c1', grounding(['core.agent-orchestrator']))).toEqual([
      'core.agent-orchestrator',
      'core.testing',
    ]);
    expect(memory.next('c1', grounding([]))).toEqual(['core.agent-orchestrator', 'core.testing']);
  });

  it('keeps conversations apart', () => {
    const memory = createToolSelectionMemory();
    memory.next('c1', grounding(['core.testing']));
    expect(memory.next('c2', grounding([]))).toEqual([]);
  });

  it('applies nothing when the stage is absent or advisory', () => {
    const memory = createToolSelectionMemory();
    expect(memory.next('c1', undefined)).toBeUndefined();
    expect(memory.next('c1', {})).toBeUndefined();
    expect(memory.next('c1', grounding(['core.testing'], false))).toBeUndefined();
  });

  it('forgets the oldest conversations beyond its bound', () => {
    const memory = createToolSelectionMemory(2);
    memory.next('a', grounding(['core.testing']));
    memory.next('b', grounding(['core.testing']));
    memory.next('c', grounding(['core.testing']));
    // `a` was evicted, so it starts over instead of remembering its old groups.
    expect(memory.next('a', grounding([]))).toEqual([]);
  });
});
