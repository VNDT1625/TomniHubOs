import { describe, expect, it } from 'vitest';

import type { ChatPipelineStageRef, ChatStageMetadata } from '../../../packages/desktop/src/common/types/pipeline';
import {
  builtinStageTextKey,
  callsForStage,
  defaultStageRefs,
  duplicateStage,
  formatAnswer,
  moveStage,
  newStageRef,
  patchStageConfig,
  pipelineWarnings,
  removeStage,
  setStageEnabled,
} from '../../../packages/desktop/src/renderer/pages/conversation/components/pipeline/pipelineUtils';

const meta = (overrides: Partial<ChatStageMetadata> & { id: string }): ChatStageMetadata => ({
  displayName: overrides.id,
  description: '',
  phase: 'pre_query',
  defaultEnabled: false,
  isBuiltin: true,
  ...overrides,
});

const guard = meta({ id: 'builtin:laya-security', role: 'guard', authorizedGuard: true, defaultEnabled: true });
const understand = meta({ id: 'builtin:understand', defaultEnabled: true });
const retrieve = meta({ id: 'test:retriever', phase: 'retrieve', isBuiltin: false });
const thirdPartyGuard = meta({ id: 'acme.safety', role: 'guard', authorizedGuard: false, isBuiltin: false });

const index = (...items: ChatStageMetadata[]): ReadonlyMap<string, ChatStageMetadata> =>
  new Map(items.map((item) => [item.id, item] as const));

const ref = (id: string, registryId: string, enabled = true): ChatPipelineStageRef => ({
  id,
  stageRegistryId: registryId,
  phase: 'pre_query',
  enabled,
});

describe('editing the stage list', () => {
  const stages = [ref('a', 'builtin:laya-security'), ref('b', 'builtin:understand'), ref('c', 'test:retriever')];

  it('moves a stage and ignores moves past either end', () => {
    expect(moveStage(stages, 0, 1).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(moveStage(stages, 2, -1).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moveStage(stages, 0, -1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(moveStage(stages, 2, 1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes by position without touching the original list', () => {
    expect(removeStage(stages, 1).map((s) => s.id)).toEqual(['a', 'c']);
    expect(stages).toHaveLength(3);
  });

  it('duplicates a stage right after the original with its own id and its own config', () => {
    const withConfig = [{ ...stages[0], config: { mode: 'block' } }, stages[1]];
    const next = duplicateStage(withConfig, 0, 1000);

    expect(next).toHaveLength(3);
    expect(next[1].stageRegistryId).toBe('builtin:laya-security');
    expect(next[1].id).not.toBe(next[0].id);
    expect(next[1].config).toEqual({ mode: 'block' });
    expect(next[1].config).not.toBe(next[0].config);
    expect(next[2].id).toBe('b');
  });

  it('gives every new stage a distinct id even when added in the same millisecond', () => {
    const first = newStageRef(guard, 5);
    const second = newStageRef(guard, 5);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({ stageRegistryId: 'builtin:laya-security', phase: 'pre_query', enabled: true });
  });

  it('toggles and configures one stage at a time', () => {
    expect(setStageEnabled(stages, 'b', false).map((s) => s.enabled)).toEqual([true, false, true]);
    const patched = patchStageConfig([{ ...stages[0], config: { mode: 'rewrite', keep: 1 } }], 'a', { mode: 'block' });
    expect(patched[0].config).toEqual({ mode: 'block', keep: 1 });
    expect(patchStageConfig(stages, 'missing', { x: 1 })).toEqual(stages);
  });

  it('restores the stages that are on by default, in registry order', () => {
    expect(defaultStageRefs([guard, understand, retrieve]).map((s) => s.stageRegistryId)).toEqual([
      'builtin:laya-security',
      'builtin:understand',
    ]);
  });
});

describe('pipeline warnings', () => {
  const metaById = index(guard, understand, retrieve, thirdPartyGuard);

  it('warns about retrieved context that no later guard inspects', () => {
    const warnings = pipelineWarnings([ref('g', 'builtin:laya-security'), ref('r', 'test:retriever')], metaById);
    expect(warnings).toEqual([{ kind: 'unguardedRetrieve', stageId: 'r', registryId: 'test:retriever' }]);
  });

  it('accepts a guard that runs after the retrieve stage, and repeated guards', () => {
    expect(
      pipelineWarnings(
        [ref('g1', 'builtin:laya-security'), ref('r', 'test:retriever'), ref('g2', 'builtin:laya-security')],
        metaById
      )
    ).toEqual([]);
  });

  it('ignores stages that are switched off', () => {
    const warnings = pipelineWarnings([ref('g', 'builtin:laya-security'), ref('r', 'test:retriever', false)], metaById);
    expect(warnings).toEqual([]);
  });

  it('reports when no authorized guard is left, but not for an authorized one', () => {
    expect(pipelineWarnings([ref('u', 'builtin:understand')], metaById)).toEqual([{ kind: 'noGuard' }]);
    expect(pipelineWarnings([ref('t', 'acme.safety')], metaById)).toEqual([{ kind: 'noGuard' }]);
    expect(pipelineWarnings([ref('g', 'builtin:laya-security')], metaById)).toEqual([]);
    expect(pipelineWarnings([ref('g', 'builtin:laya-security', false)], metaById)).toEqual([{ kind: 'noGuard' }]);
  });
});

describe('display helpers', () => {
  it('maps built-in stages, including the renamed router, to translated text', () => {
    expect(builtinStageTextKey('builtin:laya-security')).toBe('security');
    expect(builtinStageTextKey('builtin:tool-router')).toBe('toolSchema');
    expect(builtinStageTextKey('builtin:tool-schema')).toBe('toolSchema');
    expect(builtinStageTextKey('acme.safety')).toBeUndefined();
  });

  it('formats model answers on one line', () => {
    expect(formatAnswer({ choice: 'code', confidence: 0.914 })).toBe('code (91%)');
    expect(formatAnswer({ choice: 'chat' })).toBe('chat');
    expect(formatAnswer({ noul: 0.125 })).toBe('0.13');
    expect(formatAnswer({ score: 3 })).toBe('3.00');
    expect(formatAnswer({ other: 1 })).toBe('{"other":1}');
    expect(formatAnswer('plain')).toBe('plain');
  });

  it('finds the model calls a stage made', () => {
    const calls = [
      { id: '1', stageId: 'a' },
      { id: '2', stageId: 'b' },
      { id: '3', stageId: 'a' },
    ] as never;
    expect(callsForStage(calls, 'a').map((c) => c.id)).toEqual(['1', '3']);
    expect(callsForStage(undefined, 'a')).toEqual([]);
  });
});
