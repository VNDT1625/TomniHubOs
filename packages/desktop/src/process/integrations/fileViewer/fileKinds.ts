/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** What the centre file viewer can show, decided from the extension alone (content is sniffed only for unknown ones). */

export type ViewerKind = 'markdown' | 'code' | 'text' | 'image' | 'pdf' | 'unknown';

export type ViewerClassification = Readonly<{ kind: ViewerKind; language?: string; mime?: string }>;

const MARKDOWN = new Set(['.md', '.markdown', '.mdx']);
const TEXT = new Set(['.txt', '.log', '.csv', '.tsv', '.ini', '.cfg', '.conf', '.env', '.rtf']);
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
/** Highlight language per extension. SVG and HTML are shown as source, never rendered, so no script can run. */
const CODE_LANGUAGE: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.xml': 'xml',
  '.svg': 'xml',
  '.html': 'xml',
  '.htm': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ps1': 'powershell',
  '.bat': 'dos',
  '.cmd': 'dos',
  '.diff': 'diff',
  '.patch': 'diff',
};

/**
 * Types the operating system opens as data. Anything else (scripts, programs, shortcuts, installers) is never handed
 * to the shell, because "open with the default app" would execute it.
 */
const EXTERNAL_OPEN = new Set([
  ...MARKDOWN,
  ...Object.keys(IMAGE_MIME),
  '.pdf',
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ini',
]);

export const extensionOf = (name: string): string => {
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index).toLowerCase();
};

export const classifyExtension = (extension: string): ViewerClassification => {
  if (MARKDOWN.has(extension)) return { kind: 'markdown' };
  if (extension === '.pdf') return { kind: 'pdf', mime: 'application/pdf' };
  const image = IMAGE_MIME[extension];
  if (image) return { kind: 'image', mime: image };
  const language = CODE_LANGUAGE[extension];
  if (language) return { kind: 'code', language };
  if (TEXT.has(extension)) return { kind: 'text' };
  return { kind: 'unknown' };
};

export const canOpenExternally = (extension: string): boolean => EXTERNAL_OPEN.has(extension);
