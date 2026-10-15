import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDragUpload } from '@/renderer/hooks/file/useDragUpload';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: vi.fn() } }));
vi.mock('@/renderer/services/FileService', () => ({ FileService: { processDroppedFiles: vi.fn() }, isSupportedFile: vi.fn(() => true) }));

describe('useDragUpload typed Explorer references', () => {
  it('preserves file and folder kinds from Explorer before browser upload', async () => {
    const onExplorerReferencesAdded = vi.fn();
    const { result } = renderHook(() => useDragUpload({ onExplorerReferencesAdded }));
    const getData = vi.fn((type: string) =>
            type === 'application/x-tomni-explorer-entries'
        ? '[{"relativePath":"src/a.ts","kind":"file"},{"relativePath":"docs","kind":"folder"}]'
        : type === 'application/x-tomni-explorer-workspace-root'
          ? 'C:\\work'
          : ''
    );

    await act(async () => {
      await result.current.dragHandlers.onDrop?.({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        nativeEvent: { dataTransfer: { files: { length: 0 }, getData } },
      } as never);
    });

        expect(onExplorerReferencesAdded).toHaveBeenCalledWith(
      [
        { relativePath: 'src/a.ts', kind: 'file' },
        { relativePath: 'docs', kind: 'folder' },
      ],
      'C:\\work'
    );
  });
});
