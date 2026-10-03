import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = resolve(PROJECT_ROOT, 'packages/desktop/src/process');

const readProcessSources = (directory = PROCESS_ROOT): readonly Readonly<{ path: string; content: string }>[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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

const callSites = (
  sources: readonly Readonly<{ path: string; content: string }>[],
  needle: string
): readonly string[] =>
  sources
    .filter((source) => source.content.includes(needle))
    .map((source) => source.path)
    .toSorted();

describe('C2 production AI-to-Surface release gate', () => {
  it('keeps every production invocation factory behind the one unpackaged Main-owned C4 pilot switch', () => {
    const sources = readProcessSources();
    const bridgeSource = readFileSync(resolve(PROCESS_ROOT, 'bridge/index.ts'), 'utf8');
    const packageBridgePath = 'packages/desktop/src/process/extensions/package-manager/packageBridge.ts';
    const packageBridgeSource = readFileSync(resolve(PROJECT_ROOT, packageBridgePath), 'utf8');
    const brokerSource = readFileSync(
      resolve(PROCESS_ROOT, 'resources/packageCapability/surfaceAiAccessBroker.ts'),
      'utf8'
    );

    expect(bridgeSource).toContain("!app.isPackaged && process.env.TOMNY_ENABLE_DEV_C4_LOCAL_SURFACE_AI_PILOT === '1'");
    expect(bridgeSource).toContain('c4LocalSurfaceAiEnabled: () => c4LocalSurfaceAiPilotEnabled');
    expect(packageBridgeSource).toContain('c4LocalSurfaceAiEnabled?: () => boolean;');
    expect(packageBridgeSource).toContain('enabled: options.c4LocalSurfaceAiEnabled ?? (() => false)');
    expect(packageBridgeSource).toContain('enabled: input.enabled,');
    expect(brokerSource).toContain(
      "if (deps.enabled?.() !== true) throw new SurfaceAiAccessBrokerError('SURFACE_AI_ACCESS_DISABLED');"
    );

    const pilotBlock = bridgeSource.indexOf('if (planCache !== undefined)');
    const controller = bridgeSource.indexOf('const controller = createSurfaceAiActionController({', pilotBlock);
    const pilotActionBridge = bridgeSource.indexOf('registerHubGoalSurfaceActionBridge({', controller);
    const inertActionBridge = bridgeSource.indexOf('registerHubGoalSurfaceActionBridge({', pilotActionBridge + 1);

    expect(pilotBlock).toBeGreaterThan(-1);
    expect(controller).toBeGreaterThan(pilotBlock);
    expect(pilotActionBridge).toBeGreaterThan(controller);
    expect(inertActionBridge).toBeGreaterThan(pilotActionBridge);
    expect(bridgeSource.slice(inertActionBridge, inertActionBridge + 400)).not.toContain('controller,');

    expect(callSites(sources, 'createC4SurfaceAiOperationDispatcher({')).toEqual([packageBridgePath]);
    expect(callSites(sources, 'createSurfaceAiOperationDispatcher({')).toEqual([packageBridgePath]);
    expect(callSites(sources, 'createSurfaceAiAccessBroker({')).toEqual([packageBridgePath]);
  });
});
