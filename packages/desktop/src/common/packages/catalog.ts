/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageCatalogEntry, PackageSigningKeyPolicy } from './types';

const RELEASE_BASE_URL = 'https://github.com/VNDT1625/tomni-hub-agent-os/releases/download/tomni-store-v1';

export const DEFAULT_PACKAGE_CATALOG_URL = RELEASE_BASE_URL + '/catalog.json';
const STUDIO_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.studio-1.0.0.tomni-package.json`;
const DOCUMENT_STUDIO_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.document-studio-1.0.0.tomni-package.json`;
const AUTOMATION_STUDIO_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.automation-studio-1.0.0.tomni-package.json`;
const BROWSER_ARTIFACT_URL = `${RELEASE_BASE_URL}/com.tomni.browser-1.0.0.tomni-package.json`;
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

const DEFAULT_SURFACE_PACKAGE_IDS = new Set(['com.tomni.ide']);

/** Browser and IDE are base surfaces, never Store catalog products. */
export const excludeDefaultSurfaceCatalogEntries = (
  entries: readonly PackageCatalogEntry[]
): readonly PackageCatalogEntry[] => entries.filter((entry) => !DEFAULT_SURFACE_PACKAGE_IDS.has(entry.manifest.id));

/**
 * The Store catalog contains only independently installable artifacts. Browser
 * and IDE are default base surfaces and are never Store downloads.
 */
export const createFirstPartyPackageCatalog = (
  calculatorArtifactUrl = CALCULATOR_ARTIFACT_URL
): readonly PackageCatalogEntry[] => [
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
      contributions: { version: 1, apps: [{ id: 'design', title: 'Design Studio', moduleId: 'design' }] },
      permissions: ['workspace.read', 'workspace.write'],
      dependencies: [],
      mainContributions: [{ schemaVersion: 1, id: 'design-viu-v1' }],
      tags: ['design', 'visual-authoring', 'prototype', 'viu'],
      artifact: {
        integrity: 'sha256-08c3027ebc866ed231b24768f777bf79d0faaef98ff224431b843258b2f6aca1',
        sizeBytes: 6_140_620,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: 't4HsGHBKJSvUozXthVImObHgJO9Y4KqFwWvgXNhfEZNMqjYLsy+Epj9Y18138Etic/r+aUCVllc2RDwPz0NTAg==',
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
      contributions: { version: 1, apps: [{ id: 'document', title: 'Document Studio', moduleId: 'document' }] },
      permissions: ['workspace.read', 'workspace.write'],
      dependencies: [],
      tags: ['documents', 'office', 'files', 'collaboration'],
      artifact: {
        integrity: 'sha256-7a4112a095f1a9d81dabdd8f79a46979349a5ce964443b80bf90882dac9d6724',
        sizeBytes: 5_491_661,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: 'PLx+9Ftq0ae4rEH8Iy7K+IpH7LJgCAMCdREQ5y/l2oy7xoQ0rqI6u2JG2r1yj7MjYqV6JytBv+y+/Arxu9fxAw==',
        },
      },
    },
  },
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: AUTOMATION_STUDIO_ARTIFACT_URL,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.automation-studio',
      publisherId: 'com.tomni',
      name: 'Automation Studio',
      description: 'An independently downloaded workflow builder for scheduled, agentic and connected automations.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'automation',
          title: 'Automation Studio',
          surface: 'apps/automation-studio',
          pinnable: true,
          runtime: 'trusted-react',
          entrypoint: 'app.js',
          styleEntrypoint: 'style.css',
        },
      ],
      contributions: {
        version: 1,
        apps: [{ id: 'automation', title: 'Automation Studio', moduleId: 'automation' }],
      },
      permissions: [
        'agent.invoke',
        'automation.execute',
        'browser.control',
        'credentials.manage',
        'model.invoke',
        'network.access',
        'notifications.show',
        'scheduler.manage',
        'workspace.read',
        'workspace.write',
      ],
      dependencies: [],
      tags: ['automation', 'workflows', 'agents', 'scheduling'],
      artifact: {
        integrity: 'sha256-4d840301033e4f52638e2fb5961712bfc97fe05307f3fa8a4d929f71a319c388',
        sizeBytes: 5473394,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: 'lucOFphPPFyxw436gRdMTGP0z/9HaaRF1jky1+HCpMinK+4ZdbIslJgLm+dBFQ7zFXDJ8j/vB/dAy/9snxPKCw==',
        },
      },
    },
  },
  {
    delivery: 'downloaded-package',
    trust: 'signed-first-party',
    artifactUrl: BROWSER_ARTIFACT_URL,
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.browser',
      publisherId: 'com.tomni',
      name: 'Browser',
      description: 'A signed embedded browser and web-agent workspace installed as a package.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'browser',
          title: 'Browser',
          surface: 'apps/browser',
          pinnable: true,
          runtime: 'trusted-react',
          entrypoint: 'app.js',
        },
      ],
      contributions: {
        version: 1,
        apps: [{ id: 'browser', title: 'Browser', moduleId: 'browser' }],
      },
      permissions: ['browser.control', 'network.access', 'model.invoke'],
      dependencies: [],
      tags: ['browser', 'web-agent', 'research'],
      artifact: {
        integrity: 'sha256-ed29dd1cb8295155b9674af877c6fde0dd17b0d3ea922fdf32bbd02f5b4deecc',
        sizeBytes: 794461,
        signature: {
          algorithm: 'ed25519',
          keyId: 'tomni-store-2026-02',
          value: '3koaupJMQ5s1K2of3XajZyiRP2Ue2dIxHBYBC9klGtRzMxGTbAJ3xw31NCmePfATVoSvVxbQ27N/6NmElddqAQ==',
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
    // The static fallback catalog is compiled into the signed desktop app. This
    // review binds the permissionless Calculator artifact to its deterministic
    // sandboxed-web inspection, so Main can admit its runtime offline.
    publicationReview: {
      schemaVersion: 2,
      disposition: 'auto-approved',
      fingerprint: 'sha256-da54bd7062be8eed54c0de7b09142b8cbb036f6f60e7487934a58d6f95a9c279',
      artifactIntegrity: 'sha256-4d54478e4b0795c63bf7688bcdb8f6e5ee4184991c2126981cc9979cc3880edf',
      reviewedAt: '2026-09-06T00:00:00.000Z',
    },
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
  {
    delivery: 'bundled-package',
    trust: 'trusted-first-party',
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.theme.obsidian-book',
      publisherId: 'com.tomni',
      name: 'Retroma Obsidian Book UI',
      description: 'A bespoke high-contrast Obsidian Book UI theme package for TomniHubOS.',
      type: 'ui',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [],
      contributions: {
        version: 1,
        themes: [
          {
            id: 'retroma-obsidian-book-pkg',
            name: 'Retroma Obsidian Book (Package UI)',
            css: "[data-theme='dark'] { --color-bg-1: #0e1117; --color-bg-2: #161b22; --color-bg-3: #21262d; --color-border-2: #30363d; --color-primary: #58a6ff; }",
          },
        ],
      },
      permissions: [],
      dependencies: [],
      tags: ['ui', 'theme', 'obsidian', 'dark'],
    },
  },
];

export const FIRST_PARTY_PACKAGE_CATALOG = createFirstPartyPackageCatalog();
