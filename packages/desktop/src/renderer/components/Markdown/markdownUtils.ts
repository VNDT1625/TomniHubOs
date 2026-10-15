/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

import { diffColors } from '@/renderer/styles/colors';

/**
 * Format raw code string, attempting JSON pretty-print.
 * Falls back to stripped trailing newline if parsing fails.
 */
export const formatCode = (code: string): string => {
  const content = String(code).replace(/\n$/, '');
  try {
    return JSON.stringify(
      JSON.parse(content),
      (_key, value) => {
        return value;
      },
      2
    );
  } catch (_error) {
    return content;
  }
};

/**
 * Conditional render helper — returns trueComponent when condition is true,
 * falseComponent otherwise.
 */
export const logicRender = <T, F>(condition: boolean, trueComponent: T, falseComponent?: F): T | F => {
  return condition ? trueComponent : (falseComponent as F);
};

/**
 * Get line background style for diff rendering.
 * Highlights additions (green), deletions (red), and hunk headers (blue).
 */
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

/**
 * The diff viewer only draws diffs that name a file. Models often write just the hunk (or only +/- lines),
 * so add the file lines, and a hunk line when there is none, without changing the lines themselves.
 */
export const toUnifiedDiff = (text: string, fileName = 'snippet'): string => {
  const lines = text.split(LF).map((line) => (line.endsWith(CR) ? line.slice(0, -1) : line));
  if (lines.some((line) => line.startsWith('diff --git') || line.startsWith('--- '))) return text;
  const body = lines.some((line) => line.startsWith('@@'))
    ? lines
    : [
        `@@ -1,${lines.filter((line) => !line.startsWith('+')).length} +1,${lines.filter((line) => !line.startsWith('-')).length} @@`,
        ...lines,
      ];
  return [`--- a/${fileName}`, `+++ b/${fileName}`, ...body].join(LF);
};

/** Longest inline code span checked for path shape; keeps detection O(short string). */
const INLINE_PATH_MAX_LENGTH = 260;
const PATH_SEGMENT = /^[\w@.+~-]+$/;

/**
 * True when inline code is a file path or bare file name (e.g. src/app.ts, C:\dir\a.md, README.md).
 * Only called for inline code spans; prose is never scanned. Commands with spaces are not paths.
 */
export const isInlinePath = (text: string): boolean => {
  if (text.length === 0 || text.length > INLINE_PATH_MAX_LENGTH || /\s/.test(text)) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  const body = text.replace(/^[A-Za-z]:(?=[\\/])/, '').replace(/^~(?=[\\/])/, '');
  const segments = body.split(/[\\/]+/).filter((segment) => segment.length > 0);
  if (segments.length === 0 || !segments.every((segment) => PATH_SEGMENT.test(segment))) return false;
  if (/[\\/]/.test(body)) return true;
  return /\.[A-Za-z][A-Za-z0-9]{1,7}$/.test(body);
};


export const getDiffLineStyle = (line: string, isDark: boolean): React.CSSProperties => {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { backgroundColor: isDark ? diffColors.additionBgDark : diffColors.additionBgLight };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { backgroundColor: isDark ? diffColors.deletionBgDark : diffColors.deletionBgLight };
  }
  if (line.startsWith('@@')) {
    return { backgroundColor: isDark ? diffColors.hunkBgDark : diffColors.hunkBgLight };
  }
  return {};
};
