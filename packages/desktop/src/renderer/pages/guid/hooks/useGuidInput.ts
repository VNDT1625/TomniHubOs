/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import type { AttachmentQuickViewSelection } from '@/common/chat/attachmentQuickView';
import { attachmentReferenceToken, insertAttachmentReference, referencedAttachmentIds } from '@/common/chat/semanticAttachmentReference';
import { removeAttachmentReference as removeAttachmentReferenceToken } from '@/common/chat/semanticAttachmentReference';
import type { WorkspaceReferenceAttachment, WorkspaceReferenceRequest } from '@/common/chat/workspaceReference';
import { workspaceReferenceId } from '@/common/chat/workspaceReference';
import { useDragUpload } from '@/renderer/hooks/file/useDragUpload';
import { usePasteService } from '@/renderer/hooks/file/usePasteService';
import { allSupportedExts, type FileMetadata } from '@/renderer/services/FileService';
import { useCallback, useEffect, useRef, useState } from 'react';
import { measureCaretTop, scrollCaretToLastLine } from '../utils/caretUtils';

export type GuidInputResult = {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: string[];
  setFiles: React.Dispatch<React.SetStateAction<string[]>>;
  attachmentReferences: SemanticAttachmentReference[];
  attachmentQuickViewIds: Readonly<Record<string, string>>;
  workspaceQuickViewRequests: Readonly<Record<string, Readonly<{ sessionId: string; relativePath: string }>>>;
  setAttachmentCaret: (caret: number) => void;
  removeAttachmentReference: (referenceId: string) => void;
  workspaceReferences: WorkspaceReferenceAttachment[];
  setWorkspaceReferences: React.Dispatch<React.SetStateAction<WorkspaceReferenceAttachment[]>>;
    handleExplorerReferencesAdded: (references: WorkspaceReferenceRequest[], workspaceRoot?: string) => void;
  handleRemoveWorkspaceReference: (relativePath: string) => void;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  isInputFocused: boolean;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handleFilesPasted: (pastedFiles: FileMetadata[]) => void;
  handleFilesUploaded: (uploadedPaths: string[], selections?: readonly AttachmentQuickViewSelection[]) => void;
  handleRemoveFile: (targetPath: string) => void;
  handleTextareaFocus: () => void;
  handleTextareaBlur: () => void;
  onPaste: ReturnType<typeof usePasteService>['onPaste'];
  isFileDragging: boolean;
  dragHandlers: ReturnType<typeof useDragUpload>['dragHandlers'];
};

type UseGuidInputOptions = { locationState: { workspace?: string } | null };

const fileName = (path: string): string => path.replaceAll(String.fromCharCode(92), '/').split('/').at(-1) ?? path;
const fileReference = (path: string): SemanticAttachmentReference => ({
  id: crypto.randomUUID(),
  attachmentKey: path,
  label: fileName(path),
  referencePath: path,
  source: 'file',
});

const workspaceReference = (reference: WorkspaceReferenceRequest): SemanticAttachmentReference => ({
  id: crypto.randomUUID(),
  attachmentKey: `workspace:${reference.sessionId ?? 'current'}:${reference.relativePath}`,
  label: reference.relativePath.split('/').at(-1) ?? reference.relativePath,
  referencePath: reference.relativePath,
  source: 'workspace',
});

/** Hook that manages Guid input text, uploaded files, and workspace references. */
export const useGuidInput = ({ locationState }: UseGuidInputOptions): GuidInputResult => {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [attachmentReferences, setAttachmentReferences] = useState<SemanticAttachmentReference[]>([]);
  const [attachmentQuickViewIds, setAttachmentQuickViewIds] = useState<Readonly<Record<string, string>>>({});
  const [workspaceQuickViewRequests, setWorkspaceQuickViewRequests] = useState<
    Readonly<Record<string, Readonly<{ sessionId: string; relativePath: string }>>>
  >({});
  const [, setAttachmentCaret] = useState(0);
  const attachmentCaretRef = useRef(0);
  const [workspaceReferences, setWorkspaceReferences] = useState<WorkspaceReferenceAttachment[]>([]);
  const [dir, setDir] = useState<string>('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (locationState?.workspace) setDir(locationState.workspace);
  }, [locationState]);

  // The editor text owns attachment membership. Browser Backspace/Delete and text
  // replacement can remove a chip without calling its × handler; reconcile every
  // transport list from the remaining owned tokens so no phantom files are sent.
  useEffect(() => {
    const owned = new Set(referencedAttachmentIds(input, attachmentReferences));
    if (attachmentReferences.every((reference) => owned.has(reference.id))) return;
    const remaining = attachmentReferences.filter((reference) => owned.has(reference.id));
    const filePaths = new Set(remaining.filter((reference) => reference.source === 'file').map((reference) => reference.attachmentKey));
    const workspacePaths = new Set(remaining.filter((reference) => reference.source === 'workspace').map((reference) => reference.referencePath));
    const workspaceKeys = new Set(remaining.filter((reference) => reference.source === 'workspace').map((reference) => reference.attachmentKey));
    setAttachmentReferences(remaining);
    setFiles((previous) => previous.filter((file) => filePaths.has(file)));
    setWorkspaceReferences((previous) => previous.filter((reference) => workspacePaths.has(reference.relativePath)));
    setAttachmentQuickViewIds((previous) => Object.fromEntries(Object.entries(previous).filter(([file]) => filePaths.has(file))));
    setWorkspaceQuickViewRequests((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => workspaceKeys.has(key))));
  }, [input, attachmentReferences]);

  const setCurrentAttachmentCaret = useCallback((caret: number) => {
    attachmentCaretRef.current = caret;
    setAttachmentCaret(caret);
  }, []);

  const insertSemanticReferencesAtCaret = useCallback((references: readonly SemanticAttachmentReference[]) => {
    if (!references.length) return;
    setAttachmentReferences((previous) => [...previous, ...references]);
    setInput((previous) => {
      let next = previous;
      let caret = Math.max(0, Math.min(attachmentCaretRef.current, previous.length));
      for (const reference of references) {
        const insertion = insertAttachmentReference(next, caret, reference);
        next = insertion.value;
        caret = insertion.caret;
      }
      attachmentCaretRef.current = caret;
      setAttachmentCaret(caret);
      return next;
    });
  }, []);

  const addFileReferences = useCallback(
    (paths: string[]) => {
      setFiles((previous) => [...previous, ...paths]);
      insertSemanticReferencesAtCaret(paths.map(fileReference));
    },
    [insertSemanticReferencesAtCaret]
  );

  const handleFilesPasted = useCallback(
    (pastedFiles: FileMetadata[]) => {
      addFileReferences(pastedFiles.map((file) => file.path));
    },
    [addFileReferences]
  );
  const handleFilesUploaded = useCallback(
    (uploadedPaths: string[], selections: readonly AttachmentQuickViewSelection[] = []) => {
      setAttachmentQuickViewIds((previous) => {
        const next = { ...previous };
        for (const selection of selections) next[selection.path] = selection.attachmentId;
        return next;
      });
      addFileReferences(uploadedPaths);
    },
    [addFileReferences]
  );
  const handleRemoveFile = useCallback((targetPath: string) => {
    setInput((previous) => attachmentReferences
      .filter((reference) => reference.source === 'file' && reference.attachmentKey === targetPath)
      .reduce((next, reference) => next.split(attachmentReferenceToken(reference.id)).join(''), previous));
    setFiles((previous) => previous.filter((file) => file !== targetPath));
    setAttachmentReferences((previous) => previous.filter((reference) => reference.attachmentKey !== targetPath));
    setAttachmentQuickViewIds((previous) => {
      const { [targetPath]: _removed, ...rest } = previous;
      return rest;
    });
  }, [attachmentReferences]);
  const removeAttachmentReference = useCallback((referenceId: string) => {
    setInput((previous) => removeAttachmentReferenceToken(previous, referenceId));
  }, []);
  const handleExplorerReferencesAdded = useCallback(
    (references: WorkspaceReferenceRequest[], workspaceRoot?: string) => {
      if (workspaceRoot) setDir(workspaceRoot);
      const added = references.map(workspaceReference);
      setWorkspaceReferences((previous) => {
        const next = new Map(previous.map((reference) => [reference.relativePath, reference]));
        for (const reference of references) {
          next.set(reference.relativePath, {
            id: workspaceReferenceId(reference.relativePath),
            relativePath: reference.relativePath,
            name: reference.relativePath.split('/').at(-1) ?? reference.relativePath,
            kind: reference.kind,
            projectionStatus: 'pending',
          });
        }
        return [...next.values()];
      });
      setWorkspaceQuickViewRequests((previous) => {
        const next = { ...previous };
        for (const reference of references) {
          if (reference.kind === 'file' && reference.sessionId) {
            next[`workspace:${reference.sessionId}:${reference.relativePath}`] = {
              sessionId: reference.sessionId,
              relativePath: reference.relativePath,
            };
          }
        }
        return next;
      });
      insertSemanticReferencesAtCaret(added);
    },
    [insertSemanticReferencesAtCaret]
  );
  const handleRemoveWorkspaceReference = useCallback((relativePath: string) => {
    setWorkspaceReferences((previous) => previous.filter((reference) => reference.relativePath !== relativePath));
    setAttachmentReferences((previous) => {
      const removed = previous.filter(
        (reference) => reference.source === 'workspace' && reference.referencePath === relativePath
      );
      if (removed.length) {
        setInput((value) =>
          removed.reduce((next, reference) => next.split(attachmentReferenceToken(reference.id)).join(''), value)
        );
        setWorkspaceQuickViewRequests((quickViews) => {
          const next = { ...quickViews };
          for (const reference of removed) delete next[reference.attachmentKey];
          return next;
        });
      }
      return previous.filter(
        (reference) => reference.source !== 'workspace' || reference.referencePath !== relativePath
      );
    });
  }, []);

  const { isFileDragging, dragHandlers } = useDragUpload({
    supportedExts: allSupportedExts,
    onFilesAdded: handleFilesPasted,
    onExplorerReferencesAdded: handleExplorerReferencesAdded,
  });
  const { onPaste, onFocus } = usePasteService({
    supportedExts: allSupportedExts,
    onFilesAdded: handleFilesPasted,
    onTextPaste: (text: string) => {
      const textarea = document.activeElement as HTMLTextAreaElement | null;
      if (textarea && textarea.tagName === 'TEXTAREA') {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        const current = textarea.value;
        const next = current.slice(0, start) + text + current.slice(end);
        setInput(next);
        setCurrentAttachmentCaret(start + text.length);
        setTimeout(() => {
          const position = start + text.length;
          textarea.setSelectionRange(position, position);
          scrollCaretToLastLine(textarea, measureCaretTop(textarea, position));
        }, 0);
      } else {
        setInput((previous) => previous + text);
      }
    },
  });

  return {
    input,
    setInput,
    files,
    setFiles,
    attachmentReferences,
    attachmentQuickViewIds,
    workspaceQuickViewRequests,
    setAttachmentCaret: setCurrentAttachmentCaret,
    removeAttachmentReference,
    workspaceReferences,
    setWorkspaceReferences,
    handleExplorerReferencesAdded,
    handleRemoveWorkspaceReference,
    dir,
    setDir,
    isInputFocused,
    loading,
    setLoading,
    handleFilesPasted,
    handleFilesUploaded,
    handleRemoveFile,
    handleTextareaFocus: () => {
      onFocus();
      setIsInputFocused(true);
    },
    handleTextareaBlur: () => setIsInputFocused(false),
    onPaste,
    isFileDragging,
    dragHandlers,
  };
};
