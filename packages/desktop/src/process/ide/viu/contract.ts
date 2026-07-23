/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildViuAgentPrompt, canonicalProjectJson, projectDigest } from './design';
import type { ViuPersistRequest, ViuPersistResult, ViuProject } from './types';

const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

const safeProjectId = (projectId: string): string => {
  const value = projectId
    .replace(/[^a-zA-Z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return value || 'project';
};

const withoutPreviewBytes = (project: ViuProject): ViuProject => {
  const { referencePreviewDataUrl: _preview, ...rest } = project;
  return {
    ...rest,
    documents: rest.documents.map(({ referencePreviewDataUrl: _documentPreview, ...document }) => document),
  };
};

/** Persist a content-addressed contract without ever overwriting an existing digest path. */
export const persistViuContract = async (
  request: ViuPersistRequest
): Promise<ViuPersistResult & { agentPrompt: string }> => {
  if (!isAbsolute(request.rootPath)) throw new Error('Viu requires an absolute project folder.');
  const rootPath = resolve(request.rootPath);
  if (!request.project.documents.length) throw new Error('The Viu project has no design document to persist.');
  const project = withoutPreviewBytes(request.project);
  const json = canonicalProjectJson(project);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_CONTRACT_BYTES) throw new Error('The Viu contract exceeds the 10 MB persistence limit.');
  const sha256 = projectDigest(project);
  const directory = join(rootPath, '.viu', 'contracts', safeProjectId(project.id));
  const path = join(directory, `${sha256}.json`);
  const rel = relative(rootPath, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('The Viu contract path escaped the selected workspace.');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path, json, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'EEXIST') throw error;
    const existing = await readFile(path, 'utf8');
    if (existing !== json) {
      throw new Error('An immutable Viu contract path already contains different data.', { cause: error });
    }
  }
  return { path, sha256, bytes, agentPrompt: buildViuAgentPrompt(project, path, sha256) };
};
