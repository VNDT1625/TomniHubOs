/**
 * Immutable adapter resolver owned by the IDE package. It consumes the public
 * editor ABI and intentionally avoids Core's mutable registry implementation.
 */
import type { EditorSurfaceAdapterComponent, EditorSurfaceAdapterResolver } from '@/common/packages';

export const createIdeEditorAdapterResolver = <TKind extends string>(
  registrations: Readonly<Partial<Record<TKind, EditorSurfaceAdapterComponent>>>
): EditorSurfaceAdapterResolver<TKind> => {
  const components = new Map<TKind, EditorSurfaceAdapterComponent>();
  for (const [kind, component] of Object.entries(registrations) as Array<
    [TKind, EditorSurfaceAdapterComponent | undefined]
  >) {
    // The host owns the plain-text fallback. An optional package cannot replace it.
    if (kind !== 'raw-text' && component !== undefined) {
      components.set(kind, component);
    }
  }
  return Object.freeze({ componentForKind: (kind) => components.get(kind) ?? null });
};
