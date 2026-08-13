/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageCatalogEntry, PackageSigningKeyPolicy } from './types';

const RELEASE_BASE_URL = 'https://github.com/VNDT1625/OmniAgent/releases/download/tomni-store-v1';

export const DEFAULT_PACKAGE_CATALOG_URL = RELEASE_BASE_URL + '/catalog.json';
const IDE_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.ide-1.0.0.tomni-package.json`;
const STUDIO_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.studio-1.0.0.tomni-package.json`;
const DOCUMENT_STUDIO_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.document-studio-1.0.0.tomni-package.json`;
const DESIGN_STUDIO_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.design-studio-1.0.0.tomni-package.json`;
const CALCULATOR_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.calculator-1.0.0.tomni-package.json`;

export const FIRST_PARTY_PACKAGE_TRUSTED_KEYS: Readonly<Record<string, string>> = {
  'tomni-store-2026-01':
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAfXiwnPqWjZppEgDhGsvk8dZAGKrLuWOglARI0jO+Lls=\n-----END PUBLIC KEY-----\n',
  'tomni-store-2026-02':
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAi/hVs+0e8IpjBByOHNww44vumyggLsOLn4p7stxqRTI=\n-----END PUBLIC KEY-----\n',
};

export const FIRST_PARTY_PACKAGE_SIGNING_POLICIES: Readonly<Record<string, PackageSigningKeyPolicy>> = {
  'tomni-store-2026-01': {
    publicKey: FIRST_PARTY_PACKAGE_TRUSTED_KEYS['tomni-store-2026-01']!,
    publisherId: 'com.tomni',
    trust: 'signed-first-party',
  },
  'tomni-store-2026-02': {
    publicKey: FIRST_PARTY_PACKAGE_TRUSTED_KEYS['tomni-store-2026-02']!,
    publisherId: 'com.tomni',
    trust: 'signed-first-party',
  },
};

/**
 * The Store catalog contains only independently installable artifacts. IDE and
 * Studio are signed first-party packages and are absent from the base renderer
 * graph until the user downloads them.
 */
export const createFirstPartyPackageCatalog = (
  calculatorArtifactUrl = CALCULATOR_ARTIFACT_URL
): readonly PackageCatalogEntry[] => [
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: IDE_ARTIFACT_URL,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.ide',
      publisherId: 'com.tomni',
      name: 'IDE',
      description: 'A full agentic development workspace downloaded and installed as a signed Tomny app package.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'ide',
          title: 'IDE & App Builder',
          surface: 'apps/ide',
          pinnable: true,
          runtime: 'trusted-react',
          entrypoint: 'app.js',
          styleEntrypoint: 'style.css',
        },
      ],
      permissions: ['workspace.read', 'workspace.write', 'model.invoke', 'terminal.execute'],
      dependencies: [],
      tags: ['ide', 'development', 'code', 'agentic'],
      artifact: {
        integrity: 'sha256-6dad7783550dfcc8c0918e837518ae6a019e20fc37ff29a8fd5827a9ff911c00',
        sizeBytes: 26_387_978,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: 'Zsy29AAFV5OxFH1NCwd9w7RIhbMzxJgcTKGznTZP39La4OgYyu044CEjsjZfPc8f1Io0K/0XiXV2YxZO1F2gDw==',
        },
      },
    },
  },
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: DESIGN_STUDIO_ARTIFACT_URL,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.design-studio',
      publisherId: 'com.tomni',
      name: 'Design Studio',
      description:
        'An independently downloaded visual authoring and interactive presentation workspace powered by VIU.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'design',
          title: 'Design Studio',
          surface: 'apps/design-studio',
          pinnable: true,
          runtime: 'trusted-react',
          entrypoint: 'app.js',
          styleEntrypoint: 'style.css',
        },
      ],
      permissions: ['workspace.read', 'workspace.write'],
      dependencies: [],
      tags: ['design', 'visual-authoring', 'prototype', 'viu'],
      artifact: {
        integrity: 'sha256-2b480ab1933e8ccd901582816d92da5ec5853fcdeb7c5b07e4b7b9b2524d6684',
        sizeBytes: 5_315_160,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: 'os7iTblUEQl5l+pYL02EO3VVNygDQ3zyBShPf3HLWrKpNa04+V8fovKRRei6Mlg+bH3yf5zE8rWyYi7WcctnDw==',
        },
      },
    },
  },
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: DOCUMENT_STUDIO_ARTIFACT_URL,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.document-studio',
      publisherId: 'com.tomni',
      name: 'Document Studio',
      description: 'An independently downloaded workspace for files, Office documents and live collaboration.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'document',
          title: 'Document Studio',
          surface: 'apps/document-studio',
          pinnable: true,
          runtime: 'trusted-react',
          entrypoint: 'app.js',
          styleEntrypoint: 'style.css',
        },
      ],
      permissions: ['workspace.read', 'workspace.write'],
      dependencies: [],
      tags: ['documents', 'office', 'files', 'collaboration'],
      artifact: {
        integrity: 'sha256-ec67db6702148390ef535e4a4ce95f8298a9ce429b1e0b811e51c541556a049c',
        sizeBytes: 5_441_135,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: 'IDKHUAX3tk9wh2A9vqLBRC+1Ri5TdmxLPq16B8YZsosp2DPNJegHxNHIuJm6p+w/c4WBWPBOxJue1N4hSrR+CQ==',
        },
      },
    },
  },
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: STUDIO_ARTIFACT_URL,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.studio',
      publisherId: 'com.tomni',
      name: 'Studio',
      description: 'A production suite for documents, UI design, media creation and automation.',
      type: 'app',
      bundleKind: 'suite',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'studio',
          title: 'Studio',
          surface: 'apps/studio',
          pinnable: true,
          runtime: 'trusted-react',
          entrypoint: 'app.js',
          styleEntrypoint: 'style.css',
        },
        { id: 'editor', title: 'Universal Editor', surface: 'studio/editor', pinnable: true },
        { id: 'ui-designer', title: 'UI Designer', surface: 'studio/design', pinnable: true },
        { id: 'media', title: 'Media Studio', surface: 'studio/media', pinnable: true },
        { id: 'automation', title: 'Automation Builder', surface: 'studio/automation', pinnable: true },
      ],
      permissions: ['workspace.read', 'workspace.write', 'model.invoke'],
      dependencies: [],
      tags: ['studio', 'design', 'media', 'automation', 'documents'],
      artifact: {
        integrity: 'sha256-c8adfa918d6a85c8ce74f60985bfd0fe422c61ce56d6a1f2241d70952c14fb02',
        sizeBytes: 25_541_523,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: '56ocO6WgyCirLtuAvCQpRY9obg3bz4DqrMH7+PDw0CdOqsBtGO2sY6m+TAMKIosOMNjc2FELlQZoAdKpToE9Ag==',
        },
      },
    },
  },
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: calculatorArtifactUrl,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.calculator',
      publisherId: 'com.tomni',
      name: 'Calculator',
      description: 'A secure calculator whose interface and logic are downloaded as a signed Tomny package.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'calculator',
          title: 'Calculator',
          surface: 'apps/calculator',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['calculator', 'productivity', 'offline'],
      artifact: {
        integrity: 'sha256-4d54478e4b0795c63bf7688bcdb8f6e5ee4184991c2126981cc9979cc3880edf',
        sizeBytes: 3656,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-01',
          value: 'Mp8GH7Y9+WVO1p0zggLaXjKcckwoYb7hYqIGKQwQmmf8rZVlygbzzHR0KCEX1rRsEqneHG9CELs4J++z5gHXBA==',
        },
      },
    },
  },
];

export const FIRST_PARTY_PACKAGE_CATALOG = createFirstPartyPackageCatalog();
