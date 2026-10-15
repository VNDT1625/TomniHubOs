/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileViewerContent, FileViewerDocument } from '@/common/integrations/library/libraryContracts';
import { canOpenExternally, classifyExtension, extensionOf } from './fileKinds';
import { openRegularFile, readPrefix, toFileError } from './safeFile';

/** Byte caps of one read. Text is cut (and flagged); images and PDFs over their cap are not sent at all. */
export type FileViewerLimits = Readonly<{ textBytes: number; imageBytes: number; pdfBytes: number }>;

export const DEFAULT_FILE_VIEWER_LIMITS: FileViewerLimits = {
  textBytes: 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  pdfBytes: 30 * 1024 * 1024,
};

const SNIFF_BYTES = 8192;
const PDF_MAGIC = '%PDF-';

const decodeText = (bytes: Buffer, truncated: boolean): string => {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // A cut can split a multi-byte character; drop the replacement it leaves instead of showing a stray glyph.
  return truncated && text.endsWith('�') ? text.slice(0, -1) : text;
};

/**
 * Reads one file for the viewer. `absolutePath` must come from Main (an Explorer grant or a Library entry), never
 * from the renderer; it is still re-validated here because the file system can change between grant and read.
 */
export const readViewerDocument = async (
  absolutePath: string,
  limits: FileViewerLimits = DEFAULT_FILE_VIEWER_LIMITS
): Promise<FileViewerDocument> => {
  const file = await openRegularFile(absolutePath);
  try {
    const extension = extensionOf(file.name);
    const classification = classifyExtension(extension);
    const size = file.info.size;
    const describe = (content: FileViewerContent): FileViewerDocument => ({
      name: file.name,
      extension,
      sizeBytes: size,
      modifiedAt: file.info.mtimeMs,
      canOpenExternal: canOpenExternally(extension),
      content,
    });

    if (classification.kind === 'image' || classification.kind === 'pdf') {
      const limit = classification.kind === 'image' ? limits.imageBytes : limits.pdfBytes;
      if (size > limit) return describe({ kind: 'too-large', limitBytes: limit });
      // One byte beyond the cap detects a file that grew after the size check.
      const bytes = await readPrefix(file.handle, limit + 1);
      if (bytes.length > limit) return describe({ kind: 'too-large', limitBytes: limit });
      if (classification.kind === 'pdf' && bytes.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
        return describe({ kind: 'unsupported' });
      }
      return describe({
        kind: classification.kind,
        mime: classification.mime ?? 'application/octet-stream',
        base64: bytes.toString('base64'),
      });
    }

    const bytes = await readPrefix(file.handle, Math.min(size, limits.textBytes) + 1);
    const truncated = bytes.length > limits.textBytes || size > limits.textBytes;
    const visible = truncated ? bytes.subarray(0, limits.textBytes) : bytes;
    // Binary data is never shown as text: a NUL in the first block is the conventional tell.
    if (visible.subarray(0, SNIFF_BYTES).includes(0)) return describe({ kind: 'unsupported' });
    const text = decodeText(visible, truncated);
    const kind = classification.kind === 'unknown' ? 'text' : classification.kind;
    return describe({
      kind,
      text,
      truncated,
      ...(classification.language ? { language: classification.language } : {}),
    });
  } catch (error) {
    throw toFileError(error);
  } finally {
    await file.handle.close().catch((): undefined => undefined);
  }
};
