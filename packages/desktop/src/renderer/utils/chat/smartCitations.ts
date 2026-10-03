/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Citation {
  id: string;
  index: number;
  label: string;
  urlOrPath: string;
  snippet?: string;
}

/**
 * Extracts and normalizes smart citations from LLM markdown output:
 * Formats supported:
 * 1. [^1]: https://example.com/doc or [^1]: src/main.ts "Snippet"
 * 2. [source: path/to/file.ts#L1-L10]
 * 3. [1](https://example.com)
 */
export function parseSmartCitations(text: string): {
  cleanText: string;
  citations: Citation[];
} {
  if (!text || typeof text !== 'string') {
    return { cleanText: '', citations: [] };
  }

  const citations: Citation[] = [];
  const citationMap = new Map<string, Citation>();

  // 1. Match footnote definitions at the bottom: [^1]: url "snippet" or [1]: url
  const footnoteDefRegex = /^\[\^?(\d+)\]:\s*(\S+)(?:\s+"([^"]+)")?$/gm;
  let match: RegExpExecArray | null;

  while ((match = footnoteDefRegex.exec(text)) !== null) {
    const id = match[1];
    const urlOrPath = match[2];
    const snippet = match[3] || undefined;
    const citation: Citation = {
      id,
      index: parseInt(id, 10),
      label: `[${id}]`,
      urlOrPath,
      snippet,
    };
    citations.push(citation);
    citationMap.set(id, citation);
  }

  // Remove footnote definitions from main content
  let cleanText = text.replace(footnoteDefRegex, '').trimEnd();

  // 2. Match inline [source: path/file.ts]
  const inlineSourceRegex = /\[source:\s*([^\]]+)\]/g;
  let inlineCount = citations.length + 1;
  cleanText = cleanText.replace(inlineSourceRegex, (_, path: string) => {
    const id = String(inlineCount++);
    const citation: Citation = {
      id,
      index: parseInt(id, 10),
      label: `[${id}]`,
      urlOrPath: path.trim(),
    };
    citations.push(citation);
    return `[^${id}]`;
  });

  return { cleanText, citations };
}
