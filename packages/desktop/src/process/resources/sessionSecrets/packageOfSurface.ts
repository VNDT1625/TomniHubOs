import type { SurfaceManifest } from '@process/agentRuntime/surfaceRegistry/types';

/**
 * Built-in surfaces that are the front of an optional Package App. The IDE surface belongs to the IDE package, so a
 * run on it may use that package's secret sets even though the surface is registered by Core.
 */
const BUILTIN_SURFACE_PACKAGES: Readonly<Record<string, string>> = { ide: 'com.tomni.ide' };

/**
 * The Package App behind a surface, resolved by Main from the registry and never from a model or renderer. A surface
 * that no package owns, or an unknown surface, has none and therefore sees no package-scoped secret.
 */
export const packageIdOfSurface = (
  manifest: Pick<SurfaceManifest, 'id' | 'source'> | undefined
): string | undefined => {
  if (!manifest) return undefined;
  if (manifest.source.kind === 'package') return manifest.source.id || undefined;
  if (manifest.source.kind === 'builtin') {
    return Object.hasOwn(BUILTIN_SURFACE_PACKAGES, manifest.id) ? BUILTIN_SURFACE_PACKAGES[manifest.id] : undefined;
  }
  return undefined;
};
