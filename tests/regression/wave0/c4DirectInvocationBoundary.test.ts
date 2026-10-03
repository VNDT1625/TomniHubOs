import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceFile = Readonly<{
  path: string;
  content: string;
}>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = 'packages/desktop/src/process';
const PACKAGE_BRIDGE_PATH = `${PROCESS_ROOT}/extensions/package-manager/packageBridge.ts`;

/**
 * This inventory intentionally covers only the Main-owned C4 operation chain.
 * It prevents direct implementation imports from the model/MCP path while a
 * separate release audit continues to own the broader optional-package graph.
 */
const C4_OPERATION_SEAM_PATHS = [
  `${PROCESS_ROOT}/resources/packageCapability/surfaceAiAccessBroker.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/surfaceAiRuntimeTransport.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/packageCallBroker.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiActionController.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiActionExecution.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiActionReadiness.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiOperationMcpHost.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiOperationMcpServer.ts`,
  `${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiOperationRun.ts`,
] as const;

const OPTIONAL_PROCESS_IMPLEMENTATION_ROOTS = [
  `${PROCESS_ROOT}/ide/`,
  `${PROCESS_ROOT}/browser/`,
  `${PROCESS_ROOT}/terminal/`,
  `${PROCESS_ROOT}/office/`,
  `${PROCESS_ROOT}/music/`,
] as const;

const readSource = (path: string): SourceFile => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error(`C4 operation seam missing: ${path}`);
  return Object.freeze({ path, content: readFileSync(absolutePath, 'utf8') });
};

const importSpecifiers = (content: string): readonly string[] =>
  Array.from(
    content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g),
    (match) => match[1]
  );

const resolveSpecifier = (sourcePath: string, specifier: string): string | undefined => {
  if (specifier.startsWith('@renderer/')) {
    return `packages/desktop/src/renderer/${specifier.slice('@renderer/'.length)}`;
  }
  if (specifier.startsWith('@process/')) {
    return `${PROCESS_ROOT}/${specifier.slice('@process/'.length)}`;
  }
  if (!specifier.startsWith('.')) return undefined;
  return relative(PROJECT_ROOT, resolve(dirname(resolve(PROJECT_ROOT, sourcePath)), specifier)).replaceAll('\\', '/');
};

const forbiddenImports = (source: SourceFile): readonly string[] =>
  importSpecifiers(source.content).flatMap((specifier) => {
    const target = resolveSpecifier(source.path, specifier);
    if (
      target?.startsWith('packages/desktop/src/renderer/') ||
      OPTIONAL_PROCESS_IMPLEMENTATION_ROOTS.some((root) => target?.startsWith(root))
    ) {
      return [`${source.path} -> ${specifier}`];
    }
    return [];
  });

const readC4OperationSeamSources = (): readonly SourceFile[] => C4_OPERATION_SEAM_PATHS.map((path) => readSource(path));

const readProcessSources = (directory = resolve(PROJECT_ROOT, PROCESS_ROOT)): readonly SourceFile[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry): readonly SourceFile[] => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return readProcessSources(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [
      Object.freeze({
        path: relative(PROJECT_ROOT, absolutePath).replaceAll('\\', '/'),
        content: readFileSync(absolutePath, 'utf8'),
      }),
    ];
  });

const factoryCallSites = (needle: string): readonly string[] =>
  readProcessSources()
    .filter((source) => source.content.includes(needle))
    .map((source) => source.path)
    .toSorted();

describe('C4 direct invocation boundary', () => {
  it('recognizes static, dynamic, and require implementation imports before applying the inventory', () => {
    expect(
      importSpecifiers(
        "import type { View } from '@renderer/hub/view'; export { runtime } from '@process/ide/runtime'; void import('@renderer/package-apps/example'); void require('@package-apps/browser/process/runtime');"
      )
    ).toEqual([
      '@renderer/hub/view',
      '@process/ide/runtime',
      '@renderer/package-apps/example',
      '@package-apps/browser/process/runtime',
    ]);
  });

  it('keeps the known Main-owned model/MCP operation chain free of renderer and optional package implementation imports', () => {
    const violations = readC4OperationSeamSources().flatMap(forbiddenImports);

    expect(violations).toEqual([]);
  });

  it('creates C4 dispatch authority only at the Main package bridge instead of an implementation-owned call site', () => {
    expect(factoryCallSites('createC4SurfaceAiOperationDispatcher({')).toEqual([PACKAGE_BRIDGE_PATH]);
    expect(factoryCallSites('createSurfaceAiOperationDispatcher({')).toEqual([PACKAGE_BRIDGE_PATH]);
    expect(factoryCallSites('createSurfaceAiAccessBroker({')).toEqual([PACKAGE_BRIDGE_PATH]);
  });

  it('keeps package-to-package execution dependency-injected through the broker rather than a callee implementation import', () => {
    const broker = readSource(`${PROCESS_ROOT}/resources/packageCapability/packageCallBroker.ts`);

    expect(broker.content).toContain('invokeCallee: (invocation: PackageCalleeInvocation)');
    expect(forbiddenImports(broker)).toEqual([]);
  });
});
