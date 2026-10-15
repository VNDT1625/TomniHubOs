/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssistantCatalogStore } from '@process/resources/assistantCatalogStore';

const HOOK = 'e'.repeat(64);

describe('assistant catalog store migration', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'assistant-store-'));
    file = path.join(dir, 'assistants.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads records saved before plugins and hooks existed with empty lists', async () => {
    const legacy = [
      {
        id: 'legacy-1',
        source: 'user',
        name: 'Legacy',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 1,
        preset_agent_type: 'tomnyagentic',
        enabled_skills: ['web-search'],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
      },
    ];
    await writeFile(file, JSON.stringify(legacy), 'utf8');
    const store = createAssistantCatalogStore(file);
    const [row] = await store.list();
    expect(row?.enabled_plugins).toEqual([]);
    expect(row?.enabled_hooks).toEqual([]);
    expect(row?.enabled_skills).toEqual(['web-search']);
  });

  it('drops non-string entries and duplicates from plugin and hook lists on migration', async () => {
    const dirty = [
      {
        id: 'dirty-1',
        source: 'user',
        name: 'Dirty',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 0,
        preset_agent_type: 'tomnyagentic',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        enabled_plugins: ['mcp-a', 'mcp-a', 42, null],
        enabled_hooks: [HOOK, 'not-a-hook-id-but-kept-as-string', 7],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
      },
    ];
    await writeFile(file, JSON.stringify(dirty), 'utf8');
    const [row] = await createAssistantCatalogStore(file).list();
    expect(row?.enabled_plugins).toEqual(['mcp-a']);
    expect(row?.enabled_hooks).toEqual([HOOK, 'not-a-hook-id-but-kept-as-string']);
  });

  it('persists new plugin and hook selections with duplicates removed', async () => {
    const store = createAssistantCatalogStore(file);
    const created = await store.create({
      name: 'Researcher',
      enabled_plugins: ['mcp-a', 'mcp-a', 'mcp-b'],
      enabled_hooks: [HOOK, HOOK],
    });
    expect(created.enabled_plugins).toEqual(['mcp-a', 'mcp-b']);
    expect(created.enabled_hooks).toEqual([HOOK]);
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as Array<{ enabled_plugins: string[] }>;
    expect(onDisk[0]?.enabled_plugins).toEqual(['mcp-a', 'mcp-b']);
  });
});
