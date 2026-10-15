/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builds a signed `.tomny` package from a local folder or an https Git repository.
 *
 * The pipeline is: resolve the source, list and screen files, classify, check that this app version
 * can actually host the result, select the payload, screen its contents, sign, write atomically, and
 * re-verify the written file. A repository the host cannot run is refused with the reason; it is never
 * turned into a placeholder page.
 */

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ADAPTER_FILE,
  ADAPTER_SOURCE_DIRECTORY,
  adapterDocumentSchema,
  classifyRepository,
  connectionNotInstallableReason,
  type AdapterOpenItem,
  type AdapterProvenance,
  scanEnvironmentUsage,
  type EnvironmentUsage,
  serializeAdapterDocument,
  type AdapterDocument,
  type PackageManifest,
  type RepoClassificationResult,
} from '../../../../common/packages';
import { isDeclarationFile, MAX_DECLARATION_CHARS } from '../../../../common/integrations/detectors';
import {
  signManifest,
  signManifestWithIntegrity,
  verifyWrittenArchive,
  writeArchive,
  writeArchiveStreaming,
} from './archive';
import {
  DEFAULT_LIMITS,
  LEGACY_LIMITS,
  buildOutputRoot,
  isSafeEntryPath,
  listCandidatePaths,
  loadAndScreenPayload,
  screenCandidates,
  screenPayloadStreaming,
  type PayloadFile,
  type ScreenedFile,
} from './fileScreen';
import { deriveMcpLaunch } from './mcpLaunch';
import { identityFromPrivateKey, loadOrCreateSigningIdentity, type SigningIdentity } from './signingKey';
import { acquireSource } from './sourceResolver';
import { checkDiskSpace } from './streaming/diskSpace';
import { bufferEntry, computeStreamingIntegrity, readPayloadEntry, type PayloadEntry } from './streaming/payload';
import {
  RepoPackagingError,
  type ExcludeReason,
  type ExcludedFile,
  type PackagingStage,
  type PackagingWarning,
  type RepoPackagingLimits,
  type RepoProvenance,
  type RepoSourceInfo,
  type RepoToPackageOptions,
  type RepoToPackageResult,
} from './types';

const MAX_SNIPPET_BYTES = 100 * 1024;
// Declaration files (plugin manifests, SKILL.md, hooks.json, .claude-plugin/*, ...) are read for the detectors up to
// the inventory's own per-file cap, and only so many of them, so a huge repository cannot make the scan unbounded.
const MAX_DECLARATION_BYTES = MAX_DECLARATION_CHARS;
const MAX_DECLARATION_FILES = 600;
const MAX_DECLARATION_TOTAL_BYTES = 16 * 1024 * 1024;
// Small files that decide which services a repository holds, and how many source files are read for the
// environment variables they use.
const SERVICE_FILE_NAMES: ReadonlySet<string> = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  '.env.example',
  '.env.sample',
  '.env.template',
  'example.env',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]);
const MAX_SERVICE_FILES = 60;
const MAX_SCANNED_SOURCES = 600;
const SCANNED_EXTENSIONS = ['.py', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'] as const;
const NOT_CONFIGURATION_PATH = [
  '/test/',
  '/tests/',
  '/__tests__/',
  '.test.',
  '.spec.',
  '/node_modules/',
  '/migrations/',
];
const MAX_THEME_CSS_BYTES = 256 * 1024;
const WEB_ARCHETYPES: ReadonlySet<string> = new Set(['web-surface-app', 'ide-viewer']);
const SNIPPET_BASENAMES = ['mcp.json', 'workflow.json', 'index.html', 'main.ts', 'index.ts', 'server.ts', 'app.ts'];
const WEB_ENTRY_PATHS = ['dist/index.html', 'build/index.html', 'docs/index.html', 'index.html'];
/** Packaged with the whole repository under source/ and an adapter/ shell that says how it connects. */
const SOURCE_LAYOUT_ARCHETYPES: ReadonlySet<string> = new Set(['mcp-tool-server', 'agent-skill', 'web-service-app']);
const LICENSE_FILE = /^(?:license|licence|copying|notice)(?:\.[a-z]+)?$/iu;
const ABSOLUTE_ASSET_PATH = /\b(?:src|href)\s*=\s*["']\/(?!\/)/iu;
/** Reasons the user should see file by file; the rest are only counted. */
const NOTABLE_REASONS: ReadonlySet<ExcludeReason> = new Set([
  'secret-name',
  'secret-content',
  'too-large',
  'unsafe-path',
  'symlink',
]);

/** At most this many oversized files are listed as open items, so they cannot crowd out the other ones. */
const MAX_OVERSIZED_OPEN_ITEMS = 20;
const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** The same origin in the shape adapter.json stores (time in milliseconds, 40-character commit only). */
const adapterProvenanceOf = (provenance: RepoProvenance): AdapterProvenance => {
  const packagedAt = Date.parse(provenance.packagedAt);
  return {
    kind: provenance.kind,
    ...(provenance.url !== undefined ? { url: provenance.url } : {}),
    ...(provenance.commit?.length === 40 ? { commit: provenance.commit } : {}),
    ...(provenance.ref !== undefined ? { ref: provenance.ref } : {}),
    ...(provenance.subdirectory !== undefined ? { subdirectory: provenance.subdirectory } : {}),
    packagedAt: Number.isFinite(packagedAt) ? packagedAt : 0,
  };
};

/** Origin of the packaged files; the commit is kept only when it is a full hash. */
const buildProvenance = (source: RepoSourceInfo, packagedAt: string): RepoProvenance => ({
  kind: source.kind,
  ...(source.kind === 'git' ? { url: source.display } : {}),
  ...(source.commit !== undefined && FULL_COMMIT.test(source.commit) ? { commit: source.commit } : {}),
  ...(source.ref ? { ref: source.ref } : {}),
  ...(source.subdirectory ? { subdirectory: source.subdirectory } : {}),
  packagedAt,
});

type LoadedPayload = Readonly<{
  entries: PayloadEntry[];
  excluded: ExcludedFile[];
  warnings: PackagingWarning[];
}>;

/** Screens the selected files. Streaming keeps them on disk; the legacy path loads every file into memory. */
const loadPayload = async (
  files: readonly ScreenedFile[],
  streaming: boolean,
  limits: RepoPackagingLimits,
  signal: AbortSignal | undefined
): Promise<LoadedPayload> => {
  if (streaming) {
    const screen = await screenPayloadStreaming(files, signal);
    return {
      entries: screen.files.map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        absolutePath: file.absolutePath,
      })),
      excluded: screen.excluded,
      warnings: screen.warnings,
    };
  }
  const legacy = await loadAndScreenPayload(files, limits, signal);
  return {
    entries: legacy.payload.map((file) => bufferEntry(file.relativePath, file.content)),
    excluded: legacy.excluded,
    warnings: legacy.warnings,
  };
};

/** The legacy writer needs the file contents; every legacy entry is buffer-backed. */
const toLegacyPayload = (entries: readonly PayloadEntry[]): PayloadFile[] =>
  entries.map((entry) => {
    if (!('content' in entry))
      throw new RepoPackagingError('MANIFEST_INVALID', 'Đường ghi cũ cần nội dung trong bộ nhớ.');
    return { relativePath: entry.relativePath, content: entry.content };
  });

const throwIfCancelled = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw new RepoPackagingError('CANCELLED', 'Đã huỷ đóng gói.');
};

const readSnippet = async (file: ScreenedFile): Promise<string | undefined> => {
  if (file.size > MAX_SNIPPET_BYTES) return undefined;
  try {
    return await readFile(file.absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

/** Reads a declaration file for the detectors; larger than the per-file cap means it is not read at all. */
const readDeclaration = async (file: ScreenedFile): Promise<string | undefined> => {
  if (file.size > MAX_DECLARATION_BYTES) return undefined;
  try {
    return await readFile(file.absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

const countByReason = (excluded: readonly ExcludedFile[]): Partial<Record<ExcludeReason, number>> => {
  const counts: Partial<Record<ExcludeReason, number>> = {};
  for (const entry of excluded) counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
  return counts;
};

const resolveIdentity = (options: RepoToPackageOptions): Promise<SigningIdentity> => {
  const { signing } = options;
  if ('privateKeyPem' in signing) return Promise.resolve(identityFromPrivateKey(signing.privateKeyPem, signing.keyId));
  return loadOrCreateSigningIdentity({
    directory: signing.keyDirectory,
    protect: signing.protect,
    unprotect: signing.unprotect,
  });
};

type Selection = Readonly<{
  files: ScreenedFile[];
  excluded: ExcludedFile[];
  /** Entry page relative to the package root, for web archetypes. */
  entrypoint?: string;
}>;

/**
 * Chooses what goes into the package. A web app published from `dist/`, `build/` or `docs/` is packaged
 * from that folder alone, so the package root is the site root; otherwise the whole repository is used
 * minus build output.
 */
const selectPayload = (
  classification: RepoClassificationResult,
  files: readonly ScreenedFile[],
  sourceLayout: boolean
): Selection => {
  const excluded: ExcludedFile[] = [];
  const entry = classification.entrypoint;

  if (!sourceLayout && WEB_ARCHETYPES.has(classification.archetype) && entry !== undefined && entry.includes('/')) {
    const directory = path.posix.dirname(entry);
    const prefix = `${directory}/`;
    const selected: ScreenedFile[] = [];
    for (const file of files) {
      if (file.relativePath.startsWith(prefix)) {
        const relativePath = file.relativePath.slice(prefix.length);
        if (isSafeEntryPath(relativePath)) selected.push({ ...file, relativePath });
        else excluded.push({ path: file.relativePath, reason: 'unsafe-path' });
      } else if (!file.relativePath.includes('/') && LICENSE_FILE.test(file.relativePath)) {
        selected.push(file);
      } else {
        excluded.push({ path: file.relativePath, reason: 'outside-payload' });
      }
    }
    // A license at the root stays only when it does not collide with a file of the site itself.
    const seen = new Set<string>();
    const unique = selected.filter((file) => {
      if (seen.has(file.relativePath)) return false;
      seen.add(file.relativePath);
      return true;
    });
    return { files: unique, excluded, entrypoint: path.posix.basename(entry) };
  }

  if (sourceLayout) {
    // The repository travels whole under source/; only build output is left out. Nothing in it runs by itself.
    const selected: ScreenedFile[] = [];
    for (const file of files) {
      if (buildOutputRoot(file.relativePath) !== undefined)
        excluded.push({ path: file.relativePath, reason: 'build-output' });
      else selected.push({ ...file, relativePath: `${ADAPTER_SOURCE_DIRECTORY}/${file.relativePath}` });
    }
    return { files: selected, excluded };
  }

  const selected: ScreenedFile[] = [];
  for (const file of files) {
    if (buildOutputRoot(file.relativePath) !== undefined)
      excluded.push({ path: file.relativePath, reason: 'build-output' });
    else selected.push(file);
  }
  return {
    files: selected,
    excluded,
    ...(entry !== undefined && WEB_ARCHETYPES.has(classification.archetype) ? { entrypoint: entry } : {}),
  };
};

/**
 * Manifest of a package that only carries connections found by the detectors. The legacy archetype (chat stage,
 * service, native...) could not be hosted, so none of its modules, permissions or dependencies are kept: the
 * package holds the source under source/ and the adapter says what it offers.
 */
const connectionsOnlyManifest = (manifest: PackageManifest): PackageManifest => {
  const { contributions: _contributions, ...rest } = manifest;
  return { ...rest, type: 'agent-capsule', modules: [], permissions: [], dependencies: [], tags: ['source-only'] };
};

const preferredCssOrder = (relativePath: string): number => {
  const base = path.posix.basename(relativePath).toLowerCase();
  return ['theme.css', 'index.css', 'main.css', 'style.css', 'styles.css'].indexOf(base) >= 0
    ? ['theme.css', 'index.css', 'main.css', 'style.css', 'styles.css'].indexOf(base)
    : 100;
};

/**
 * Gathers a theme's stylesheets, main ones first, into the single CSS string the manifest carries. The sizes
 * are checked before any sheet is read, so an oversized stylesheet is never loaded.
 */
const collectThemeCss = async (payload: readonly PayloadEntry[]): Promise<string> => {
  const tooLarge = new RepoPackagingError('PAYLOAD_TOO_LARGE', `CSS của theme vượt ${MAX_THEME_CSS_BYTES / 1024} KB.`);
  const sheets = payload
    .filter((file) => file.relativePath.toLowerCase().endsWith('.css'))
    .toSorted(
      (left, right) =>
        preferredCssOrder(left.relativePath) - preferredCssOrder(right.relativePath) ||
        (left.relativePath < right.relativePath ? -1 : 1)
    );
  // Decoding never shrinks the text, so a total over the cap on disk is over the cap in the manifest too.
  if (sheets.reduce((total, sheet) => total + sheet.size, 0) > MAX_THEME_CSS_BYTES) throw tooLarge;
  const texts: string[] = [];
  for (const sheet of sheets) {
    // oxlint-disable-next-line no-await-in-loop -- a few small stylesheets, read one at a time.
    texts.push((await readPayloadEntry(sheet)).toString('utf8'));
  }
  const css = texts.join('\n');
  if (Buffer.byteLength(css, 'utf8') > MAX_THEME_CSS_BYTES) throw tooLarge;
  return css;
};

const buildManifest = (
  classification: RepoClassificationResult,
  options: RepoToPackageOptions,
  selection: Selection,
  themeCss: string | undefined
): PackageManifest => {
  let manifest: PackageManifest = {
    ...classification.manifest,
    ...(options.packageId ? { id: options.packageId } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.version ? { version: options.version } : {}),
  };

  if (classification.archetype === 'ui-theme') {
    const css = themeCss ?? '';
    manifest = {
      ...manifest,
      modules: [],
      contributions: {
        version: 1,
        themes: (manifest.contributions?.themes ?? []).map((theme) => ({ ...theme, css })),
      },
    };
  } else if (selection.entrypoint !== undefined) {
    manifest = {
      ...manifest,
      modules: manifest.modules.map((module) =>
        module.entrypoint ? { ...module, entrypoint: selection.entrypoint } : module
      ),
    };
  }
  return manifest;
};

/**
 * Builds a signed `.tomny` archive. Throws {@link RepoPackagingError} with a stable code when the source
 * is invalid, cannot be hosted, or fails verification; temporary files are always removed.
 */
export const buildTomnyPackageFromRepo = async (options: RepoToPackageOptions): Promise<RepoToPackageResult> => {
  const streaming = options.streamingPackager !== false;
  const limits: RepoPackagingLimits = { ...(streaming ? DEFAULT_LIMITS : LEGACY_LIMITS), ...options.limits };
  const { signal } = options;
  const report = (stage: PackagingStage, status: 'started' | 'done', detail?: string): void => {
    try {
      options.onProgress?.({ stage, status, ...(detail === undefined ? {} : { detail }) });
    } catch {
      // A broken progress listener must never fail packaging.
    }
  };

  const outputDirectory = path.resolve(options.outputDirectory);
  report('resolve', 'started');
  const identity = await resolveIdentity(options);
  throwIfCancelled(signal);
  report('resolve', 'done');

  report('fetch', 'started');
  const source = await acquireSource({
    source: options.source,
    workspaceRoot: options.workspaceRoot,
    allowLocalOutsideWorkspace: options.allowLocalOutsideWorkspace,
    ref: options.ref,
    subdirectory: options.subdirectory,
    allowedGitHosts: options.allowedGitHosts,
    cloneTimeoutMs: limits.cloneTimeoutMs,
    signal,
  });
  report('fetch', 'done', source.info.display);

  try {
    throwIfCancelled(signal);
    report('scan', 'started');
    const listing = await listCandidatePaths(source.root, limits, signal);
    if (listing.paths.length === 0)
      throw new RepoPackagingError('EMPTY_REPOSITORY', 'Thư mục không có tệp nào để đóng gói.');
    const screened = await screenCandidates(source.root, listing.paths, limits, outputDirectory);
    report('scan', 'done', `${screened.files.length} tệp`);
    if (screened.files.length === 0)
      throw new RepoPackagingError(
        'EMPTY_REPOSITORY',
        'Không còn tệp nào để đóng gói sau khi loại bỏ tệp nhạy cảm và tệp công cụ.'
      );

    throwIfCancelled(signal);
    report('classify', 'started');
    const packageJsonFile = screened.files.find((file) => file.relativePath === 'package.json');
    const snippetPaths = new Set<string>(WEB_ENTRY_PATHS);
    for (const basename of SNIPPET_BASENAMES) {
      const match = screened.files.find((file) => file.relativePath.toLowerCase().endsWith(basename));
      if (match) snippetPaths.add(match.relativePath);
    }
    const fileSnippets: Record<string, string> = {};
    for (const file of screened.files) {
      if (!snippetPaths.has(file.relativePath)) continue;
      // oxlint-disable-next-line no-await-in-loop -- a handful of small files.
      const content = await readSnippet(file);
      if (content !== undefined) fileSnippets[file.relativePath] = content;
    }
    const environmentUsage: EnvironmentUsage[] = [];
    let serviceFilesRead = 0;
    let sourceFilesScanned = 0;
    for (const file of screened.files) {
      const name = path.posix.basename(file.relativePath);
      if (SERVICE_FILE_NAMES.has(name)) {
        if (serviceFilesRead >= MAX_SERVICE_FILES || fileSnippets[file.relativePath] !== undefined) continue;
        serviceFilesRead += 1;
        // oxlint-disable-next-line no-await-in-loop -- small files, read one at a time.
        const content = await readSnippet(file);
        if (content !== undefined) fileSnippets[file.relativePath] = content;
      } else if (
        sourceFilesScanned < MAX_SCANNED_SOURCES &&
        SCANNED_EXTENSIONS.some((extension) => name.endsWith(extension)) &&
        !NOT_CONFIGURATION_PATH.some((part) => `/${file.relativePath}`.includes(part))
      ) {
        sourceFilesScanned += 1;
        // oxlint-disable-next-line no-await-in-loop -- bounded by MAX_SCANNED_SOURCES.
        const content = await readSnippet(file);
        if (content !== undefined) environmentUsage.push(...scanEnvironmentUsage(file.relativePath, content));
      }
    }
    // Declaration files the detectors parse (plugin manifests, SKILL.md, hooks, rules...): read within fixed caps.
    let declarationFilesRead = 0;
    let declarationBytesRead = 0;
    for (const file of screened.files) {
      if (fileSnippets[file.relativePath] !== undefined || !isDeclarationFile(file.relativePath)) continue;
      if (
        declarationFilesRead >= MAX_DECLARATION_FILES ||
        declarationBytesRead + file.size > MAX_DECLARATION_TOTAL_BYTES
      )
        continue;
      declarationFilesRead += 1;
      declarationBytesRead += file.size;
      // oxlint-disable-next-line no-await-in-loop -- bounded by MAX_DECLARATION_FILES, read one at a time.
      const content = await readDeclaration(file);
      if (content !== undefined) fileSnippets[file.relativePath] = content;
    }
    const classificationInput = {
      files: screened.files.map((file) => file.relativePath),
      environmentUsage,
      packageJson: packageJsonFile ? await readSnippet(packageJsonFile) : undefined,
      repositoryName: options.name ?? source.repositoryName,
      publisherId: options.publisherId,
      fileSnippets,
    };
    let classification = classifyRepository(classificationInput);
    let mcpChoice: Awaited<ReturnType<typeof deriveMcpLaunch>>;
    if (classification.archetype === 'mcp-tool-server') {
      // An MCP server is packaged as a launch recipe for its published package, not as copied code.
      mcpChoice = await deriveMcpLaunch(screened.files);
      if (mcpChoice) classification = classifyRepository({ ...classificationInput, mcpLaunch: mcpChoice.recipe });
    }
    report('classify', 'done', classification.archetype);
    // Keep every non-runnable repository as inert source, even when no detector can offer a connection.
    // A missing host must not turn a recoverable repository into a rejected or fake runnable package.
    if (!classification.runnable)
      classification = { ...classification, manifest: connectionsOnlyManifest(classification.manifest) };
    const sourceLayout = !classification.runnable || SOURCE_LAYOUT_ARCHETYPES.has(classification.archetype);
    // Legacy runnable web/theme packages still require payload files at the archive root. Preserve their
    // runnable entrypoints while adding a separate source/ tree for connections found by detectors.
    const hybridLayout = !sourceLayout && (classification.connections?.length ?? 0) > 0;

    throwIfCancelled(signal);
    report('screen', 'started');
    const primarySelection = selectPayload(classification, screened.files, sourceLayout);
    const selection: Selection = hybridLayout
      ? {
          ...primarySelection,
          files: [
            ...primarySelection.files,
            ...screened.files
              .filter((file) => buildOutputRoot(file.relativePath) === undefined)
              .map((file) => ({ ...file, relativePath: `${ADAPTER_SOURCE_DIRECTORY}/${file.relativePath}` })),
          ],
        }
      : primarySelection;
    if (selection.files.length === 0)
      throw new RepoPackagingError('EMPTY_REPOSITORY', 'Không có tệp nào thuộc phần cần đóng gói.');
    if (limits.maxFiles !== undefined && selection.files.length > limits.maxFiles) {
      throw new RepoPackagingError(
        'TOO_MANY_FILES',
        `Gói có ${selection.files.length} tệp, vượt giới hạn ${limits.maxFiles}.`
      );
    }
    const content = await loadPayload(selection.files, streaming, limits, signal);
    if (
      selection.entrypoint !== undefined &&
      !content.entries.some((file) => file.relativePath === selection.entrypoint)
    ) {
      throw new RepoPackagingError(
        'NOT_RUNNABLE',
        'Trang chính của ứng dụng bị loại khỏi gói vì chứa thông tin nhạy cảm.',
        {
          archetype: classification.archetype,
        }
      );
    }
    const provenance = buildProvenance(source.info, new Date().toISOString());
    let adapter: AdapterDocument | undefined;
    if (sourceLayout || hybridLayout) {
      const present = new Set(content.entries.map((file) => file.relativePath));
      // A skill whose SKILL.md was left out (it held a secret) is not offered.
      const connections = (classification.connections ?? []).filter(
        (connection) => connection.kind !== 'skill' || present.has(`${connection.path}/SKILL.md`)
      );
      // Connections this host cannot run yet are kept and listed as open items, so nothing is lost silently.
      // Mark source-only repositories and incomplete web sources even if another connection (such as MCP) works.
      const sourceOnlyItems: AdapterOpenItem[] =
        !classification.runnable && (connections.length === 0 || classification.runnableIssueCode === 'WEB_NEEDS_BUILD')
          ? [
              {
                kind: 'needs-runtime',
                note:
                  classification.runnableIssue ??
                  'Chưa nhận diện được kết nối có thể sử dụng; mã nguồn chỉ được lưu, không được chạy.',
              },
            ]
          : [];
      const waiting: AdapterOpenItem[] = connections.flatMap((connection) => {
        const reason = connectionNotInstallableReason(connection);
        return reason === undefined
          ? []
          : [
              {
                kind: 'needs-runtime' as const,
                ...('id' in connection ? { connection: connection.id } : {}),
                note: reason,
              },
            ];
      });
      // Files over the per-file cap are not in the package; say so instead of dropping them silently.
      const oversized: AdapterOpenItem[] = screened.excluded
        .filter((entry) => entry.reason === 'too-large')
        .slice(0, MAX_OVERSIZED_OPEN_ITEMS)
        .map((entry) => ({
          kind: 'unrecognized' as const,
          path: `${ADAPTER_SOURCE_DIRECTORY}/${entry.path}`,
          note: `Tệp ${entry.path} (${entry.detail ?? 'quá lớn'}) vượt giới hạn ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB mỗi tệp nên không nằm trong gói.`,
        }));
      const openItems = [...(classification.openItems ?? []), ...sourceOnlyItems, ...waiting, ...oversized].slice(
        0,
        100
      );
      const detectorList = classification.detectors ?? [];
      const unsigned: AdapterDocument = {
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections,
        ...(openItems.length > 0 ? { openItems } : {}),
        ...(detectorList.length > 0 ? { detectors: [...detectorList] } : {}),
      };
      // Provenance lets the package be updated from its source; a value the schema refuses is left out, not guessed.
      const withProvenance: AdapterDocument = { ...unsigned, provenance: adapterProvenanceOf(provenance) };
      adapter = adapterDocumentSchema.safeParse(withProvenance).success ? withProvenance : unsigned;
      content.entries.push(bufferEntry(ADAPTER_FILE, Buffer.from(serializeAdapterDocument(adapter), 'utf8')));
    }
    const warnings: PackagingWarning[] = [...content.warnings];
    if (mcpChoice && mcpChoice.skipped.length > 0) {
      warnings.push({
        code: 'MCP_OTHER_PACKAGES',
        message: `Repository còn package khác có thể chạy (${mcpChoice.skipped.join(', ')}). Đã chọn ${mcpChoice.source} vì package đó dùng MCP SDK; muốn gói khác thì chạy lại với --path <thư-mục>.`,
        path: mcpChoice.source,
      });
    }
    if (selection.entrypoint !== undefined) {
      const entryFile = content.entries.find((file) => file.relativePath === selection.entrypoint);
      if (entryFile && ABSOLUTE_ASSET_PATH.test((await readPayloadEntry(entryFile)).toString('utf8'))) {
        warnings.push({
          code: 'ABSOLUTE_ASSET_PATHS',
          message: `${selection.entrypoint} tải tài nguyên bằng đường dẫn tuyệt đối (ví dụ /assets/...). Nếu trang không hiển thị đủ khi mở trong ứng dụng, hãy build với đường dẫn tương đối (Vite: base "./").`,
          path: selection.entrypoint,
        });
      }
    }
    const allExcluded: ExcludedFile[] = [...screened.excluded, ...selection.excluded, ...content.excluded];
    // Refuse before reading everything twice when the drive cannot hold the archive and its temporary file.
    const estimatedBytes = content.entries.reduce((total, entry) => total + entry.size, 0);
    warnings.push(...(await checkDiskSpace(outputDirectory, estimatedBytes, options.freeSpaceBytes)));
    report('screen', 'done', `${allExcluded.length} tệp bị loại`);

    throwIfCancelled(signal);
    report('build', 'started');
    const themeCss = classification.archetype === 'ui-theme' ? await collectThemeCss(content.entries) : undefined;
    const manifest = buildManifest(classification, options, selection, themeCss);
    report('build', 'done');

    report('sign', 'started');
    const signed = streaming
      ? signManifestWithIntegrity(manifest, await computeStreamingIntegrity(content.entries, signal), identity)
      : signManifest(manifest, toLegacyPayload(content.entries), identity);
    report('sign', 'done', identity.keyId);

    report('write', 'started');
    const written = streaming
      ? await writeArchiveStreaming(signed, content.entries, outputDirectory, signal)
      : await writeArchive(signed, toLegacyPayload(content.entries), outputDirectory);
    report('write', 'done', written.artifactPath);

    report('verify', 'started');
    try {
      await verifyWrittenArchive(written.artifactPath, signed, identity);
    } catch (error) {
      await rm(written.artifactPath, { force: true });
      throw error;
    }
    report('verify', 'done');

    return {
      artifactPath: written.artifactPath,
      manifest: signed,
      classification,
      archiveBytes: written.bytes,
      keyId: identity.keyId,
      publicKeyPem: identity.publicKeyPem,
      keyFingerprint: identity.fingerprint,
      includedFileCount: content.entries.length,
      excluded: allExcluded.filter((entry) => NOTABLE_REASONS.has(entry.reason)),
      excludedCounts: countByReason(allExcluded),
      warnings,
      verified: true,
      source: source.info,
      provenance,
      ...(adapter ? { adapter } : {}),
    };
  } finally {
    await source.cleanup();
  }
};
