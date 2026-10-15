/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  ASSISTANT_LIMITS,
  createAssistantSchema,
  parseCreateAssistantRequest,
  parseUpdateAssistantRequest,
} from '@/common/types/agent/assistant/assistantSchema';
import {
  AssistantBundleError,
  ASSISTANT_BUNDLE_MAX_BYTES,
  buildAssistantBundle,
  bundleFileName,
  readAssistantBundle,
} from '@/common/types/agent/assistant/assistantBundle';
import type { Assistant } from '@/common/types/agent/assistantTypes';

const HOOK = 'd'.repeat(64);

const sample: Assistant = {
  id: 'research-helper',
  source: 'user',
  name: 'Research helper',
  name_i18n: {},
  description: 'Finds real-world information.',
  description_i18n: {},
  avatar: '🔎',
  enabled: true,
  sort_order: 0,
  preset_agent_type: 'tomnyagentic',
  enabled_skills: ['web-search'],
  custom_skill_names: ['summarize'],
  disabled_builtin_skills: [],
  enabled_plugins: ['mcp-search'],
  enabled_hooks: [HOOK],
  context: '# Agent\nSearch first, cite sources.',
  context_i18n: {},
  prompts: ['Find the latest news'],
  prompts_i18n: {},
  models: [],
};

const zipOf = async (entries: Record<string, string>): Promise<Uint8Array> => {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(entries)) zip.file(name, text);
  return zip.generateAsync({ type: 'uint8array' });
};

const expectBundleError = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(AssistantBundleError);
};

describe('assistant IPC schemas', () => {
  it('accepts a normal create request with plugins and hooks', () => {
    const parsed = parseCreateAssistantRequest({
      name: 'Research helper',
      enabled_plugins: ['mcp-search'],
      enabled_hooks: [HOOK],
    });
    expect(parsed.enabled_plugins).toEqual(['mcp-search']);
    expect(parsed.enabled_hooks).toEqual([HOOK]);
  });

  it('refuses unknown and provenance fields on create and update', () => {
    expect(() => parseCreateAssistantRequest({ name: 'x', source: 'builtin' })).toThrow();
    expect(() => parseCreateAssistantRequest({ name: 'x', packageId: 'pkg' })).toThrow();
    expect(() => parseUpdateAssistantRequest({ id: 'x', unknownField: true })).toThrow();
  });

  it('refuses oversized and malformed values', () => {
    expect(() => parseCreateAssistantRequest({ name: '' })).toThrow();
    expect(() => parseCreateAssistantRequest({ name: 'x'.repeat(ASSISTANT_LIMITS.nameMax + 1) })).toThrow();
    const oversizedContext = 'a'.repeat(ASSISTANT_LIMITS.contextMaxBytes + 1);
    expect(() => parseCreateAssistantRequest({ name: 'x', context: oversizedContext })).toThrow();
    expect(() => parseCreateAssistantRequest({ name: 'x', enabled_hooks: ['not-a-hook'] })).toThrow();
    expect(() => parseCreateAssistantRequest({ name: 'x', enabled_plugins: ['p'.repeat(300)] })).toThrow();
    expect(() =>
      parseCreateAssistantRequest({
        name: 'x',
        enabled_plugins: Array.from({ length: ASSISTANT_LIMITS.listMax + 1 }, (_, i) => `p${i}`),
      })
    ).toThrow();
    expect(() => createAssistantSchema.parse({ name: 'x', id: '../escape' })).toThrow();
  });

  it('requires an id on update', () => {
    expect(() => parseUpdateAssistantRequest({ name: 'renamed' })).toThrow();
    expect(parseUpdateAssistantRequest({ id: 'x', enabled_plugins: [] }).enabled_plugins).toEqual([]);
  });
});

describe('assistant bundle', () => {
  it('round-trips agent.md and assistant.json without provenance or ids', async () => {
    const bytes = await buildAssistantBundle(sample);
    const request = await readAssistantBundle(bytes);
    expect(request.name).toBe('Research helper');
    expect(request.context).toBe(sample.context);
    expect(request.enabled_plugins).toEqual(['mcp-search']);
    expect(request.enabled_hooks).toEqual([HOOK]);
    expect(request).not.toHaveProperty('id');
    expect(request).not.toHaveProperty('source');
  });

  it('refuses extra entries, nested or traversal names, and missing files', async () => {
    const manifest = JSON.stringify({ schema_version: 1, name: 'x' });
    await expectBundleError(
      readAssistantBundle(await zipOf({ 'assistant.json': manifest, 'agent.md': '', 'extra.txt': 'x' })),
      'bundle_bad_entry'
    );
    await expectBundleError(
      readAssistantBundle(await zipOf({ 'assistant.json': manifest, '../agent.md': '' })),
      'bundle_bad_entry'
    );
    await expectBundleError(
      readAssistantBundle(await zipOf({ 'assistant.json': manifest, 'dir/agent.md': '' })),
      'bundle_bad_entry'
    );
    await expectBundleError(readAssistantBundle(await zipOf({ 'assistant.json': manifest })), 'bundle_missing_file');
  });

  it('refuses unknown manifest fields, bad hook ids and oversized or non-zip input', async () => {
    const withProvenance = '{"schema_version":1,"name":"x","source":"builtin"}';
    await expectBundleError(
      readAssistantBundle(await zipOf({ 'assistant.json': withProvenance, 'agent.md': '' })),
      'bundle_invalid_manifest'
    );
    await expectBundleError(
      readAssistantBundle(
        await zipOf({ 'assistant.json': '{"schema_version":1,"name":"x","enabled_hooks":["bad"]}', 'agent.md': '' })
      ),
      'bundle_invalid_manifest'
    );
    await expectBundleError(readAssistantBundle(new TextEncoder().encode('not a zip')), 'bundle_not_zip');
    await expectBundleError(readAssistantBundle(new Uint8Array(ASSISTANT_BUNDLE_MAX_BYTES + 1)), 'bundle_too_large');
  });

  it('builds safe file names from assistant names', () => {
    expect(bundleFileName('../../etc/passwd')).toBe('etc-passwd.zip');
    expect(bundleFileName('!!!')).toBe('assistant.zip');
  });
});
