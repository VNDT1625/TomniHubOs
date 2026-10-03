/**
 * C1 source boundary regression: IDE provider paths must consume the shared
 * governed chat seam and may not recover raw provider discovery, credentials,
 * or network transport.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), 'utf8');

const assertNoRawProviderPath = (relativePath: string): void => {
  const source = read(relativePath);

  expect(source, relativePath).not.toContain('listReadyProviders');
  expect(source, relativePath).not.toContain('api_key');
  expect(source, relativePath).not.toMatch(/\bfetch\s*\(/u);
};

describe('IDE provider execution boundary', () => {
  it('routes IDE chat only through the shared provider broker', () => {
    const source = read('packages/package-apps/ide/src/process/workspace/ideProvider.ts');

    expect(source).toContain('createProviderChat');
    expect(source).toContain('runAgentChatMessages');
    assertNoRawProviderPath('packages/package-apps/ide/src/process/workspace/ideProvider.ts');
  });

  it('routes knowledge-graph chat through IDE brokered chat and disables unmanaged embeddings', () => {
    const source = read('packages/package-apps/ide/src/process/knowledge/graph/knowledgeGraphBridge.ts');

    expect(source).toContain("from '@package-apps/ide/process/workspace/ideProvider'");
    expect(source).toContain('runIdeChat(');
    expect(source).toContain('createDefaultEmbedder = async (): Promise<Embedder | null> => null');
    assertNoRawProviderPath('packages/package-apps/ide/src/process/knowledge/graph/knowledgeGraphBridge.ts');
  });
});
