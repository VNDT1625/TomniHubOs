import { describe, expect, it } from 'vitest';
import {
  buildSafeHtmlDocument,
  HTML_PREVIEW_CSP,
  MAX_HTML_PREVIEW_CHARS,
} from '@/renderer/components/Markdown/htmlPreview/sandboxDocument';

describe('untrusted HTML preview sandbox', () => {
  it('adds restrictive CSP before user scripts while preserving runnable offline demos', () => {
    const result = buildSafeHtmlDocument(
      '<!doctype html><html><head><title>Demo</title></head><body><button>Go</button><script>window.clicked=true</script></body></html>'
    );
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('window.clicked'));
    expect(result).toContain('<button>Go</button>');
    expect(result).toContain('<head><meta charset=');
    expect(result).not.toContain('</head><html><head>');
    expect(HTML_PREVIEW_CSP).toContain("connect-src 'none'");
    expect(HTML_PREVIEW_CSP).not.toContain('unsafe-eval');
    expect(HTML_PREVIEW_CSP).toContain("base-uri 'none'");
  });
  it('wraps HTML fragments and limits source size', () => {
    expect(buildSafeHtmlDocument('<h1>Lesson</h1>')).toContain('<body><h1>Lesson</h1></body>');
    expect(buildSafeHtmlDocument('x'.repeat(MAX_HTML_PREVIEW_CHARS + 30)).length).toBeLessThan(
      MAX_HTML_PREVIEW_CHARS + 800
    );
  });
});
