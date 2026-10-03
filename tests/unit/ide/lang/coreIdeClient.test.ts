/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providers: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => {
      const invoke = vi.fn(async (request: unknown) => ({ ok: true, data: request }));
      mocks.providers.set(channel, invoke);
      return { invoke };
    },
  },
}));

import { CoreIdeBridgeTimeoutError, coreIdeClient } from '../../../../packages/package-apps/ide/src/coreIdeClient';

const invocation = (channel: string): ReturnType<typeof vi.fn> => {
  const provider = mocks.providers.get(channel);
  if (!provider) throw new Error(`Missing mocked core IDE provider for ${channel}`);
  return provider;
};

const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });

beforeEach(() => {
  for (const provider of mocks.providers.values()) provider.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('IDE Package client', () => {
  it('registers only the nine bounded capabilities used by the IDE Package', () => {
    expect([...mocks.providers.keys()].toSorted()).toEqual([
      'ide.inline-complete',
      'ide.kg-context',
      'ide.kg-get',
      'ide.kg-refresh-file',
      'ide.lint-file',
      'ide.repo-secret-render-markers',
      'ide.spec-status',
      'ide.spec-task-claim',
      'ide.spec-task-list',
    ]);
  });

  it('keeps full IDE client imports inside package-owned Studio sources', () => {
    const rendererRoot = join(process.cwd(), 'packages/desktop/src/renderer');
    const violations = collectSourceFiles(rendererRoot)
      .filter((filePath) => !relative(rendererRoot, filePath).replaceAll('\\', '/').startsWith('pages/studio/'))
      .flatMap((filePath) => {
        const source = readFileSync(filePath, 'utf8');
        if (!/\bfrom\s+'[^']*studio\/ide\/(?:ideClient|planningGuard)'/.test(source)) return [];
        return [relative(rendererRoot, filePath).replaceAll('\\', '/')];
      });

    expect(violations).toEqual([]);
  });

  it('preserves knowledge and editor request envelopes', async () => {
    await coreIdeClient.kgContext('C:\\repo', 'find auth', ['safe'], true);
    await coreIdeClient.kgRefreshFile('C:\\repo', 'src/auth.ts', 'export const auth = true;');
    await coreIdeClient.lintFile('C:\\repo\\src\\auth.ts', 'C:\\repo');

    expect(invocation('ide.kg-context')).toHaveBeenCalledWith({
      rootPath: 'C:\\repo',
      request: 'find auth',
      rules: ['safe'],
      includeDiff: true,
    });
    expect(invocation('ide.kg-refresh-file')).toHaveBeenCalledWith({
      rootPath: 'C:\\repo',
      relPath: 'src/auth.ts',
      content: 'export const auth = true;',
    });
    expect(invocation('ide.lint-file')).toHaveBeenCalledWith({
      filePath: 'C:\\repo\\src\\auth.ts',
      rootPath: 'C:\\repo',
    });
  });

  it('preserves planning and explicit secret-render request envelopes', async () => {
    await coreIdeClient.specTaskClaim('C:\\repo', 'fix-auth', 't001', 'chat-agent');
    await coreIdeClient.specTaskList('C:\\repo', 'fix-auth');
    await coreIdeClient.repoSecretRenderMarkers('C:\\repo', 'token={{secret:TOKEN}}');

    expect(invocation('ide.spec-task-claim')).toHaveBeenCalledWith({
      rootPath: 'C:\\repo',
      slug: 'fix-auth',
      taskId: 't001',
      agentId: 'chat-agent',
    });
    expect(invocation('ide.spec-task-list')).toHaveBeenCalledWith({ rootPath: 'C:\\repo', slug: 'fix-auth' });
    expect(invocation('ide.repo-secret-render-markers')).toHaveBeenCalledWith({
      repository: 'C:\\repo',
      text: 'token={{secret:TOKEN}}',
    });
  });

  it('fails closed when an inline completion provider never replies', async () => {
    vi.useFakeTimers();
    invocation('ide.inline-complete').mockImplementationOnce(() => new Promise(() => undefined));

    const pending = coreIdeClient.inlineComplete({
      prefix: 'const value =',
      suffix: '',
      language: 'typescript',
      filePath: 'C:\\repo\\src\\a.ts',
    });
    const rejection = expect(pending).rejects.toBeInstanceOf(CoreIdeBridgeTimeoutError);
    await vi.advanceTimersByTimeAsync(8_001);

    await rejection;
  });
});
