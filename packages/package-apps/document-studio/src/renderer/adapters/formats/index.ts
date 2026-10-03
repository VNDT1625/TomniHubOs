/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registers every concrete editor adapter (tasks 8.4–8.9) into the
 * {@link UniversalEditor} registry. Importing this module for its side effect
 * wires the adapters; the editor frame imports it once so all kinds resolve to a
 * real component (with `'raw-text'` already provided inline as the fallback).
 *
 * Adapters are registered lazily (`React.lazy`) so their (sometimes heavy) code
 * is only loaded when a matching file is opened — honoring "tải theo nhu cầu".
 */

import React from 'react';
import { registerEditorAdapter } from '@renderer/pages/editor/adapterRegistry';

// Monaco/LSP is owned by com.tomni.ide. The base document surface deliberately
// falls back to raw text until that package is installed and mounted.
registerEditorAdapter(
  'docx',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/DocxAdapter'))
);
registerEditorAdapter(
  'spreadsheet',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/SpreadsheetAdapter'))
);
registerEditorAdapter(
  'slide',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/SlideAdapter'))
);
registerEditorAdapter(
  'pdf',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/PdfAdapter'))
);
registerEditorAdapter(
  'image',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/ImageAdapter'))
);
registerEditorAdapter(
  'media',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/MediaAdapter'))
);
registerEditorAdapter(
  'binary-inspect',
  React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/BinaryInspectAdapter'))
);
