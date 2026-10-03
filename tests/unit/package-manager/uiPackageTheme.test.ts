/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { packageManifestSchema } from '@/common/packages/manifest';
import { FIRST_PARTY_PACKAGE_CATALOG } from '@/common/packages/catalog';

describe('UI Package & Theme Contributions Contract', () => {
  it('validates a package manifest of type "ui" with theme contributions', () => {
    const rawManifest = {
      schemaVersion: 1,
      id: 'com.tomni.theme.test-custom-ui',
      publisherId: 'com.tomni',
      name: 'Test Custom UI Theme',
      description: 'A test UI theme package for TomniHubOS.',
      type: 'ui',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [],
      contributions: {
        version: 1,
        themes: [
          {
            id: 'test-custom-theme-1',
            name: 'Custom Glassmorphic Dark',
            cover: 'https://example.com/cover.png',
            css: '[data-theme="dark"] { --color-bg-1: #000; }',
          },
        ],
      },
      permissions: [],
      dependencies: [],
      tags: ['ui', 'theme'],
    };

    const parseResult = packageManifestSchema.safeParse(rawManifest);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.type).toBe('ui');
      expect(parseResult.data.contributions?.themes).toHaveLength(1);
      expect(parseResult.data.contributions?.themes?.[0].id).toBe('test-custom-theme-1');
      expect(parseResult.data.contributions?.themes?.[0].name).toBe('Custom Glassmorphic Dark');
    }
  });

  it('verifies that FIRST_PARTY_PACKAGE_CATALOG includes com.tomni.theme.obsidian-book', () => {
    const obsidianPkg = FIRST_PARTY_PACKAGE_CATALOG.find(
      (entry) => entry.manifest.id === 'com.tomni.theme.obsidian-book'
    );
    expect(obsidianPkg).toBeDefined();
    expect(obsidianPkg?.manifest.type).toBe('ui');
    expect(obsidianPkg?.manifest.contributions?.themes).toBeDefined();
    expect(obsidianPkg?.manifest.contributions?.themes?.length).toBeGreaterThan(0);

    const theme = obsidianPkg?.manifest.contributions?.themes?.[0];
    expect(theme?.id).toBe('retroma-obsidian-book-pkg');
    expect(theme?.name).toContain('Obsidian Book');
    expect(theme?.css).toContain('--color-bg-1');
  });

  it('rejects duplicate theme ids within the same package contributions', () => {
    const invalidManifest = {
      schemaVersion: 1,
      id: 'com.tomni.theme.duplicate-test',
      publisherId: 'com.tomni',
      name: 'Duplicate Test',
      description: 'Duplicate test',
      type: 'ui',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [],
      contributions: {
        version: 1,
        themes: [
          { id: 'dup-id', name: 'Theme 1', css: 'body {}' },
          { id: 'dup-id', name: 'Theme 2', css: 'body {}' },
        ],
      },
      permissions: [],
      dependencies: [],
      tags: ['ui'],
    };

    const parseResult = packageManifestSchema.safeParse(invalidManifest);
    expect(parseResult.success).toBe(false);
  });
});
