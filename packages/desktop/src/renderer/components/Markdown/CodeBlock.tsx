/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { Copy, Down, PreviewOpen, Up } from '@icon-park/react';
import katex from 'katex';
import classNames from 'classnames';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { vs, vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import type { PreviewContentType } from '@/common/types/office/preview';
import { copyText } from '@/renderer/utils/ui/clipboard';
import ChartBlock from './ChartBlock';
import MermaidBlock from './MermaidBlock';
import SpotlightBlock from './SpotlightBlock';
import RichUiBlock from './richUi/RichUiBlock';
import HtmlLiveBlock from './htmlPreview/HtmlLiveBlock';
import { formatCode, getDiffLineStyle, isInlinePath, toUnifiedDiff } from './markdownUtils';

const PREVIEW_LINES = 3;
// code span: font-size 13px, line-height 20px (per ShadowView injection)
const CODE_LINE_HEIGHT = 20;
// SyntaxHighlighter pre padding: 0.5em top + 0.5em bottom ≈ 13px each side
const CODE_PADDING_VERTICAL = 13;
const COLLAPSED_HEIGHT = PREVIEW_LINES * CODE_LINE_HEIGHT + CODE_PADDING_VERTICAL;

/** Blocks the preview panel can render instead of showing as text; anything else opens as code. */
const RENDERED_PREVIEW: Readonly<Record<string, PreviewContentType>> = {
  html: 'html',
  htm: 'html',
  svg: 'html',
  markdown: 'markdown',
  md: 'markdown',
  diff: 'diff',
  patch: 'diff',
};

/**
 * Opens a block in the conversation's preview panel (rendered view, editing, download, full screen).
 * Uses the panel's window event so a block shown outside a conversation simply does nothing.
 */
const openBlockInPreview = (content: string, language: string, fileName?: string): void => {
  window.dispatchEvent(
    new CustomEvent('preview.open', {
      detail: {
        content: RENDERED_PREVIEW[language] === 'diff' ? toUnifiedDiff(content, fileName) : content,
        contentType: RENDERED_PREVIEW[language] ?? 'code',
        metadata: { language, title: fileName || language, ...(fileName ? { file_name: fileName } : {}) },
      },
    })
  );
};

type CodeBlockProps = {
  children: string;
  className?: string;
  node?: unknown;
  hiddenCodeCopyButton?: boolean;
  streaming?: boolean;
  previewSourceId?: string;
  previewBlockIndex?: number;
  codeStyle?: React.CSSProperties;
  [key: string]: unknown;
};

/** How long the chip shows its copied state, in milliseconds. */
const CHIP_COPIED_MS = 1200;

/**
 * Inline code drawn as a chip. Clicking (or Enter/Space) copies the text unless the user has an
 * active text selection. Path-shaped text gets the file-path token color.
 */
export const InlineCodeChip = React.memo(function InlineCodeChip({ text, isPath }: { text: string; isPath: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const copy = React.useCallback(() => {
    const selection = typeof window !== 'undefined' ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && selection.toString().length > 0) return;
    copyText(text)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCopied(false), CHIP_COPIED_MS);
      })
      .catch(() => {
        try {
          Message.error(t('common.copyFailed'));
        } catch {
          /* ignore */
        }
      });
  }, [text, t]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    copy();
  };

  return (
    <code
      role='button'
      tabIndex={0}
      aria-label={t('common.copy')}
      data-copied={copied ? 'true' : undefined}
      data-copied-label={t('common.copiedInline')}
      className={classNames('tomni-md-chip', isPath && 'tomni-md-chip--path')}
      onClick={copy}
      onKeyDown={onKeyDown}
    >
      {text}
    </code>
  );
});


function CodeBlock(props: CodeBlockProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewId = React.useId();
  const openedHtml = useRef(false);
  const htmlSource = String(props.children ?? '');
  const htmlStreaming = props.streaming === true;
  React.useEffect(() => {
    // Hub previews receive the complete streamed document from Main, not the 8K tile summary.
    if (!openedHtml.current || props.previewSourceId) return undefined;
    const timer = window.setTimeout(
      () => {
        window.dispatchEvent(
          new CustomEvent('preview.update', {
            detail: { previewId, content: htmlSource, pending: htmlStreaming },
          })
        );
      },
      htmlStreaming ? 1000 : 0
    );
    return () => clearTimeout(timer);
  }, [htmlSource, htmlStreaming, previewId, props.previewSourceId]);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light'
  );

  React.useEffect(() => {
    const update = () => {
      setCurrentTheme((document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'light');
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const toggleExpanded = () => {
    const willCollapse = expanded;
    setExpanded((v) => !v);
    if (willCollapse && containerRef.current) {
      requestAnimationFrame(() => {
        containerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      });
    }
  };

  const {
    children,
    className,
    node: _node,
    hiddenCodeCopyButton: _h,
    streaming: _s,
    previewSourceId: _source,
    previewBlockIndex: _ordinal,
    codeStyle: _c,
    ...rest
  } = props;
  const match = /language-([\w-]+)(?::([\w.-]+))?/.exec(className || '');
  const language = match?.[1] || 'text';
  // `html:index.html` names the file the block is meant to become.
  const fileName = match?.[2];

  // KaTeX math blocks
  if (language === 'latex' || language === 'math' || language === 'tex') {
    const latexSource = String(children).replace(/\n$/, '');
    const isFullDocument = /\\(documentclass|begin\{document\}|usepackage)\b/.test(latexSource);
    if (!isFullDocument) {
      try {
        const html = katex.renderToString(latexSource, { displayMode: true, throwOnError: false });
        return <div className='katex-display' dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        // fall through
      }
    }
  }

  if (language === 'tomni-ui' || language === 'rich-ui') {
    return <RichUiBlock source={String(children)} />;
  }

  if (language === 'html' || language === 'htm') {
    return (
      <HtmlLiveBlock
        source={String(children)}
        fileName={fileName}
        streaming={htmlStreaming}
        onOpen={() => {
          openedHtml.current = true;
          window.dispatchEvent(
            new CustomEvent('preview.open', {
              detail: {
                content: htmlSource,
                contentType: 'html',
                metadata: {
                  language: 'html',
                  title: fileName ?? '',
                  file_name: fileName,
                  previewId,
                  pending: htmlStreaming,
                  ...(props.previewSourceId
                    ? { sourceId: props.previewSourceId, blockIndex: props.previewBlockIndex ?? 0 }
                    : {}),
                },
              },
            })
          );
        }}
      />
    );
  }

  if (language === 'chart') {
    return <ChartBlock source={String(children)} />;
  }

  if (language === 'spotlight') {
    return <SpotlightBlock source={String(children)} />;
  }

  if (language === 'mermaid') {
    return <MermaidBlock code={formatCode(children)} style={props.codeStyle} />;
  }

  // Inline code (single line). Plain inline spans become chips; fenced single lines keep the code style.
  if (!String(children).includes('\n')) {
    if (!className) {
      const text = String(children);
      return <InlineCodeChip text={text} isPath={isInlinePath(text)} />;
    }
    return (
      <code {...rest} className={className} style={{ fontWeight: 'bold' }}>
        {children}
      </code>
    );
  }

  const isDiff = language === 'diff';
  const formattedContent = formatCode(children);
  const totalLines = formattedContent.split('\n').length;
  const canCollapse = totalLines > PREVIEW_LINES;
  const codeTheme = currentTheme === 'dark' ? vs2015 : vs;
  const diffLines = isDiff ? formattedContent.split('\n') : [];
  const isDark = currentTheme === 'dark';

  const handleCopy = () => {
    void copyText(formattedContent)
      .then(() => {
        try {
          Message.success(t('common.copySuccess'));
        } catch {
          /* Shadow DOM portal may fail silently */
        }
      })
      .catch(() => {
        try {
          Message.error(t('common.copyFailed'));
        } catch {
          /* ignore */
        }
      });
  };

  const iconFill = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
  const footerTextColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const bgColor = isDark ? 'rgba(255,255,255,0.04)' : 'var(--bg-2)';

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minWidth: 0, maxWidth: '100%', ...props.codeStyle }}
      className='group'
    >
      <div style={{ backgroundColor: bgColor, borderRadius: '8px', overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
          }}
        >
          <span style={{ color: footerTextColor, fontSize: '12px', lineHeight: '16px' }}>
            {fileName || language.toLocaleLowerCase()}
          </span>
          {/* Buttons: always visible on touch devices, hover-only on pointer devices */}
          <div
            className='opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity'
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {canCollapse && (
              <span title={expanded ? t('common.collapse') : t('common.expand')} style={{ display: 'flex' }}>
                {expanded ? (
                  <Up
                    theme='outline'
                    size='14'
                    style={{ cursor: 'pointer', display: 'block' }}
                    fill={iconFill}
                    onClick={toggleExpanded}
                  />
                ) : (
                  <Down
                    theme='outline'
                    size='14'
                    style={{ cursor: 'pointer', display: 'block' }}
                    fill={iconFill}
                    onClick={toggleExpanded}
                  />
                )}
              </span>
            )}
            <span title={t('preview.openInPanelTooltip')} style={{ display: 'flex' }}>
              <PreviewOpen
                data-testid='code-block-open-in-panel'
                theme='outline'
                size='14'
                style={{ cursor: 'pointer', display: 'block' }}
                fill={iconFill}
                onClick={() => openBlockInPreview(formattedContent, language.toLowerCase(), fileName)}
              />
            </span>
            <span title={t('common.copy')} style={{ display: 'flex' }}>
              <Copy
                theme='outline'
                size='14'
                style={{ cursor: 'pointer', display: 'block' }}
                fill={iconFill}
                onClick={handleCopy}
              />
            </span>
          </div>
        </div>

        {/* Code content — always full content, clipped by maxHeight when collapsed */}
        <div
          style={{
            maxHeight: canCollapse && !expanded ? `${COLLAPSED_HEIGHT}px` : 'none',
            overflowY: 'hidden',
            overflowX: 'visible',
          }}
        >
          <SyntaxHighlighter
            children={formattedContent}
            language={language}
            style={codeTheme}
            PreTag='div'
            wrapLines={isDiff}
            lineProps={
              isDiff
                ? (lineNumber: number) => ({
                    style: {
                      display: 'block',
                      ...getDiffLineStyle(diffLines[lineNumber - 1] || '', isDark),
                    },
                  })
                : undefined
            }
            customStyle={{
              margin: 0,
              padding: '0 12px 8px',
              borderRadius: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              overflowX: 'auto',
              maxWidth: '100%',
            }}
            codeTagProps={{
              style: {
                color: 'var(--text-primary)',
                background: 'transparent',
              },
            }}
          />
        </div>

        {/* Footer */}
        {canCollapse && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '6px 12px',
              cursor: 'pointer',
              gap: '4px',
              borderTop: `1px solid ${borderColor}`,
            }}
            onClick={toggleExpanded}
          >
            <span style={{ color: footerTextColor, fontSize: '12px' }}>
              {expanded ? t('common.collapse') : t('common.viewMoreLines', { count: totalLines - PREVIEW_LINES })}
            </span>
            {expanded ? (
              <Up theme='outline' size='12' fill={footerTextColor} />
            ) : (
              <Down theme='outline' size='12' fill={footerTextColor} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CodeBlock;
