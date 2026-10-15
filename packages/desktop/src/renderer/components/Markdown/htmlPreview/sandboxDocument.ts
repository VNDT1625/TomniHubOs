/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AI-authored HTML is untrusted. The iframe MUST use sandbox="allow-scripts"
 * without allow-same-origin. CSP prevents network requests, forms, plugins and
 * remote dependencies; inline CSS/JS still enables offline teaching demos.
 */
export const MAX_HTML_PREVIEW_CHARS = 250_000;
export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ');

export const buildSafeHtmlDocument = (html: string): string => {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`;
  // The CSP must be parsed before any untrusted script. Never add a file:// base.
  const source = html.slice(0, MAX_HTML_PREVIEW_CHARS);
  const existingHead = /<head\b[^>]*>/i.exec(source);
  const existingHtml = /<html\b[^>]*>/i.exec(source);
  // Insert CSP as the first element of an existing head, provided no active tag
  // could have executed before it. Otherwise prepend a locked-down head.
  if (existingHead && !/<(?:script|iframe|img|link|style)\b/i.test(source.slice(0, existingHead.index))) {
    return source.replace(existingHead[0], `${existingHead[0]}${head}`);
  }
  if (existingHtml && !/<(?:script|iframe|img|link|style)\b/i.test(source.slice(0, existingHtml.index))) {
    return source.replace(existingHtml[0], `${existingHtml[0]}<head>${head}</head>`);
  }
  const doctype = /^\s*<!doctype\s+html\s*>/i.exec(source);
  if (doctype) return source.replace(doctype[0], `${doctype[0]}<head>${head}</head>`);
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
};
