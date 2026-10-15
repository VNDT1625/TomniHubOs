/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Share format for an assistant: a zip with exactly two root entries, `assistant.json` (portable settings)
 * and `agent.md` (the instruction text). Import is strict: any other entry, any path that is not a plain root
 * name, an oversized archive or an oversized entry refuses the whole bundle. Nothing is written to disk here;
 * the caller turns the parsed request into a normal, re-validated create call.
 */

import JSZip from 'jszip';
import type { Assistant, CreateAssistantRequest } from '../assistantTypes';
import {
  ASSISTANT_LIMITS,
  assistantBundleManifestSchema,
  parseCreateAssistantRequest,
  type AssistantBundleManifest,
} from './assistantSchema';

/** File name made of safe characters only, so a hostile assistant name cannot shape the path. */
export const bundleFileName = (name: string): string => {
  const safe = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
    .slice(0, 64);
  return `${safe || 'assistant'}.zip`;
};

export const ASSISTANT_BUNDLE_MANIFEST = 'assistant.json';
export const ASSISTANT_BUNDLE_CONTEXT = 'agent.md';
/** Compressed archive cap. Two small text files never need more than this. */
export const ASSISTANT_BUNDLE_MAX_BYTES = 256 * 1024;

export type AssistantBundleErrorCode =
  | 'bundle_too_large'
  | 'bundle_not_zip'
  | 'bundle_bad_entry'
  | 'bundle_missing_file'
  | 'bundle_entry_too_large'
  | 'bundle_invalid_manifest'
  | 'bundle_invalid_context';

/** Error with a stable code the UI maps to a translated message. Never carries file contents. */
export class AssistantBundleError extends Error {
  readonly code: AssistantBundleErrorCode;
  constructor(code: AssistantBundleErrorCode) {
    super(code);
    this.name = 'AssistantBundleError';
    this.code = code;
  }
}

/** Only exact root names are accepted: no folders, no `..`, no absolute or drive-qualified paths. */
const ROOT_NAME = /^[A-Za-z0-9_.-]+$/u;
const ALLOWED_ENTRIES = new Set([ASSISTANT_BUNDLE_MANIFEST, ASSISTANT_BUNDLE_CONTEXT]);

const manifestOf = (assistant: Assistant): AssistantBundleManifest =>
  assistantBundleManifestSchema.parse({
    schema_version: 1,
    name: assistant.name,
    description: assistant.description ?? '',
    avatar: assistant.avatar ?? '',
    preset_agent_type: assistant.preset_agent_type,
    enabled_skills: assistant.enabled_skills,
    custom_skill_names: assistant.custom_skill_names,
    disabled_builtin_skills: assistant.disabled_builtin_skills,
    enabled_plugins: assistant.enabled_plugins,
    enabled_hooks: assistant.enabled_hooks,
    default_tools: assistant.default_tools ?? [],
  });

/** Builds the share zip for one assistant. The instruction text is written as agent.md unchanged. */
export const buildAssistantBundle = async (assistant: Assistant): Promise<Uint8Array> => {
  const context = assistant.context ?? '';
  if (new TextEncoder().encode(context).byteLength > ASSISTANT_LIMITS.contextMaxBytes)
    throw new AssistantBundleError('bundle_invalid_context');
  const zip = new JSZip();
  zip.file(ASSISTANT_BUNDLE_MANIFEST, JSON.stringify(manifestOf(assistant), null, 2) + '\n');
  zip.file(ASSISTANT_BUNDLE_CONTEXT, context);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};

/** Reads and validates a share zip. Throws AssistantBundleError on any refusal. */
export const readAssistantBundle = async (bytes: Uint8Array): Promise<CreateAssistantRequest> => {
  if (bytes.byteLength > ASSISTANT_BUNDLE_MAX_BYTES) throw new AssistantBundleError('bundle_too_large');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new AssistantBundleError('bundle_not_zip');
  }
  const names = Object.keys(zip.files);
  for (const name of names) {
    if (!ROOT_NAME.test(name) || !ALLOWED_ENTRIES.has(name)) throw new AssistantBundleError('bundle_bad_entry');
  }
  const manifestFile = zip.file(ASSISTANT_BUNDLE_MANIFEST);
  const contextFile = zip.file(ASSISTANT_BUNDLE_CONTEXT);
  if (!manifestFile || !contextFile) throw new AssistantBundleError('bundle_missing_file');

  const manifestText = await readEntryText(manifestFile, ASSISTANT_BUNDLE_MANIFEST);
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch {
    throw new AssistantBundleError('bundle_invalid_manifest');
  }
  const manifestResult = assistantBundleManifestSchema.safeParse(manifestJson);
  if (!manifestResult.success) throw new AssistantBundleError('bundle_invalid_manifest');
  const { schema_version: _version, ...manifest } = manifestResult.data;

  const context = await readEntryText(contextFile, ASSISTANT_BUNDLE_CONTEXT);
  return parseCreateAssistantRequest({ ...manifest, context });
};

/**
 * Reads one entry as UTF-8 text with a size check. The declared uncompressed size is checked before inflating,
 * so a small archive that expands far beyond the cap is refused without being decompressed.
 */
const readEntryText = async (file: JSZip.JSZipObject, name: string): Promise<string> => {
  const declared = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  const cap = name === ASSISTANT_BUNDLE_CONTEXT ? ASSISTANT_LIMITS.contextMaxBytes : ASSISTANT_BUNDLE_MAX_BYTES;
  if (typeof declared === 'number' && declared > cap) throw new AssistantBundleError('bundle_entry_too_large');
  const data = await file.async('uint8array');
  if (data.byteLength > cap) throw new AssistantBundleError('bundle_entry_too_large');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new AssistantBundleError(
      name === ASSISTANT_BUNDLE_CONTEXT ? 'bundle_invalid_context' : 'bundle_invalid_manifest'
    );
  }
};
