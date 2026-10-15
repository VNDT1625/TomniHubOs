/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { attachmentReferenceToken } from '@/common/chat/semanticAttachmentReference';
import type { AttachmentQuickViewSelection } from '@/common/chat/attachmentQuickView';

import { useGuidInput } from '@/renderer/pages/guid/hooks/useGuidInput';

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

describe('useGuidInput — ELECTRON-1K6', () => {
  it('handleFilesPasted preserves the selected workspace dir', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));

    act(() => {
      result.current.setDir('/Users/me/projects/my-project');
    });
    expect(result.current.dir).toBe('/Users/me/projects/my-project');

    act(() => {
      result.current.handleFilesPasted([{ path: '/tmp/a.png' } as never, { path: '/tmp/b.txt' } as never]);
    });

    expect(result.current.files).toEqual(['/tmp/a.png', '/tmp/b.txt']);
    expect(result.current.dir).toBe('/Users/me/projects/my-project');
  });

  it('handleFilesUploaded also preserves the selected workspace dir', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));

    act(() => {
      result.current.setDir('/Users/me/projects/my-project');
      result.current.handleFilesUploaded(['/tmp/c.pdf']);
    });

    expect(result.current.files).toEqual(['/tmp/c.pdf']);
    expect(result.current.dir).toBe('/Users/me/projects/my-project');
  });

  it('retains Main-issued quick-view capabilities for the selected attachments', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));
    const selections: AttachmentQuickViewSelection[] = [{ attachmentId: 'attachment-1', path: '/tmp/before.txt' }];

    act(() => {
      result.current.handleFilesUploaded(
        selections.map((selection) => selection.path),
        selections
      );
    });

    expect(result.current.attachmentQuickViewIds).toEqual({ '/tmp/before.txt': 'attachment-1' });
  });

  it('removes the matching token when an inline reference is removed', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));

    act(() => {
      result.current.handleFilesUploaded(['/tmp/before.png']);
    });
    const reference = result.current.attachmentReferences[0];

    act(() => {
      result.current.removeAttachmentReference(reference.id);
    });

    expect(result.current.attachmentReferences).toEqual([]);
    expect(result.current.input).not.toContain(attachmentReferenceToken(reference.id));
  });

  it('keeps a repeated reference owned after removing only one semantic placement', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));

    act(() => {
      result.current.handleFilesUploaded(['/tmp/before.png']);
    });
    const reference = result.current.attachmentReferences[0];
    act(() => {
      result.current.setInput(
        attachmentReferenceToken(reference.id) + ' then ' + attachmentReferenceToken(reference.id)
      );
      result.current.removeAttachmentReference(reference.id);
    });

    expect(result.current.input).toBe(` then ${attachmentReferenceToken(reference.id)}`);
    expect(result.current.attachmentReferences).toEqual([reference]);
  });


  it('adds an Explorer file reference as a semantic token at the composer caret', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));

    act(() => {
      result.current.setInput('đây là file ');
      result.current.setAttachmentCaret('đây là file '.length);
            result.current.handleExplorerReferencesAdded([{ relativePath: 'installed.json', kind: 'file' }], 'C:\\work');
    });

        expect(result.current.workspaceReferences).toHaveLength(1);
    expect(result.current.dir).toBe('C:\\work');
    expect(result.current.attachmentReferences).toHaveLength(1);
    const reference = result.current.attachmentReferences[0];
    expect(reference.source).toBe('workspace');
    expect(reference.label).toBe('installed.json');
    expect(reference.referencePath).toBe('installed.json');
    expect(result.current.input).toBe(`đây là file ${attachmentReferenceToken(reference.id)}`);
  });


    it('reconciles Explorer tokens removed via the keyboard with the transport and inventory', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));
    act(() => {
      result.current.handleExplorerReferencesAdded([
        { relativePath: 'installed.json', kind: 'file', sessionId: 'session-a' },
      ], 'C:\\work');
    });
    expect(result.current.attachmentReferences).toHaveLength(1);
    expect(result.current.workspaceReferences).toHaveLength(1);
    expect(Object.keys(result.current.workspaceQuickViewRequests)).toHaveLength(1);
    act(() => result.current.setInput(''));
    expect(result.current.attachmentReferences).toEqual([]);
    expect(result.current.workspaceReferences).toEqual([]);
    expect(result.current.workspaceQuickViewRequests).toEqual({});
    act(() => result.current.handleExplorerReferencesAdded([
      { relativePath: 'installed.json', kind: 'file', sessionId: 'session-a' },
    ], 'C:\\work'));
    expect(result.current.attachmentReferences).toHaveLength(1);
    expect(result.current.workspaceReferences).toHaveLength(1);
  });

  it('removes uploaded-file inventory after deleting the last token, retaining repeated placements', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));
    act(() => result.current.handleFilesUploaded(['/tmp/notes.txt']));
    const token = attachmentReferenceToken(result.current.attachmentReferences[0].id);
    act(() => result.current.setInput(token + ' again ' + token));
    act(() => result.current.setInput(' again ' + token));
    expect(result.current.files).toEqual(['/tmp/notes.txt']);
    expect(result.current.attachmentReferences).toHaveLength(1);
    act(() => result.current.setInput(' again '));
    expect(result.current.files).toEqual([]);
    expect(result.current.attachmentReferences).toEqual([]);
  });

  it('adds a semantic attachment reference at the current composer caret', () => {
    const { result } = renderHook(() => useGuidInput({ locationState: null }));

    act(() => {
      result.current.setInput('Hãy xem ảnh này ');
      result.current.setAttachmentCaret(17);
      result.current.handleFilesUploaded(['/tmp/before.png']);
    });

    expect(result.current.attachmentReferences).toHaveLength(1);
    const reference = result.current.attachmentReferences[0];
    expect(result.current.input).toBe(`Hãy xem ảnh này ${attachmentReferenceToken(reference.id)}`);
    expect(reference.label).toBe('before.png');
    expect(reference.referencePath).toBe('/tmp/before.png');
  });
});
