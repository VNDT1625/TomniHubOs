/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two small markdown extensions for chat messages, written against the syntax tree so they need no HTML:
 *  - `==text==` becomes a highlighted `<mark>`;
 *  - a block quote that starts with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`
 *    (GitHub alerts) becomes a coloured callout with a title.
 * Code, inline code and links are never touched.
 */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

export type AlertKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export const ALERT_TITLES: Readonly<Record<AlertKind, string>> = {
  note: 'Ghi chú',
  tip: 'Mẹo',
  important: 'Quan trọng',
  warning: 'Cảnh báo',
  caution: 'Thận trọng',
};

const HIGHLIGHT = /==(?!\s)([^=\n]+?)(?<!\s)==/gu;
const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n)?/iu;
const SKIPPED_PARENTS = new Set(['code', 'inlineCode', 'link', 'linkReference', 'definition', 'html', 'math']);

const highlightNodes = (value: string): MdNode[] | undefined => {
  HIGHLIGHT.lastIndex = 0;
  if (!HIGHLIGHT.test(value)) return undefined;
  HIGHLIGHT.lastIndex = 0;
  const nodes: MdNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(HIGHLIGHT)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push({ type: 'text', value: value.slice(cursor, start) });
    nodes.push({
      type: 'emphasis',
      data: { hName: 'mark' },
      children: [{ type: 'text', value: match[1] }],
    });
    cursor = start + match[0].length;
  }
  if (cursor < value.length) nodes.push({ type: 'text', value: value.slice(cursor) });
  return nodes;
};

const rewriteHighlights = (node: MdNode): void => {
  if (!node.children || SKIPPED_PARENTS.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    const replaced = child.type === 'text' && child.value !== undefined ? highlightNodes(child.value) : undefined;
    if (replaced) {
      next.push(...replaced);
    } else {
      rewriteHighlights(child);
      next.push(child);
    }
  }
  node.children = next;
};

/** Turns a block quote that opens with an alert marker into a titled, coloured callout. */
const rewriteAlert = (node: MdNode): void => {
  if (node.type === 'blockquote' && node.children?.[0]?.type === 'paragraph') {
    const paragraph = node.children[0];
    const first = paragraph.children?.[0];
    const match = first?.type === 'text' && first.value !== undefined ? ALERT_MARKER.exec(first.value) : null;
    if (match && first?.value !== undefined && paragraph.children) {
      const kind = match[1].toLowerCase() as AlertKind;
      first.value = first.value.slice(match[0].length);
      if (first.value === '') paragraph.children.shift();
      if (paragraph.children.length === 0) node.children.shift();
      node.children.unshift({
        type: 'paragraph',
        data: { hName: 'p', hProperties: { className: ['md-alert-title'] } },
        children: [{ type: 'text', value: ALERT_TITLES[kind] }],
      });
      node.data = { ...node.data, hProperties: { className: ['md-alert', `md-alert-${kind}`] } };
    }
  }
  for (const child of node.children ?? []) rewriteAlert(child);
};

export const remarkRichText = () => (tree: MdNode) => {
  rewriteAlert(tree);
  rewriteHighlights(tree);
};
