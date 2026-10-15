import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDragUpload } from '@/renderer/hooks/file/useDragUpload';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('@arco-design/web-react', () => ({ Message: { error: vi.fn() } }));
vi.mock('@/renderer/services/FileService', () => ({
  FileService: { processDroppedFiles: vi.fn() },
  isSupportedFile: vi.fn(() => true),
}));

const customTransfer = (payload: string) => ({
  files: { length: 1 },
  getData: vi.fn((type: string) => (type === 'application/x-tomni-explorer-paths' ? payload : '')),
});

describe('useDragUpload Explorer references', () => {
  it('routes an Explorer MIME drop before browser file upload', async () => {
    const onExplorerReferencesAdded = vi.fn();
    const onFilesAdded = vi.fn();
    const { result } = renderHook(() => useDragUpload({ onExplorerReferencesAdded, onFilesAdded }));
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    await act(async () => {
      await result.current.dragHandlers.onDrop?.({
        preventDefault,
        stopPropagation,
        nativeEvent: { dataTransfer: customTransfer('["src/a.ts"]') },
      } as never);
    });

    expect(onExplorerReferencesAdded).toHaveBeenCalledWith([{ relativePath: 'src/a.ts', kind: 'file' }]);
    expect(onFilesAdded).not.toHaveBeenCalled();
  });
});
