import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import UnoCSS from 'unocss/vite';
import unoConfig from '../../uno.config.ts';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import type { Plugin, ViteDevServer } from 'vite';
import {
  DEFAULT_PACKAGE_CATALOG_URL,
  excludeDefaultSurfaceCatalogEntries,
  FIRST_PARTY_PACKAGE_CATALOG,
  FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
} from './src/common/packages';
import {
  createLocalPackageMutationRuntime,
  createPackageHttpApi,
  isSameOriginPackageMutationRequest,
} from './src/process/extensions/package-manager/packageHttpApi';
import { createPackageManagerService } from './src/process/extensions/package-manager/PackageManagerService';

import { createRemotePackageCatalogLoader } from './src/process/extensions/package-manager/remoteCatalog';

// Read the real Tomny version from the repo-root package.json.
// `packages/desktop/package.json` is a workspace-internal placeholder pinned
// at "0.0.0" — never use it for user-visible version strings.
const rootPackageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8').replace(/^\uFEFF/, '')
) as {
  version: string;
};

const useLocalDevelopmentStoreArtifacts = process.env.TOMNI_STORE_LOCAL_ARTIFACTS === '1';

// Build builtin MCP servers after main process bundle so they survive out/main/ cleanup.
function buildMcpServersPlugin() {
  return {
    name: 'vite-plugin-build-mcp-servers',
    closeBundle() {
      execSync(`node "${resolve('scripts/build-mcp-servers.js')}"`, { stdio: 'inherit' });
    },
  };
}

function devPackageApiPlugin(): Plugin {
  let activePort: number | undefined;
  const artifactPaths = new Map<string, string>([
    ...excludeDefaultSurfaceCatalogEntries(FIRST_PARTY_PACKAGE_CATALOG).flatMap((entry) => {
      if (!entry.artifactUrl) return [] as const;
      const filename = new URL(entry.artifactUrl).pathname.split('/').at(-1);
      return filename ? [[filename, resolve('store-artifacts', filename)] as const] : ([] as const);
    }),
    ...(useLocalDevelopmentStoreArtifacts
      ? [
          [
            'com.tomni.pet-1.0.0.dev.tomni-package.json',
            resolve('store-artifacts', 'com.tomni.pet-1.0.0.dev.tomni-package.json'),
          ] as const,
        ]
      : ([] as const)),
  ]);
  const packageRoot = join(homedir(), '.tomny-web-dev', 'tomny-packages');

  const remoteCatalogLoader = createRemotePackageCatalogLoader({
    url: process.env.TOMNI_STORE_CATALOG_URL ?? DEFAULT_PACKAGE_CATALOG_URL,
    cachePath: join(packageRoot, 'catalog-cache.json'),
    fallbackCatalog: excludeDefaultSurfaceCatalogEntries(FIRST_PARTY_PACKAGE_CATALOG),
    trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
    signingPolicies: FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
  });
  const service = createPackageManagerService({
    rootDir: packageRoot,
    appVersion: rootPackageJson.version,
    catalog: excludeDefaultSurfaceCatalogEntries(FIRST_PARTY_PACKAGE_CATALOG),
    trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,

    catalogLoader: async () => excludeDefaultSurfaceCatalogEntries(await remoteCatalogLoader()),
    resolveArtifactUrl: (url) => {
      const filename = new URL(url).pathname.split('/').at(-1);
      return useLocalDevelopmentStoreArtifacts && activePort && filename && artifactPaths.has(filename)
        ? `http://127.0.0.1:${activePort}/api/packages/artifacts/${encodeURIComponent(filename)}`
        : url;
    },
    allowLocalArtifactUrls: useLocalDevelopmentStoreArtifacts,
  });
  const mutation = createLocalPackageMutationRuntime({
    service,
    ledgerRootDir: join(packageRoot, 'catalog-action-ledger'),
  });
  const handler = createPackageHttpApi({
    service,
    mutation,
    authorize: async () => true,
    authorizeMutation: isSameOriginPackageMutationRequest,
    artifactProvider: async (name) => {
      const artifactPath = artifactPaths.get(name);
      return artifactPath ? Buffer.from(readFileSync(artifactPath)) : undefined;
    },
  });
  return {
    name: 'vite-plugin-tomny-package-api',
    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        activePort = address && typeof address !== 'string' ? address.port : undefined;
      });
      server.middlewares.use((request, response, next) => {
        void handler(request, response).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}

// Icon Park transform plugin (replaces webpack icon-park-loader)
function iconParkPlugin() {
  return {
    name: 'vite-plugin-icon-park',
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return null;
      if (!source.includes('@icon-park/react')) return null;
      const transformedSource = source.replace(
        /import\s+\{\s+([a-zA-Z, ]*)\s+\}\s+from\s+['"]@icon-park\/react['"](;?)/g,
        function (str, match) {
          if (!match) return str;
          // Parse each specifier, supporting aliased imports (`Original as Local`).
          // The temp name is derived from the *local* name so two aliases of the
          // same icon never collide, and the HOC binds to the local name the file
          // actually references.
          const specs = match
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .map((spec: string) => {
              const [original, alias] = spec.split(/\s+as\s+/);
              const local = (alias ?? original).trim();
              return { original: original.trim(), local, temp: `_${local}` };
            });
          const importComponent = `import { ${specs.map((s: { original: string; temp: string }) => `${s.original} as ${s.temp}`).join(', ')} } from '@icon-park/react'`;
          const hoc = `import IconParkHOC from '@renderer/components/IconParkHOC';
          ${specs.map((s: { local: string; temp: string }) => `const ${s.local} = IconParkHOC(${s.temp})`).join(';\n')}`;
          return importComponent + ';' + hoc;
        }
      );
      if (transformedSource !== source) return { code: transformedSource, map: null } as { code: string; map: null };
      return null;
    },
  };
}

// Common path aliases for main process and workers
const desktopSrcRoot = resolve('packages/desktop/src');
const rendererRoot = resolve('packages/desktop/src/renderer');

const packageAppAliases = {
  '@package-apps/ide': resolve('packages/package-apps/ide/src'),
  '@package-apps/design': resolve('packages/package-apps/design/src'),
  '@package-apps/document-studio': resolve('packages/package-apps/document-studio/src'),
  '@package-apps/browser': resolve('packages/package-apps/browser/src'),
  '@package-apps/shared': resolve('packages/package-apps/shared'),
};

const mainAliases = {
  ...packageAppAliases,
  '@': desktopSrcRoot,
  '@common': resolve('packages/desktop/src/common'),
  '@renderer': rendererRoot,
  '@process': resolve('packages/desktop/src/process'),
  '@worker': resolve('packages/desktop/src/process/worker'),
  '@xterm/headless': resolve('packages/desktop/src/common/utils/shims/xterm-headless.ts'),
};

function rendererGraphEvidencePlugin(): Plugin {
  const repoRoot = resolve(__dirname, '../..');
  const portable = (moduleId: string): string | undefined => {
    const cleanId = moduleId.split('?', 1)[0];
    if (!cleanId || !isAbsolute(cleanId)) return undefined;
    const relativePath = relative(repoRoot, cleanId).split(sep).join('/');
    if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) return undefined;
    return relativePath;
  };
  return {
    name: 'tomni-renderer-graph-evidence',
    generateBundle(_options, bundle) {
      const modules = Object.fromEntries(
        [...this.getModuleIds()]
          .flatMap((moduleId) => {
            const id = portable(moduleId);
            const info = this.getModuleInfo(moduleId);
            if (!id || !info) return [];
            const normalize = (ids: readonly string[]) =>
              ids
                .flatMap((candidate) => {
                  const normalized = portable(candidate);
                  return normalized ? [normalized] : [];
                })
                .toSorted();
            return [
              [
                id,
                {
                  imports: normalize(info.importedIds),
                  dynamicImports: normalize(info.dynamicallyImportedIds),
                  importers: normalize(info.importers),
                  dynamicImporters: normalize(info.dynamicImporters),
                  isEntry: info.isEntry,
                },
              ] as const,
            ];
          })
          .toSorted(([left], [right]) => left.localeCompare(right))
      );
      const outputs = Object.fromEntries(
        Object.entries(bundle).map(([fileName, output]) => {
          if (output.type === 'asset') {
            const bytes =
              typeof output.source === 'string' ? Buffer.byteLength(output.source) : output.source.byteLength;
            return [fileName, { type: 'asset', bytes }];
          }
          return [
            fileName,
            {
              type: 'chunk',
              bytes: Buffer.byteLength(output.code),
              isEntry: output.isEntry,
              isDynamicEntry: output.isDynamicEntry,
              modules: Object.fromEntries(
                Object.entries(output.modules).flatMap(([moduleId, size]) => {
                  const id = portable(moduleId);
                  return id ? [[id, size.renderedLength] as const] : [];
                })
              ),
            },
          ];
        })
      );
      const totalBytes = Object.values(outputs).reduce((sum, output) => sum + output.bytes, 0);
      const evidence = {
        schemaVersion: 1,
        mode: 'production',
        entry: 'packages/desktop/src/renderer/main.tsx',
        totalBytes,
        modules,
        outputs,
      };
      const evidenceDirectory = resolve(repoRoot, 'store-artifacts');
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        resolve(evidenceDirectory, 'base-renderer-metafile.json'),
        `${JSON.stringify(evidence, null, 2)}\n`
      );
      const moduleIds = Object.keys(modules);
      const outputEntries = Object.entries(outputs);
      const studioPathModules = moduleIds.filter((id) => id.startsWith('packages/desktop/src/renderer/pages/studio/'));
      const sharedBaseInfrastructurePaths = new Set<string>();
      const bytesForSuffix = (suffix: string): number =>
        outputEntries.reduce((sum, [fileName, output]) => sum + (fileName.endsWith(suffix) ? output.bytes : 0), 0);
      const baseline = {
        schemaVersion: 1,
        mode: 'production',
        methodology: 'Vite production renderer Rollup graph; uncompressed emitted bytes',
        totalBytes,
        javascriptBytes: bytesForSuffix('.js'),
        cssBytes: bytesForSuffix('.css'),
        otherAssetBytes: totalBytes - bytesForSuffix('.js') - bytesForSuffix('.css'),
        moduleCount: moduleIds.length,
        outputCount: outputEntries.length,
        packageOwnerModules: moduleIds.filter(
          (id) =>
            id.startsWith('packages/desktop/src/renderer/package-apps/') || id.startsWith('packages/package-apps/')
        ),
        designOwnerModules: moduleIds.filter(
          (id) =>
            id.startsWith('packages/desktop/src/renderer/package-apps/design/') ||
            id.startsWith('packages/package-apps/design/')
        ),
        documentOwnerModules: moduleIds.filter((id) => /package-apps\/(?:Document|document)/.test(id)),
        viuModules: moduleIds.filter(
          (id) =>
            id.startsWith('packages/desktop/src/renderer/package-apps/design/viu/') ||
            id.startsWith('packages/package-apps/design/src/renderer/viu/')
        ),
        remainingStudioModules: studioPathModules,
        sharedBaseInfrastructureModules: studioPathModules.filter((id) => sharedBaseInfrastructurePaths.has(id)),
        optionalStudioModules: studioPathModules.filter((id) => !sharedBaseInfrastructurePaths.has(id)),
      };
      writeFileSync(
        resolve(evidenceDirectory, 'base-renderer-baseline.json'),
        `${JSON.stringify(baseline, null, 2)}\n`
      );
    },
  };
}

/** Emits the exact main-process module graph used by the optional-package release audit. */
function mainGraphEvidencePlugin(): Plugin {
  const repoRoot = resolve(__dirname, '../..');
  const portable = (moduleId: string): string | undefined => {
    const cleanId = moduleId.split('?', 1)[0];
    if (!cleanId || !isAbsolute(cleanId)) return undefined;
    const relativePath = relative(repoRoot, cleanId).split(sep).join('/');
    if (!relativePath || relativePath === '..' || relativePath.startsWith('../')) return undefined;
    return relativePath;
  };
  return {
    name: 'tomni-main-graph-evidence',
    generateBundle(_options, bundle) {
      const modules = Object.fromEntries(
        [...this.getModuleIds()]
          .flatMap((moduleId) => {
            const id = portable(moduleId);
            const info = this.getModuleInfo(moduleId);
            if (!id || !info) return [];
            const normalize = (ids: readonly string[]) =>
              ids
                .flatMap((candidate) => {
                  const normalized = portable(candidate);
                  return normalized ? [normalized] : [];
                })
                .toSorted();
            return [
              [
                id,
                {
                  imports: normalize(info.importedIds),
                  dynamicImports: normalize(info.dynamicallyImportedIds),
                  importers: normalize(info.importers),
                  dynamicImporters: normalize(info.dynamicImporters),
                  isEntry: info.isEntry,
                },
              ] as const,
            ];
          })
          .toSorted(([left], [right]) => left.localeCompare(right))
      );
      const outputs = Object.fromEntries(
        Object.entries(bundle).map(([fileName, output]) => [
          fileName,
          output.type === 'chunk'
            ? {
                type: 'chunk',
                modules: Object.fromEntries(Object.keys(output.modules).map((moduleId) => [moduleId, {}])),
              }
            : { type: 'asset' },
        ])
      );
      const evidenceDirectory = resolve(repoRoot, 'store-artifacts');
      mkdirSync(evidenceDirectory, { recursive: true });
      writeFileSync(
        resolve(evidenceDirectory, 'base-main-metafile.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            mode: 'production',
            entry: 'packages/desktop/src/index.ts',
            modules,
            outputs,
          },
          null,
          2
        )}\n`
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const enableSentrySourceMaps = !isDevelopment && !!process.env.SENTRY_AUTH_TOKEN;
  const webDevProxy = process.env.TOMNI_WEB_DEV_PROXY?.trim();

  const sentryPluginOptions = {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    sourcemaps: {
      filesToDeleteAfterUpload: ['./out/**/*.map'],
      rewriteSources: (source: string) => {
        // Normalize Windows backslashes and strip leading relative prefixes
        // so Sentry paths match the GitHub repo structure (e.g.
        // packages/desktop/src/process/...)
        return source.replace(/\\/g, '/').replace(/^(\.\.\/)+(packages\/desktop\/src\/)/, '$2');
      },
    },
  };

  return {
    main: {
      plugins: [
        // externalizeDepsPlugin replaces our custom getExternalDeps() + pluginExternalizeDynamicImports.
        // 'fix-path' excluded so it gets bundled inline (only 3KB).
        // '@tomny/web-host' and '@tomny/music-core' excluded so their TS sources (which use
        // extensionless / ESM ".js" import specifiers) are bundled by esbuild rather than left as
        // `require(...)`, which Node cannot resolve because these workspace-only packages ship no
        // compiled .js files and point `exports` straight at `./src/index.ts`.
        externalizeDepsPlugin({ exclude: ['fix-path', '@tomny/web-host', '@tomny/music-core'] }),
        ...(process.env.TOMNI_MAIN_GRAPH_EVIDENCE === '1' ? [mainGraphEvidencePlugin()] : []),
        ...(isDevelopment
          ? [
              {
                name: 'dev-build-mcp-servers',
                closeBundle() {
                  execSync(`node "${resolve(__dirname, '../../scripts/build-mcp-servers.js')}"`, {
                    stdio: 'inherit',
                  });
                },
              },
            ]
          : []),
        ...(!isDevelopment
          ? [
              viteStaticCopy({
                structured: false,
                // electron-vite builds main process as SSR; viteStaticCopy defaults
                // to environment: "client" and silently skips non-client environments.
                environment: 'ssr',
                targets: [
                  // Use single * glob to copy top-level items (directories) with their contents intact.
                  // Using ** would flatten all nested files into the dest root.
                  { src: 'packages/desktop/src/renderer/assets/logos/*', dest: 'static/images' },
                ],
              }),
            ]
          : []),
        ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
        ...(isDevelopment ? [buildMcpServersPlugin()] : []),
      ],
      resolve: { alias: mainAliases, extensions: ['.ts', '.tsx', '.js', '.json'] },
      build: {
        sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('packages/desktop/src/index.ts'),
            // Built-in MCP server entry points (compiled by scripts/build-mcp-servers.js via esbuild,
            // not vite — esbuild bundles all deps for self-contained execution by external node processes)
          },
          onwarn(warning, warn) {
            if (warning.code === 'EVAL') return;
            warn(warning);
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.env': JSON.stringify(process.env.env),
        'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
      },
    },

    preload: {
      // Bundle @sentry/electron/preload so its hookupIpc() runs in the preload
      // context. Externalized dependencies leave a runtime require('...') in
      // the output, which Electron's sandbox-mode preload cannot resolve from
      // node_modules (→ "module not found"). Bundling inlines the few hundred
      // bytes of IPC wiring we actually need.
      plugins: [externalizeDepsPlugin({ exclude: ['@sentry/electron', 'zod', 'semver'] })],
      resolve: {
        alias: {
          ...packageAppAliases,
          '@': resolve('packages/desktop/src'),
          '@common': resolve('packages/desktop/src/common'),
        },
        extensions: ['.ts', '.tsx', '.js', '.json'],
      },
      build: {
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('packages/desktop/src/preload/main.ts'),
            petPreload: resolve('packages/desktop/src/preload/petPreload.ts'),
            petHitPreload: resolve('packages/desktop/src/preload/petHitPreload.ts'),
            petConfirmPreload: resolve('packages/desktop/src/preload/petConfirmPreload.ts'),
          },
        },
      },
    },

    renderer: {
      // The renderer workspace moved under packages/desktop/src/renderer in M1.
      // Make the root explicit so Vite emits page names relative to that directory
      // instead of leaking source-relative ../../ paths into HTML asset names.
      root: rendererRoot,
      envDir: resolve(__dirname, '../..'),
      envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
      base: './',
      publicDir: resolve('public'),
      appType: 'mpa',
      server: {
        // Default to 5173; when occupied (e.g. another Tomny clone is running),
        // Vite auto-increments to the next available port.
        // electron-vite reads the actual port and sets ELECTRON_RENDERER_URL accordingly.
        port: Number(process.env.TOMNI_DEV_RENDERER_PORT || 5173),
        strictPort: Boolean(webDevProxy),
        // Explicit HMR host so Vite client connects directly to the Vite dev server,
        // not to the WebUI proxy server (which would reject the WebSocket and cause infinite reload).
        // Port is omitted so it automatically matches the server port.
        hmr: {
          host: 'localhost',
        },
        ...(webDevProxy
          ? {
              proxy: {
                '/api': { target: webDevProxy, changeOrigin: true },
                '/login': { target: webDevProxy, changeOrigin: true },
                '/register': { target: webDevProxy, changeOrigin: true },
                '/logout': { target: webDevProxy, changeOrigin: true },
                '/ws': { target: webDevProxy, changeOrigin: true, ws: true },
              },
            }
          : {}),
      },
      resolve: {
        alias: {
          ...packageAppAliases,
          '@': resolve('packages/desktop/src'),
          '@common': resolve('packages/desktop/src/common'),
          '@renderer': resolve('packages/desktop/src/renderer'),
          '@process': resolve('packages/desktop/src/process'),
          '@worker': resolve('packages/desktop/src/process/worker'),
          // Force ESM version of streamdown
          streamdown: resolve('node_modules/streamdown/dist/index.js'),
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
        dedupe: ['react', 'react-dom', 'react-router-dom'],
      },
      plugins: [
        UnoCSS(unoConfig),
        iconParkPlugin(),

        ...(process.env.TOMNI_RENDERER_GRAPH_EVIDENCE === '1' ? [rendererGraphEvidencePlugin()] : []),
        ...(isDevelopment ? [devPackageApiPlugin()] : []),
        ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
      ],
      build: {
        target: 'es2022',
        sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
        minify: !isDevelopment,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 1500,
        cssCodeSplit: true,
        rollupOptions: {
          input: {
            index: resolve(rendererRoot, 'index.html'),
            pet: resolve(rendererRoot, 'pet/pet.html'),
            'pet-hit': resolve(rendererRoot, 'pet/pet-hit.html'),
            'pet-confirm': resolve(rendererRoot, 'pet/pet-confirm.html'),
          },
          external: ['node:crypto', 'crypto'],
          onwarn(warning, warn) {
            if (warning.code === 'EVAL') return;
            warn(warning);
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.env': JSON.stringify(process.env.env),
        'process.env.TOMNY_MULTI_INSTANCE': JSON.stringify(process.env.TOMNY_MULTI_INSTANCE ?? ''),
        'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
        // Inject the real Tomny version (root package.json) so renderer code
        // can show it without importing packages/desktop/package.json, which is
        // a workspace-internal placeholder frozen at "0.0.0".
        __APP_VERSION__: JSON.stringify(rootPackageJson.version),
        global: 'globalThis',
      },
      optimizeDeps: {
        exclude: ['electron'],
        include: [
          'react',
          'react-dom',
          'react-router-dom',
          'react-i18next',
          'i18next',
          '@arco-design/web-react',
          '@icon-park/react',
          'react-markdown',
          'react-syntax-highlighter',
          'react-virtuoso',
          'classnames',
          'swr',
          'eventemitter3',
          'katex',
          'diff2html',
          'remark-gfm',
          'remark-math',
          'remark-breaks',
          'rehype-raw',
          'rehype-katex',
          '@xterm/xterm',
          '@xterm/addon-fit',
          '@xterm/addon-search',
          '@xterm/addon-web-links',
          '@xterm/addon-webgl',
        ],
      },
    },
  };
});
