/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, sign } from 'node:crypto';
import { readFile, readdir, rename, rm, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import semver from 'semver';
import { build, type Plugin } from 'vite';
import UnoCSS from 'unocss/vite';
import unoConfig from '../../uno.config';
import {
  packageSignaturePayload,
  type PackageManifest,
  type PackageModuleContribution,
} from '../../packages/desktop/src/common/packages';

import { loadPackageSigningKey, type PackageSigningKey } from './signing';

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_ROOT = path.resolve(process.env.TOMNI_PACKAGE_OUTPUT_ROOT ?? path.join(REPO_ROOT, 'store-artifacts'));
const BUILD_ROOT = path.join(OUTPUT_ROOT, '.package-build');
const RELEASE_BASE_URL = 'https://github.com/VNDT1625/OmniAgent/releases/download/tomni-store-v1';

type StaticPackageFile = {
  relativePath: string;
  content: string;
};

type PackageArtifactFormat = 'json-bundle' | 'tomny-zip';

type PackageDefinition = {
  id:
    | 'com.tomni.automation-studio'
    | 'com.tomni.design-studio'
    | 'com.tomni.document-studio'
    | 'com.tomni.ide'
    | 'com.tomni.runtime-pilot'
    | 'com.tomni.studio';
  entry?: string;
  staticFiles?: StaticPackageFile[];
  artifactFormat?: PackageArtifactFormat;
  name: string;
  description: string;
  bundleKind: 'single' | 'suite';
  permissions: string[];
  tags: string[];
  modules: PackageModuleContribution[];

  enginesTomni?: string;
};

const definitions: PackageDefinition[] = [
  {
    id: 'com.tomni.automation-studio',
    entry: 'packages/desktop/src/renderer/package-apps/automation/index.tsx',
    name: 'Automation Studio',
    description: 'An independently downloaded workflow builder for scheduled, agentic and connected automations.',
    bundleKind: 'single',
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
    tags: ['automation', 'workflows', 'agents', 'scheduling'],
    enginesTomni: '>=1.0.0',
    modules: [
      {
        id: 'automation',
        title: 'Automation Studio',
        surface: 'apps/automation-studio',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
    ],
  },
  {
    id: 'com.tomni.document-studio',
    entry: 'packages/desktop/src/renderer/package-apps/documentStudio.tsx',
    name: 'Document Studio',
    description: 'An independently downloaded workspace for files, Office documents and live collaboration.',
    bundleKind: 'single',
    permissions: ['workspace.read', 'workspace.write'],
    tags: ['documents', 'office', 'files', 'collaboration'],
    enginesTomni: '>=1.0.0',
    modules: [
      {
        id: 'document',
        title: 'Document Studio',
        surface: 'apps/document-studio',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
    ],
  },
  {
    id: 'com.tomni.design-studio',
    entry: 'packages/desktop/src/renderer/package-apps/design/index.tsx',
    name: 'Design Studio',
    description: 'An independently downloaded visual authoring and interactive presentation workspace powered by VIU.',
    bundleKind: 'single',
    permissions: ['workspace.read', 'workspace.write'],
    tags: ['design', 'visual-authoring', 'prototype', 'viu'],
    enginesTomni: '>=1.0.0',
    modules: [
      {
        id: 'design',
        title: 'Design Studio',
        surface: 'apps/design-studio',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
    ],
  },
  {
    id: 'com.tomni.ide',
    entry: 'packages/desktop/src/renderer/package-apps/ide.tsx',
    name: 'IDE',
    description: 'A full agentic development workspace downloaded and installed as a signed Tomny app package.',
    bundleKind: 'single',
    permissions: ['workspace.read', 'workspace.write', 'model.invoke', 'terminal.execute'],
    tags: ['ide', 'development', 'code', 'agentic'],
    modules: [
      {
        id: 'ide',
        title: 'IDE & App Builder',
        surface: 'apps/ide',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
    ],
  },
  {
    id: 'com.tomni.runtime-pilot',
    artifactFormat: 'tomny-zip',
    name: 'Runtime Capability Pilot',
    description: 'A minimal signed sandbox package that verifies the supervised host capability ABI.',
    bundleKind: 'single',
    permissions: ['host.ipc'],
    tags: ['runtime', 'security', 'capability', 'pilot'],
    modules: [
      {
        id: 'runtime-pilot',
        title: 'Runtime Capability Pilot',
        surface: 'apps/runtime-pilot',
        pinnable: false,
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
      },
    ],
    staticFiles: [
      {
        relativePath: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Runtime Capability Pilot</title></head>
  <body>
    <output id="status">Requesting runtime information…</output>
    <script>
      (() => {
        const requestId = 'runtime-info';
        window.parent.postMessage({ type: 'tomni.capability.invoke', requestId, capability: 'host.runtime.info' }, '*');
        window.addEventListener('message', (event) => {
          const message = event.data;
          if (!message || message.type !== 'tomni.capability.result' || message.requestId !== requestId) return;
          document.querySelector('#status').textContent = message.result?.ok ? 'Runtime ABI verified' : 'Runtime ABI unavailable';
        });
      })();
    </script>
  </body>
</html>
`,
      },
    ],
  },
  {
    id: 'com.tomni.studio',
    entry: 'packages/desktop/src/renderer/package-apps/studio.tsx',
    name: 'Studio',
    description: 'A production suite for documents, UI design, media creation and automation.',
    bundleKind: 'suite',
    permissions: ['workspace.read', 'workspace.write', 'model.invoke'],
    tags: ['studio', 'design', 'media', 'automation', 'documents'],
    modules: [
      {
        id: 'studio',
        title: 'Studio',
        surface: 'apps/studio',
        pinnable: true,
        runtime: 'trusted-react',
        entrypoint: 'app.js',
      },
      { id: 'editor', title: 'Universal Editor', surface: 'studio/editor', pinnable: true },
      { id: 'ui-designer', title: 'UI Designer', surface: 'studio/design', pinnable: true },
      { id: 'media', title: 'Media Studio', surface: 'studio/media', pinnable: true },
      { id: 'automation', title: 'Automation Builder', surface: 'studio/automation', pinnable: true },
    ],
  },
];

let atomicWriteSequence = 0;

const writeFileAtomically = async (targetPath: string, content: string | Buffer): Promise<void> => {
  atomicWriteSequence += 1;
  const temporaryPath = `${targetPath}.${process.pid}.${atomicWriteSequence}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const collectFiles = async (root: string): Promise<Array<{ relativePath: string; content: Buffer }>> => {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          relativePath: path.relative(root, absolutePath).replaceAll(path.sep, '/'),
          content: await readFile(absolutePath),
        });
      }
    }
  };
  await visit(root);
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const integrityFor = (files: Array<{ relativePath: string; content: Buffer }>) => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
    sizeBytes += file.content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

const artifactNameFor = (
  manifest: Pick<PackageManifest, 'id' | 'version'>,
  production: boolean,
  artifactFormat: PackageArtifactFormat = 'json-bundle'
): string =>
  artifactFormat === 'tomny-zip'
    ? `${manifest.id}-${manifest.version}${production ? '' : '.dev'}.tomny`
    : `${manifest.id}-${manifest.version}${production ? '' : '.dev'}.tomni-package.json`;

const isSafeStaticPackagePath = (relativePath: string): boolean => {
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  return (
    normalized === relativePath &&
    normalized !== '.' &&
    !normalized.startsWith('../') &&
    !normalized.startsWith('/') &&
    !path.win32.isAbsolute(relativePath)
  );
};

const writeStaticPackageFiles = async (outputDirectory: string, files: StaticPackageFile[]): Promise<void> => {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const file of files) {
    if (!isSafeStaticPackagePath(file.relativePath)) {
      throw new Error(`Static package payload path is invalid: ${file.relativePath}`);
    }
    const targetPath = path.join(outputDirectory, file.relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, 'utf8');
  }
};

type BuiltPackage = {
  manifest: PackageManifest;
  artifactName: string;
};

const buildPackage = async (
  definition: PackageDefinition,
  signingKey: PackageSigningKey,
  version: string
): Promise<BuiltPackage> => {
  const outputDirectory = path.join(BUILD_ROOT, definition.id);
  if (process.env.TOMNI_PACKAGE_SKIP_BUILD !== '1') {
    if (definition.staticFiles) {
      if (definition.entry) throw new Error(`${definition.id} cannot declare both an entry and static files.`);
      await writeStaticPackageFiles(outputDirectory, definition.staticFiles);
    } else {
      if (!definition.entry) throw new Error(`${definition.id} needs a build entry or static package files.`);
      const sourceClosure = new Set<string>();
      const sourceClosurePlugin: Plugin = {
        name: `tomni-source-closure:${definition.id}`,
        moduleParsed(moduleInfo) {
          const moduleId = moduleInfo.id.split('?', 1)[0];
          if (!moduleId || moduleId.includes('\0')) return;
          const absolutePath = path.normalize(moduleId);
          if (!path.isAbsolute(absolutePath)) return;
          const relativePath = path.relative(REPO_ROOT, absolutePath).replaceAll(path.sep, '/');
          const escaped = relativePath === '..' || relativePath.startsWith('../');
          const leakedHostPath = path.isAbsolute(relativePath) || /^[a-z]:/i.test(relativePath);
          if (!relativePath || escaped || leakedHostPath || relativePath.startsWith('node_modules/')) return;
          sourceClosure.add(relativePath);
        },
        generateBundle() {
          const inputs = Object.fromEntries([...sourceClosure].toSorted().map((input) => [input, {}]));
          this.emitFile({
            type: 'asset',
            fileName: 'metafile.json',
            source: `${JSON.stringify({ schemaVersion: 1, entry: definition.entry, inputs }, null, 2)}\n`,
          });
        },
      };
      await rm(outputDirectory, { recursive: true, force: true });
      await build({
        configFile: false,
        root: REPO_ROOT,
        publicDir: false,
        mode: 'production',
        plugins: [UnoCSS(unoConfig), sourceClosurePlugin],
        resolve: {
          alias: {
            '@': path.join(REPO_ROOT, 'packages/desktop/src'),
            '@common': path.join(REPO_ROOT, 'packages/desktop/src/common'),
            '@renderer': path.join(REPO_ROOT, 'packages/desktop/src/renderer'),
            '@process': path.join(REPO_ROOT, 'packages/desktop/src/process'),
            '@worker': path.join(REPO_ROOT, 'packages/desktop/src/process/worker'),
            streamdown: path.join(REPO_ROOT, 'node_modules/streamdown/dist/index.js'),
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
          dedupe: ['react', 'react-dom', 'react-router-dom'],
        },
        define: {
          'process.env.NODE_ENV': JSON.stringify('production'),
          'process.env.env': JSON.stringify(process.env.env),
          'process.env.TOMNY_MULTI_INSTANCE': JSON.stringify(''),
          'process.env.SENTRY_DSN': JSON.stringify(''),
          __APP_VERSION__: JSON.stringify('1.0.0'),
          global: 'globalThis',
        },
        build: {
          target: 'es2022',
          outDir: outputDirectory,
          emptyOutDir: true,
          minify: true,
          sourcemap: false,
          reportCompressedSize: false,
          cssCodeSplit: false,
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          lib: {
            entry: path.join(REPO_ROOT, definition.entry),
            formats: ['es'],
            fileName: () => 'app.js',
            cssFileName: 'style',
          },
          rollupOptions: {
            external: ['node:crypto', 'crypto'],
            output: { inlineDynamicImports: true, assetFileNames: '[name][extname]' },
            onwarn(warning, warn) {
              if (warning.code !== 'EVAL') warn(warning);
            },
          },
        },
      });
    }
  }
  const files = await collectFiles(outputDirectory);
  if (definition.entry) {
    const javascript = files.find((file) => file.relativePath === 'app.js')?.content.toString('utf8') ?? '';
    if (!javascript || /(?:from|import\()\s*["'](?:node:|crypto["'])/.test(javascript)) {
      throw new Error(`${definition.id} emitted an invalid browser package entrypoint.`);
    }
  }
  for (const module of definition.modules) {
    if (module.entrypoint && !files.some((file) => file.relativePath === module.entrypoint)) {
      throw new Error(`${definition.id} is missing module entrypoint ${module.entrypoint}.`);
    }
  }
  const hasStyle = files.some((file) => file.relativePath === 'style.css');
  const modules = definition.modules.map((module) =>
    module.runtime === 'trusted-react' && hasStyle ? { ...module, styleEntrypoint: 'style.css' } : module
  );
  const integrity = integrityFor(files);
  const unsignedManifest: PackageManifest = {
    schemaVersion: 1,
    id: definition.id,
    publisherId: 'com.tomni',
    name: definition.name,
    description: definition.description,
    type: 'app',
    bundleKind: definition.bundleKind,
    version,
    engines: { tomni: definition.enginesTomni ?? '>=0.0.0' },
    modules,
    permissions: definition.permissions,
    dependencies: [],
    tags: definition.tags,
    artifact: {
      ...integrity,
      signature: { algorithm: 'ed25519', keyId: signingKey.keyId, value: '' },
    },
  };
  const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), signingKey.privateKey).toString(
    'base64'
  );
  const manifest: PackageManifest = {
    ...unsignedManifest,
    artifact: {
      ...unsignedManifest.artifact!,
      signature: { ...unsignedManifest.artifact!.signature, value: signature },
    },
  };
  const artifactFormat = definition.artifactFormat ?? 'json-bundle';
  const artifactName = artifactNameFor(manifest, signingKey.production, artifactFormat);
  if (artifactFormat === 'tomny-zip') {
    const archive = new JSZip();
    archive.file('tomny-package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    for (const file of files) archive.file(file.relativePath, file.content);
    await writeFileAtomically(
      path.join(OUTPUT_ROOT, artifactName),
      await archive.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
        platform: 'UNIX',
      })
    );
  } else {
    const bundle = {
      format: 'tomni-package-bundle-v1',
      manifest,
      files: Object.fromEntries(files.map((file) => [file.relativePath, file.content.toString('base64')])),
    };
    await writeFileAtomically(path.join(OUTPUT_ROOT, artifactName), `${JSON.stringify(bundle, null, 2)}\n`);
  }
  return { manifest, artifactName };
};

const main = async (): Promise<void> => {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(BUILD_ROOT, { recursive: true });
  const signingKey = await loadPackageSigningKey();
  const requestedVersion = process.env.TOMNI_PACKAGE_VERSION?.trim() || '1.0.0';
  const version = semver.valid(requestedVersion);
  if (!version) throw new Error(`TOMNI_PACKAGE_VERSION must be a valid semantic version: ${requestedVersion}`);
  const requestedIds = new Set(
    (process.env.TOMNI_PACKAGE_TARGETS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const selectedDefinitions =
    requestedIds.size === 0 ? definitions : definitions.filter(({ id }) => requestedIds.has(id));
  if (selectedDefinitions.length === 0) throw new Error('TOMNI_PACKAGE_TARGETS did not match a package definition.');
  const packages: BuiltPackage[] = [];
  for (const definition of selectedDefinitions) packages.push(await buildPackage(definition, signingKey, version));
  let preservedPackages: Array<{ artifactUrl: string; manifest: PackageManifest }> = [];
  if (signingKey.production && selectedDefinitions.length !== definitions.length) {
    try {
      const previous = JSON.parse(
        await readFile(path.join(OUTPUT_ROOT, 'first-party-package-metadata.json'), 'utf8')
      ) as { packages?: Array<{ artifactUrl: string; manifest: PackageManifest }> };
      preservedPackages = (previous.packages ?? []).filter(
        ({ manifest }) => !selectedDefinitions.some(({ id }) => id === manifest.id)
      );
    } catch {
      preservedPackages = [];
    }
  }
  const builtPackages = packages.map(({ manifest, artifactName }) => {
    return {
      artifactUrl: signingKey.production ? `${RELEASE_BASE_URL}/${artifactName}` : artifactName,
      manifest,
    };
  });
  const metadata = {
    keyId: signingKey.keyId,
    publicKey: signingKey.publicKey,
    packages: [...preservedPackages, ...builtPackages].toSorted((left, right) =>
      left.manifest.id.localeCompare(right.manifest.id)
    ),
  };
  const metadataName = signingKey.production
    ? 'first-party-package-metadata.json'
    : 'first-party-package-metadata.dev.json';
  await writeFileAtomically(path.join(OUTPUT_ROOT, metadataName), `${JSON.stringify(metadata, null, 2)}\n`);
  await rm(BUILD_ROOT, { recursive: true, force: true });
  const sizes = await Promise.all(
    packages.map(async ({ manifest, artifactName }) => ({
      id: manifest.id,
      bytes: (await stat(path.join(OUTPUT_ROOT, artifactName))).size,
    }))
  );
  console.log(JSON.stringify({ ok: true, keyId: signingKey.keyId, production: signingKey.production, sizes }, null, 2));
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
