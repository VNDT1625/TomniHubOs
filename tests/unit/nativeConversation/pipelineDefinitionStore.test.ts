/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatPipelineDefinition } from '@/common/types/pipeline';
import {
  createPipelineDefinitionStore,
  sanitizePipelineDefinition,
  withRequiredStages,
} from '@process/services/database/nativeConversation/pipelineDefinitionStore';

const chain = (id: string, patch: Partial<ChatPipelineDefinition> = {}): ChatPipelineDefinition => ({
  schemaVersion: 1,
  id,
  name: `Chain ${id}`,
  enabled: true,
  stages: [{ id: `${id}-s1`, stageRegistryId: 'builtin:tool-schema', phase: 'pre_model', enabled: true }],
  ...patch,
});

const defaults = (): ChatPipelineDefinition => ({
  schemaVersion: 1,
  id: 'default-pipeline',
  name: 'Default',
  enabled: true,
  stages: [
    { id: 'stage-builtin:user-hooks', stageRegistryId: 'builtin:user-hooks', phase: 'pre_query', enabled: true },
    { id: 'stage-builtin:tool-schema', stageRegistryId: 'builtin:tool-schema', phase: 'pre_model', enabled: true },
  ],
});
const open = (maxConversations?: number) =>
  createPipelineDefinitionStore(file, {
    defaultDefinition: defaults,
    ...(maxConversations === undefined ? {} : { maxConversations }),
  });

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomny-pipelines-'));
  file = path.join(dir, 'chat-pipelines.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pipeline definition sanitizing', () => {
  it('keeps a valid chain and clamps its limits', () => {
    const result = sanitizePipelineDefinition({
      ...chain('a'),
      limits: { maxStages: 999, maxTotalTimeoutMs: -1 },
      extra: 'dropped',
    });
    expect(result?.stages).toHaveLength(1);
    expect(result?.limits).toEqual({ maxStages: 32, maxTotalTimeoutMs: undefined, maxContextBytes: undefined });
    expect(result).not.toHaveProperty('extra');
  });

  it('rejects a chain whole when any part is malformed', () => {
    expect(sanitizePipelineDefinition({ ...chain('a'), schemaVersion: 2 })).toBeUndefined();
    expect(sanitizePipelineDefinition({ ...chain('a'), name: 'x'.repeat(201) })).toBeUndefined();
    const badStage = { id: 's', stageRegistryId: 'r', phase: 'everywhere', enabled: true };
    expect(sanitizePipelineDefinition({ ...chain('a'), stages: [chain('a').stages[0], badStage] })).toBeUndefined();
    const tooMany = Array.from({ length: 33 }, (_, index) => ({ ...chain('a').stages[0], id: `s${index}` }));
    expect(sanitizePipelineDefinition({ ...chain('a'), stages: tooMany })).toBeUndefined();
    expect(sanitizePipelineDefinition('nope')).toBeUndefined();
  });

  it('drops a stage config that is too large', () => {
    const stage = { ...chain('a').stages[0], config: { blob: 'x'.repeat(20_000) } };
    expect(sanitizePipelineDefinition({ ...chain('a'), stages: [stage] })?.stages[0]).not.toHaveProperty('config');
  });
});

describe('pipeline definition store', () => {
  it('resolves a conversation chain, then the saved default, then nothing', () => {
    const store = open();
    expect(store.resolve('c1')).toBeUndefined();
    store.save(undefined, chain('default'));
    expect(store.resolve('c1')?.id).toBe('default');
    expect(store.resolve()?.id).toBe('default');
    store.save('c1', chain('mine'));
    expect(store.resolve('c1')?.id).toBe('mine');
    store.forget('c1');
    expect(store.resolve('c1')?.id).toBe('default');
    store.resetDefault();
    expect(store.resolve('c1')).toBeUndefined();
  });

  it('keeps chains across restarts and ignores a corrupt file', () => {
    open().save('c1', chain('mine'));
    open().save(undefined, chain('default'));
    const reopened = open();
    expect(reopened.resolve('c1')?.id).toBe('mine');
    expect(reopened.resolve('c2')?.id).toBe('default');

    fs.writeFileSync(file, '{not json');
    expect(open().resolve('c1')).toBeUndefined();
  });

  it('drops the least recently saved conversation over the cap', () => {
    const store = open(2);
    store.save('c1', chain('one'));
    store.save('c2', chain('two'));
    store.save('c1', chain('one-again'));
    store.save('c3', chain('three'));
    expect(store.resolve('c2')).toBeUndefined();
    expect(store.resolve('c1')?.id).toBe('one-again');
    expect(open(2).resolve('c3')?.id).toBe('three');
  });
});

const stageIds = (definition: ChatPipelineDefinition | undefined): string[] =>
  (definition?.stages ?? []).map((stage) => stage.stageRegistryId);

describe('required pipeline stages', () => {
  it('puts the user-hooks stage back into a chain saved without it, where the default has it', () => {
    const store = open();
    store.save('c1', chain('no-hooks'));
    expect(stageIds(store.resolve('c1'))).toEqual(['builtin:user-hooks', 'builtin:tool-schema']);
  });

  it('keeps the enabled value the person chose for a stage the chain already has', () => {
    const store = open();
    const hooks = { id: 'h', stageRegistryId: 'builtin:user-hooks', phase: 'pre_query' as const, enabled: false };
    store.save('c1', { ...chain('x'), stages: [hooks, chain('x').stages[0]] });
    expect(store.resolve('c1')?.stages[0]).toMatchObject({ stageRegistryId: 'builtin:user-hooks', enabled: false });
    expect(stageIds(store.resolve('c1'))).toHaveLength(2);
  });

  it('migrates an old file on load and writes the chains back with the stage', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, default: chain('old'), conversations: [['c1', chain('old-conv')]] })
    );
    const store = open();
    expect(stageIds(store.resolve('c1'))).toEqual(['builtin:user-hooks', 'builtin:tool-schema']);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      default: ChatPipelineDefinition;
      conversations: [string, ChatPipelineDefinition][];
    };
    expect(stageIds(onDisk.default)).toContain('builtin:user-hooks');
    expect(stageIds(onDisk.conversations[0]?.[1])).toContain('builtin:user-hooks');
  });

  it('keeps the exact pre-migration definition file for rollback', () => {
    const original = JSON.stringify({
      version: 1,
      default: chain('old'),
      conversations: [['c1', chain('old-conv')]],
    });
    fs.writeFileSync(file, original);
    const store = open();
    expect(stageIds(store.resolve('c1'))).toContain('builtin:user-hooks');
    expect(fs.readFileSync(`${file}.pre-migration.bak`, 'utf8')).toBe(original);
    const reopened = open();
    expect(stageIds(reopened.resolve('c1'))).toContain('builtin:user-hooks');
    // Migration runs once and never overwrites the backup.
    expect(fs.readFileSync(`${file}.pre-migration.bak`, 'utf8')).toBe(original);
  });

  it('places the stage after the stage that precedes it in the default chain', () => {
    const understand = { id: 'u', stageRegistryId: 'builtin:understand', phase: 'pre_query' as const, enabled: true };
    const hooks = { id: 'h', stageRegistryId: 'builtin:user-hooks', phase: 'pre_query' as const, enabled: true };
    const withUnderstand: ChatPipelineDefinition = {
      ...defaults(),
      stages: [understand, hooks, chain('x').stages[0]],
    };
    const result = withRequiredStages({ ...chain('y'), stages: [understand, chain('y').stages[0]] }, withUnderstand);
    expect(stageIds(result)).toEqual(['builtin:understand', 'builtin:user-hooks', 'builtin:tool-schema']);
  });

  it('returns the same object when the chain already has every required stage', () => {
    const complete = defaults();
    expect(withRequiredStages(complete, defaults())).toBe(complete);
  });
});
