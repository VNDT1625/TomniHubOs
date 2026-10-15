import type {
  FileViewerContent,
  FileViewerDocument,
  FileViewerNativeAPI,
  HubFileResult,
  LibraryNativeAPI,
} from '@/common/integrations/library/libraryContracts';
import FileViewerPage from '@/renderer/pages/integrations/fileViewer';
import { fileViewerPath, parseFileViewerSearch } from '@/renderer/pages/integrations/fileViewer/fileViewerRoute';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));
vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown'>{children}</div>,
}));

const documentOf = (content: FileViewerContent, overrides: Partial<FileViewerDocument> = {}): FileViewerDocument => ({
  name: 'note.md',
  extension: '.md',
  sizeBytes: 2048,
  modifiedAt: 1,
  canOpenExternal: true,
  content,
  ...overrides,
});
const ok = <T,>(data: T): HubFileResult<T> => ({ ok: true, data });

let viewer: { [K in keyof FileViewerNativeAPI]: ReturnType<typeof vi.fn> };
let library: { [K in keyof LibraryNativeAPI]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  viewer = { openFromExplorer: vi.fn(), read: vi.fn(), openExternal: vi.fn().mockResolvedValue(ok(null)) };
  library = {
    list: vi.fn(),
    add: vi.fn(),
    addFromView: vi.fn().mockResolvedValue(ok({})),
    repick: vi.fn(),
    remove: vi.fn(),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { fileViewer: viewer, library } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

const Where: React.FC = () => <div data-testid='where'>{useLocation().pathname}</div>;
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={['/guid', url]} initialIndex={1}>
      <Routes>
        <Route path='/file-viewer' element={<FileViewerPage />} />
        <Route path='*' element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
const LIBRARY_URL = fileViewerPath({ kind: 'library', id: 'lib-1' });
const VIEW_URL = fileViewerPath({ kind: 'view', id: 'view-1' });

describe('file viewer route reference', () => {
  it('round-trips an opaque reference and rejects anything else', () => {
    const url = new URL(`http://x${LIBRARY_URL}`);
    expect(parseFileViewerSearch(url.searchParams)).toEqual({ kind: 'library', id: 'lib-1' });
    expect(parseFileViewerSearch(new URLSearchParams('src=path&id=C:/secret.txt'))).toBeNull();
    expect(parseFileViewerSearch(new URLSearchParams('src=view'))).toBeNull();
    expect(parseFileViewerSearch(new URLSearchParams(`src=view&id=${'x'.repeat(129)}`))).toBeNull();
    expect(LIBRARY_URL).not.toMatch(/[A-Z]:|\\/);
  });
});

describe('centre file viewer', () => {
  it('asks Main for the opaque reference and shows the name and size', async () => {
    viewer.read.mockResolvedValue(ok(documentOf({ kind: 'text', text: 'plain words', truncated: false })));
    renderAt(LIBRARY_URL);
    expect(await screen.findByText('plain words')).toBeTruthy();
    expect(viewer.read).toHaveBeenCalledWith({ ref: { kind: 'library', id: 'lib-1' } });
    expect(screen.getByRole('heading', { name: 'note.md' })).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
  });

  it('renders Markdown through the shared Markdown view', async () => {
    viewer.read.mockResolvedValue(ok(documentOf({ kind: 'markdown', text: '# Title', truncated: false })));
    renderAt(LIBRARY_URL);
    expect((await screen.findByTestId('markdown')).textContent).toBe('# Title');
  });

  it('renders code with highlighting hooks and line numbers', async () => {
    viewer.read.mockResolvedValue(
      ok(
        documentOf(
          { kind: 'code', text: 'const answer = 42;', language: 'typescript', truncated: false },
          { name: 'a.ts', extension: '.ts', canOpenExternal: false }
        )
      )
    );
    renderAt(LIBRARY_URL);
    const code = await screen.findByTestId('file-viewer-code');
    expect(code.textContent).toContain('const answer = 42;');
    expect(code.querySelector('.hljs-keyword')).not.toBeNull();
    // The highlighter emits classes only; no theme colour is baked into the markup.
    expect(code.innerHTML).not.toMatch(/color/);
    expect(screen.queryByText('guid.hubHome.fileViewer.openExternal')).toBeNull();
  });

  it('renders an image from the bytes Main read', async () => {
    viewer.read.mockResolvedValue(
      ok(documentOf({ kind: 'image', mime: 'image/png', base64: 'AQID' }, { name: 'p.png' }))
    );
    renderAt(LIBRARY_URL);
    const image = (await screen.findByRole('img')) as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('data:image/png;base64,AQID');
    expect(image.getAttribute('alt')).toContain('guid.hubHome.fileViewer.imageAlt');
  });

  it('renders a PDF in an embedded viewer and releases its object URL', async () => {
    const create = vi.fn(() => 'blob:pdf-1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    viewer.read.mockResolvedValue(
      ok(documentOf({ kind: 'pdf', mime: 'application/pdf', base64: 'JVBERi0=' }, { name: 'd.pdf' }))
    );
    const { container, unmount } = renderAt(LIBRARY_URL);
    await waitFor(() => expect(container.querySelector('embed')?.getAttribute('src')).toBe('blob:pdf-1'));
    expect(container.querySelector('embed')?.getAttribute('type')).toBe('application/pdf');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:pdf-1');
  });

  it('says so when a file is truncated, too large or not viewable', async () => {
    viewer.read.mockResolvedValueOnce(ok(documentOf({ kind: 'text', text: 'abc', truncated: true })));
    const first = renderAt(LIBRARY_URL);
    expect(await screen.findByText('guid.hubHome.fileViewer.truncated')).toBeTruthy();
    first.unmount();
    viewer.read.mockResolvedValueOnce(ok(documentOf({ kind: 'too-large', limitBytes: 10 * 1024 * 1024 })));
    const second = renderAt(LIBRARY_URL);
    expect(await screen.findByText(/guid\.hubHome\.fileViewer\.tooLarge .*10\.0 MB/)).toBeTruthy();
    second.unmount();
    viewer.read.mockResolvedValueOnce(ok(documentOf({ kind: 'unsupported' })));
    renderAt(LIBRARY_URL);
    expect(await screen.findByText('guid.hubHome.fileViewer.unsupported')).toBeTruthy();
  });

  it('shows stable messages for errors and never calls Main for a malformed reference', async () => {
    viewer.read.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    const first = renderAt(LIBRARY_URL);
    expect((await screen.findByRole('alert')).textContent).toBe('guid.hubHome.fileViewer.errors.notFound');
    first.unmount();
    viewer.read.mockClear();
    viewer.read.mockResolvedValue({ ok: false, code: 'DENIED' });
    const second = renderAt(LIBRARY_URL);
    expect((await screen.findByRole('alert')).textContent).toBe('guid.hubHome.fileViewer.errors.denied');
    second.unmount();
    viewer.read.mockClear();
    renderAt('/file-viewer?src=path&id=C:%5Csecret.txt');
    expect((await screen.findByRole('alert')).textContent).toBe('guid.hubHome.fileViewer.errors.generic');
    expect(viewer.read).not.toHaveBeenCalled();
  });

  it('hands the file to the operating system only through Main', async () => {
    viewer.read.mockResolvedValue(ok(documentOf({ kind: 'text', text: 'x', truncated: false })));
    renderAt(LIBRARY_URL);
    fireEvent.click(await screen.findByText('guid.hubHome.fileViewer.openExternal'));
    expect(viewer.openExternal).toHaveBeenCalledWith({ ref: { kind: 'library', id: 'lib-1' } });
  });

  it('goes Back to the Library for a Library file and to the previous page for an Explorer file', async () => {
    viewer.read.mockResolvedValue(ok(documentOf({ kind: 'text', text: 'x', truncated: false })));
    const first = renderAt(LIBRARY_URL);
    fireEvent.click(await screen.findByText('guid.hubHome.fileViewer.backToLibrary'));
    expect((await screen.findByTestId('where')).textContent).toBe('/library');
    first.unmount();
    renderAt(VIEW_URL);
    fireEvent.click(await screen.findByText('guid.hubHome.fileViewer.back'));
    expect((await screen.findByTestId('where')).textContent).toBe('/guid');
  });

  it('offers "add to Library" only for an Explorer file, by view id', async () => {
    viewer.read.mockResolvedValue(ok(documentOf({ kind: 'text', text: 'x', truncated: false })));
    const library$ = renderAt(LIBRARY_URL);
    await screen.findByText('x');
    expect(screen.queryByText('guid.hubHome.fileViewer.addToLibrary')).toBeNull();
    library$.unmount();
    renderAt(VIEW_URL);
    fireEvent.click(await screen.findByText('guid.hubHome.fileViewer.addToLibrary'));
    expect(library.addFromView).toHaveBeenCalledWith({ viewId: 'view-1' });
    expect(await screen.findByText('guid.hubHome.fileViewer.addedToLibrary')).toBeTruthy();
  });

  it('keeps working when the bridge is missing', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    await act(async () => {
      renderAt(LIBRARY_URL);
    });
    expect((await screen.findByRole('alert')).textContent).toBe('guid.hubHome.fileViewer.errors.generic');
  });
});
