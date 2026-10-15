/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import mermaid from 'mermaid';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';

import { copyText } from '@/renderer/utils/ui/clipboard';
import { Message } from '@arco-design/web-react';
import { Copy, PreviewOpen } from '@icon-park/react';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import PanZoomFrame from './PanZoomFrame';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type MermaidBlockProps = {
  code: string;
  style?: React.CSSProperties;
  showOpenInPanelButton?: boolean;
};

let initializedTheme: 'light' | 'dark' | null = null;
const ensureMermaidInitialized = (theme: 'light' | 'dark') => {
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: theme === 'dark' ? 'dark' : 'default',
        fontFamily: 'system-ui, sans-serif',
    themeVariables: { fontSize: '16px' },
    flowchart: { useMaxWidth: false, nodeSpacing: 36, rankSpacing: 56 },
  });
  initializedTheme = theme;
};

/**
 * Keep oversized diagrams at a legible intrinsic width, rather than shrinking
 * thousands of pixels of Mermaid text into a 700px chat bubble.
 */
export const withResponsiveSvg = (svg: string): string => {
  const match = /<svg\b([^>]*)>/i.exec(svg);
  if (!match) return svg;
  const attrs = match[1];
  const viewBox = /\bviewBox=["'][\d.\s-]+\s([\d.]+)\s+([\d.]+)["']/i.exec(attrs);
  const declaredWidth = /\bwidth=["']([\d.]+)(?:px)?["']/i.exec(attrs);
  const naturalWidth = Number(viewBox?.[1] ?? declaredWidth?.[1] ?? 0);
  const wide = Number.isFinite(naturalWidth) && naturalWidth > 840;
  const width = wide ? Math.min(Math.ceil(naturalWidth), 2600) : null;
  const sizing = wide ? `width:${width}px;max-width:none;` : 'max-width:100%;';
  const styleAttr = /\sstyle=(["'])(.*?)\1/i.exec(attrs);
  const originalStyle = styleAttr?.[2] ?? '';
  const cleanAttrs = styleAttr ? attrs.replace(styleAttr[0], '') : attrs;
  return svg.replace(match[0], `<svg${cleanAttrs} style="${originalStyle};${sizing}height:auto;display:block;">`);
};

function MermaidBlock({ code, style, showOpenInPanelButton = true }: MermaidBlockProps) {
  const { t } = useTranslation();
  const { openPreview } = usePreviewContext();
  const blockIdRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);
  const preferredViewModeRef = useRef<'preview' | 'source' | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('source');
  // Zoom and pan are opt-in, so a diagram keeps flowing with the message until the reader wants to explore it.
  const [zoomMode, setZoomMode] = useState(false);
  const [debouncedCode, setDebouncedCode] = useState(code);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() => {
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedCode(code), 300);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    const updateTheme = () => {
      const theme = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light';
      setCurrentTheme(theme);
    };

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const source = debouncedCode.trim();

    if (!source) {
      setSvg(null);
      setIsRendering(false);
      setViewMode('source');
      return () => {
        cancelled = true;
      };
    }

    setSvg(null);
    setIsRendering(true);

    const renderDiagram = async () => {
      try {
        ensureMermaidInitialized(currentTheme);

        const { svg: renderedSvg } = await mermaid.render(`${blockIdRef.current}-${Date.now()}`, source);

        if (!cancelled) {
          setSvg(withResponsiveSvg(renderedSvg));
          setIsRendering(false);
          setViewMode(preferredViewModeRef.current === 'source' ? 'source' : 'preview');
        }
      } catch {
        if (!cancelled) {
          setSvg(null);
          setIsRendering(false);
          setViewMode('source');
        }
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [debouncedCode, currentTheme]);

  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;
  const shouldShowLoading = isRendering && preferredViewModeRef.current !== 'source';
  const summary = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const previewTitle =
    summary && summary.length > 0
      ? `${t('preview.mermaidTitle')}: ${summary.slice(0, 48)}${summary.length > 48 ? '...' : ''}`
      : t('preview.mermaidTitle');

  return (
    <div style={{ width: '100%', minWidth: 0, maxWidth: '100%', ...style }}>
      <div
        style={{
          border: '1px solid var(--bg-3)',
          borderRadius: '0.3rem',
          overflow: 'hidden',
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'var(--bg-2)',
            borderTopLeftRadius: '0.3rem',
            borderTopRightRadius: '0.3rem',
            padding: '6px 10px',
            borderBottom: '1px solid var(--bg-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                textDecoration: 'none',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                lineHeight: '20px',
              }}
            >
              {'<mermaid>'}
            </span>
            {svg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div
                  style={{
                    cursor: 'pointer',
                    color: viewMode === 'preview' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    lineHeight: '20px',
                  }}
                  onMouseDown={(event: React.MouseEvent) => {
                    if (event.button === 0) {
                      event.preventDefault();
                      preferredViewModeRef.current = 'preview';
                      setViewMode('preview');
                    }
                  }}
                >
                  {t('preview.preview')}
                </div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '20px' }}>/</span>
                <div
                  style={{
                    cursor: 'pointer',
                    color: viewMode === 'source' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    lineHeight: '20px',
                  }}
                  onMouseDown={(event: React.MouseEvent) => {
                    if (event.button === 0) {
                      event.preventDefault();
                      preferredViewModeRef.current = 'source';
                      setViewMode('source');
                    }
                  }}
                >
                  {t('preview.source')}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {showOpenInPanelButton && (
              <PreviewOpen
                data-testid='mermaid-open-in-panel'
                theme='outline'
                size='18'
                style={{ cursor: 'pointer', flexShrink: 0 }}
                fill='var(--text-secondary)'
                title={t('preview.openInPanelTooltip')}
                onClick={() => {
                  openPreview(`\`\`\`mermaid\n${code}\n\`\`\``, 'markdown', {
                    title: previewTitle,
                    editable: false,
                  });
                }}
              />
            )}
            {svg && viewMode === 'preview' && (
              <span
                role='button'
                tabIndex={0}
                data-testid='mermaid-zoom-toggle'
                style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '20px' }}
                onClick={() => setZoomMode((value) => !value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setZoomMode((value) => !value);
                }}
              >
                {zoomMode ? 'Thu gọn' : 'Phóng to / kéo'}
              </span>
            )}
            <Copy
              data-testid='mermaid-copy'
              theme='outline'
              size='18'
              style={{ cursor: 'pointer', flexShrink: 0 }}
              fill='var(--text-secondary)'
              onClick={() => {
                void copyText(code)
                  .then(() => {
                    Message.success(t('common.copySuccess'));
                  })
                  .catch(() => {
                    Message.error(t('common.copyFailed'));
                  });
              }}
            />
          </div>
        </div>

        {svg && viewMode === 'preview' && zoomMode ? (
          <div style={{ backgroundColor: 'var(--bg-1)', padding: '8px 12px' }}>
            <PanZoomFrame svgMarkup={svg} filename='so-do' label='Sơ đồ' height={460} testId='mermaid-zoom' />
          </div>
        ) : svg && viewMode === 'preview' ? (
          <div
            data-testid='mermaid-diagram'
            aria-label='Sơ đồ Mermaid, cuộn để xem phần nằm ngoài khung'
            style={{
              backgroundColor: 'var(--bg-1)',
              padding: '12px',
                            overflowX: 'auto',
              overflowY: 'auto',
              maxHeight: 'min(520px, 65vh)',
              display: 'block',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : shouldShowLoading ? (
          <div
            data-testid='mermaid-loading'
            style={{
              backgroundColor: 'var(--bg-1)',
              padding: '16px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              lineHeight: '20px',
            }}
          >
            <div
              aria-hidden='true'
              className='loading'
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '999px',
                border: '2px solid var(--bg-3)',
                borderTopColor: 'var(--text-secondary)',
                flexShrink: 0,
              }}
            />
            <span>{t('preview.loading')}</span>
          </div>
        ) : (
          <SyntaxHighlighter
            children={code}
            language='mermaid'
            style={codeTheme}
            PreTag='div'
            customStyle={{
              margin: 0,
              borderRadius: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              overflowX: 'auto',
              maxWidth: '100%',
            }}
            codeTagProps={{ style: { color: 'var(--text-primary)' } }}
          />
        )}
      </div>
    </div>
  );
}

export default React.memo(MermaidBlock);
