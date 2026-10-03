import type { EditorSurfaceAdapterComponent } from '@/common/packages';
import { describe, expect, it } from 'vitest';
import { createIdeEditorAdapterResolver } from '../../../packages/package-apps/ide/src/editorAdapterResolver';

const packageAdapter: EditorSurfaceAdapterComponent = () => null;
const forbiddenFallback: EditorSurfaceAdapterComponent = () => null;

describe('IDE package editor adapter resolver', () => {
  it('uses the published editor ABI without mutating or replacing the host fallback', () => {
    const resolver = createIdeEditorAdapterResolver({
      'text-code': packageAdapter,
      'raw-text': forbiddenFallback,
    });

    expect(Object.isFrozen(resolver)).toBe(true);
    expect(resolver.componentForKind('text-code')).toBe(packageAdapter);
    expect(resolver.componentForKind('raw-text')).toBeNull();
    expect(resolver.componentForKind('unknown')).toBeNull();
  });
});
