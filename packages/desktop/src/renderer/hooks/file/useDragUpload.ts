/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseExplorerReferenceEntriesPayload,
  parseExplorerReferencePayload,
  type WorkspaceReferenceRequest,
} from '@/common/chat/workspaceReference';
import { Message } from '@arco-design/web-react';
import type { FileMetadata } from '@renderer/services/FileService';
import { FileService, isSupportedFile } from '@renderer/services/FileService';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const EXPLORER_ENTRIES_MIME = 'application/x-tomni-explorer-entries';
const EXPLORER_PATHS_MIME = 'application/x-tomni-explorer-paths';
const EXPLORER_WORKSPACE_ROOT_MIME = 'application/x-tomni-explorer-workspace-root';

export interface UseDragUploadOptions {
  supportedExts?: string[];
  onFilesAdded?: (files: FileMetadata[]) => void;
  /** Receives bounded, normalized Explorer-relative file/folder references. */
    onExplorerReferencesAdded?: (references: WorkspaceReferenceRequest[], workspaceRoot?: string) => void;
  /** Conversation ID for WebUI file uploads */
  conversation_id?: string;
}

export const useDragUpload = ({
  supportedExts = [],
  onFilesAdded,
  onExplorerReferencesAdded,
  conversation_id,
}: UseDragUploadOptions) => {
  const { t } = useTranslation();
  const [isFileDragging, setIsFileDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isFileDragging) {
        setIsFileDragging(true);
        dragCounter.current += 1;
      }
    },
    [isFileDragging]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    setIsFileDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsFileDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsFileDragging(false);

      const dataTransfer = e.nativeEvent.dataTransfer;
      const typedReferences = parseExplorerReferenceEntriesPayload(dataTransfer?.getData(EXPLORER_ENTRIES_MIME) ?? '');
      const explorerReferences =
        typedReferences.length > 0
          ? typedReferences
          : parseExplorerReferencePayload(dataTransfer?.getData(EXPLORER_PATHS_MIME) ?? '').map((relativePath) => ({
              relativePath,
              kind: 'file' as const,
            }));
            if (explorerReferences.length > 0 && onExplorerReferencesAdded) {
        const root = dataTransfer?.getData(EXPLORER_WORKSPACE_ROOT_MIME) ?? '';
        // UI hint only: Main still resolves and bounds every reference within the selected workspace.
        const workspaceRoot =
          root.length <= 2048 && (/^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\') || root.startsWith('/'))
            ? root
            : undefined;
        if (workspaceRoot) onExplorerReferencesAdded(explorerReferences, workspaceRoot);
        else onExplorerReferencesAdded(explorerReferences);
        return;
      }
      if (!onFilesAdded || !dataTransfer) return;

      try {
        const validFiles: File[] = [];
        for (let i = 0; i < dataTransfer.files.length; i++) {
          const file = dataTransfer.files[i];
          if (supportedExts.length === 0 || isSupportedFile(file.name, supportedExts)) validFiles.push(file);
        }
        if (validFiles.length > 0) {
          const validFileList = Object.assign(validFiles, {
            length: validFiles.length,
            item: (index: number) => validFiles[index] || null,
          }) as unknown as FileList;
          const processedFiles = await FileService.processDroppedFiles(validFileList, conversation_id);
          if (processedFiles.length > 0) onFilesAdded(processedFiles);
        }
      } catch (err) {
        console.error('Failed to process dropped files:', err);
        Message.error(t('conversation.workspace.dragFailed', 'Failed to process dropped files'));
      }
    },
    [conversation_id, onExplorerReferencesAdded, onFilesAdded, supportedExts, t]
  );

  return {
    isFileDragging,
    dragHandlers: { onDragOver: handleDragOver, onDragEnter: handleDragEnter, onDragLeave: handleDragLeave, onDrop: handleDrop },
  };
};
