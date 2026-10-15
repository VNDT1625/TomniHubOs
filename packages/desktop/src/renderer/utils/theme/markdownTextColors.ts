/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chat Markdown text tokens. Colors are deterministic display-system defaults:
 * the CSS constants in tomni-ui.css are the rendering source, and the table below
 * mirrors them for the Settings color inputs. No model or runtime AI picks colors.
 * A user override is stored in config and written as an inline --md-* property on the root;
 * resetting removes the override and the CSS default applies again.
 */
export const MARKDOWN_TEXT_TOKENS = [
  { id: 'h1', cssVar: '--md-h1', light: '#1d4ed8', dark: '#7aa2ff' },
  { id: 'h2', cssVar: '--md-h2', light: '#0f766e', dark: '#5fd4c0' },
  { id: 'h3', cssVar: '--md-h3', light: '#8a5a00', dark: '#e6c26b' },
  { id: 'text', cssVar: '--md-text', light: '#1c1f24', dark: '#e8eaee' },
  { id: 'bold', cssVar: '--md-bold', light: '#0a0b0d', dark: '#ffffff' },
  { id: 'link', cssVar: '--md-link', light: '#0550ae', dark: '#6cb6ff' },
  { id: 'path', cssVar: '--md-path', light: '#6d28d9', dark: '#c4a1ff' },
  { id: 'codeFg', cssVar: '--md-code-fg', light: '#a3320f', dark: '#ff9e7a' },
  { id: 'codeBg', cssVar: '--md-code-bg', light: '#1f2328', dark: '#000000' },
  { id: 'quote', cssVar: '--md-quote', light: '#4b5260', dark: '#aab0bb' },
] as const;

export type MarkdownTextTokenId = (typeof MARKDOWN_TEXT_TOKENS)[number]['id'];

/** Stored overrides keyed by token id. Absent keys use the deterministic defaults. */
export type MarkdownTextColors = Partial<Record<MarkdownTextTokenId, string>>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const isMarkdownTextColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX_COLOR.test(value);

/** Keeps only known tokens with valid #rrggbb values. Anything else is dropped. */
export const sanitizeMarkdownTextColors = (value: unknown): MarkdownTextColors => {
  if (typeof value !== 'object' || value === null) return {};
  const source = value as Record<string, unknown>;
  const result: MarkdownTextColors = {};
  for (const { id } of MARKDOWN_TEXT_TOKENS) {
    const candidate = source[id];
    if (isMarkdownTextColor(candidate)) result[id] = candidate.toLowerCase();
  }
  return result;
};

/**
 * Writes overrides as --md-* properties on the app root, or removes them so the CSS default applies.
 * Accepts untrusted stored config and sanitizes it first.
 */
export const applyMarkdownTextColors = (value: unknown, root: HTMLElement = document.documentElement): void => {
  const colors = sanitizeMarkdownTextColors(value);
  for (const { id, cssVar } of MARKDOWN_TEXT_TOKENS) {
    const override = colors[id];
    if (override) root.style.setProperty(cssVar, override);
    else root.style.removeProperty(cssVar);
  }
};

/** Default color of a token for the given theme, from the constant table. */
export const getDefaultMarkdownTextColor = (id: MarkdownTextTokenId, theme: 'light' | 'dark'): string => {
  const token = MARKDOWN_TEXT_TOKENS.find((entry) => entry.id === id);
  return token ? token[theme] : '#000000';
};
