/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Extract renderable, possibly unfinished HTML fences from streaming Markdown.
 * The live Hub activity output is already complete; this extractor provides
 * bounded HTML portions for the ephemeral UI without duplicating native IPC.
 */
export const MAX_HTML_STREAM_SIZE = 250_000;
export const extractHtmlPreviewBlocks = (markdown: string): string[] => {
  const blocks: string[] = [];
  const opener = /^ {0,3}`{3,}[ \t]*(?:html|htm)(?::[^\s`]+)?[ \t]*\r?$/gim;
  const closer = /^ {0,3}`{3,}[ \t]*\r?$/gm;
  let opened: RegExpExecArray | null;
  while ((opened = opener.exec(markdown)) && blocks.length < 4) {
    const start = opened.index + opened[0].length;
    const contentStart = markdown[start] === '\n' ? start + 1 : start;
    closer.lastIndex = contentStart;
    const closed = closer.exec(markdown);
    const end = closed?.index ?? markdown.length;
    blocks.push(markdown.slice(contentStart, end).slice(0, MAX_HTML_STREAM_SIZE).replace(/\n$/, ''));
    if (!closed) break;
    opener.lastIndex = closer.lastIndex;
  }
  return blocks;
};
