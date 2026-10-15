/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import ReactMarkdown from 'react-markdown';

import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// Import KaTeX CSS to make it available in the document
import 'katex/dist/katex.min.css';

import { ipcBridge } from '@/common';
import { openExternalUrl } from '@/renderer/utils/platform';
import classNames from 'classnames';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { convertLatexDelimiters } from '@renderer/utils/chat/latexDelimiters';
import LocalImageView from '@renderer/components/media/LocalImageView';
import RemoteImageView from './RemoteImageView';
import CodeBlock from './CodeBlock';
import { remarkRichText } from './remarkRichText';
import ShadowView from './ShadowView';

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBreaks, remarkRichText];

const isLocalFilePath = (src: string): boolean => {
  if (src.startsWith('http://') || src.startsWith('https://')) return false;
  if (src.startsWith('data:')) return false;
  return true;
};

const isExternalLink = (href: string): boolean => {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('file:');
};

const decodeMarkdownHref = (href: string, attributeHref?: string): string => {
  const rawHref = attributeHref || href;
  const withoutFileProtocol = rawHref.replace(/^file:\/\//i, '');
  return decodeURIComponent(withoutFileProtocol);
};

const getContentTypeFromPath = (path: string) => {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'html' || extension === 'htm') return 'html';
  return 'code';
};

type PreviewOpenEvent = {
  content: string;
  contentType: ReturnType<typeof getContentTypeFromPath>;
  metadata: {
    file_path: string;
    file_name: string;
    title: string;
  };
};

const openLocalFileInPreview = async (path: string): Promise<boolean> => {
  const content = await ipcBridge.fs.readFile.invoke({ path });
  if (content === null) return false;

  const normalizedPath = path.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').pop() || path;
  window.dispatchEvent(
    new CustomEvent<PreviewOpenEvent>('preview.open', {
      detail: {
        content,
        contentType: getContentTypeFromPath(path),
        metadata: {
          file_path: path,
          file_name: fileName,
          title: fileName,
        },
      },
    })
  );
  return true;
};

type MarkdownViewProps = {
  children: string;
  hiddenCodeCopyButton?: boolean;
  codeStyle?: React.CSSProperties;
  className?: string;
  onRef?: (el?: HTMLDivElement | null) => void;
  /** Enable raw HTML rendering in markdown content. Use with caution — only for trusted sources. */
  allowHtml?: boolean;
  /** Use dense typography for constrained surfaces such as Hub activity tiles. */
  compact?: boolean;
  /** Set by active agent tiles so previews can communicate ongoing code generation. */
  streaming?: boolean;
  /** Stable Hub tile id for linking an HTML Preview to full streamed code. */
  previewSourceId?: string;
};

const MarkdownView: React.FC<MarkdownViewProps> = React.memo(
  ({
    hiddenCodeCopyButton,
    codeStyle,
    className,
    onRef,
    allowHtml,
    compact = false,
    streaming = false,
    previewSourceId,
    children: childrenProp,
  }) => {
    const { t } = useTranslation();

    const normalizedChildren = useMemo(() => {
      if (typeof childrenProp === 'string') {
        let text = childrenProp.replace(/file:\/\//g, '');
        text = convertLatexDelimiters(text);
        return text;
      }
      return childrenProp;
    }, [childrenProp]);

    const handleLinkClick = useCallback(
      async (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const href = e.currentTarget.getAttribute('href');
        if (!href) return;

        if (isExternalLink(href)) {
          openExternalUrl(href).catch((error: unknown) => {
            console.error(t('messages.openLinkFailed'), error);
          });
          return;
        }

        const localPath = decodeMarkdownHref(href);
        await openLocalFileInPreview(localPath);
      },
      [t]
    );

    // Keep the Markdown component map stable across streaming token updates.
    // Code renderer reads current values from a ref, rather than capturing the
    // ever-changing Markdown text or streaming status in a new component type.
    // Recreating the `code` component for each token remounted live HTML iframes.
    const liveCodeProps = React.useRef({
      codeStyle,
      hiddenCodeCopyButton,
      streaming,
      previewSourceId,
      normalizedChildren,
      handleLinkClick,
    });
    liveCodeProps.current = {
      codeStyle,
      hiddenCodeCopyButton,
      streaming,
      previewSourceId,
      normalizedChildren,
      handleLinkClick,
    };
    const components = useMemo(
      () => ({
        span: ({ node: _node, className: cn, children: ch, ...rest }: Record<string, unknown>) => (
          <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)} className={cn as string}>
            {ch as React.ReactNode}
          </span>
        ),
        code: (props: Record<string, unknown>) => {
          const current = liveCodeProps.current;
          const offset = (props.node as { position?: { start?: { offset?: number } } } | undefined)?.position?.start
            ?.offset;
          const blockIndex =
            typeof offset === 'number'
              ? (current.normalizedChildren
                  .slice(0, offset)
                  .match(/^ {0,3}`{3,}[ \t]*(?:html|htm)(?::[^\s`]+)?[ \t]*$/gim)?.length ?? 0)
              : 0;
          return (
            <CodeBlock
              {...(props as Parameters<typeof CodeBlock>[0])}
              codeStyle={current.codeStyle}
              hiddenCodeCopyButton={current.hiddenCodeCopyButton}
              streaming={current.streaming}
              previewSourceId={current.previewSourceId}
              previewBlockIndex={blockIndex}
            />
          );
        },
        a: ({ node: _node, ...rest }: Record<string, unknown>) => (
          <a
            {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
            target='_blank'
            rel='noreferrer'
            onClick={(event) => {
              void liveCodeProps.current.handleLinkClick(event);
            }}
          />
        ),
        table: ({ node: _node, ...rest }: Record<string, unknown>) => (
          <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <table
              {...(rest as React.TableHTMLAttributes<HTMLTableElement>)}
              style={{
                ...(rest as { style?: React.CSSProperties }).style,
                borderCollapse: 'collapse',
                border: '1px solid var(--bg-3)',
                minWidth: '100%',
              }}
            />
          </div>
        ),
        td: ({ node: _node, ...rest }: Record<string, unknown>) => (
          <td
            {...(rest as React.TdHTMLAttributes<HTMLTableCellElement>)}
            style={{
              ...(rest as { style?: React.CSSProperties }).style,
              padding: '8px',
              border: '1px solid var(--bg-3)',
              minWidth: '120px',
            }}
          />
        ),
        img: ({ node: _node, ...rest }: Record<string, unknown>) => {
          const imgProps = rest as React.ImgHTMLAttributes<HTMLImageElement>;
          if (isLocalFilePath(imgProps.src || '')) {
            const src = decodeURIComponent(imgProps.src || '');
            return <LocalImageView src={src} alt={imgProps.alt || ''} className={imgProps.className} />;
          }
          // Preserve existing embedded raster screenshots; only remote links get source badges.
          if (
            /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(imgProps.src || '') &&
            (imgProps.src?.length ?? 0) < 2_000_000
          ) {
            return <img src={imgProps.src} alt={imgProps.alt || ''} />;
          }
          return <RemoteImageView src={imgProps.src || ''} alt={imgProps.alt || ''} />;
        },
      }),
      []
    );

    const rehypePlugins = useMemo(() => (allowHtml ? [rehypeRaw, rehypeKatex] : [rehypeKatex]), [allowHtml]);

    return (
      <div className={classNames('relative w-full', className)}>
        <ShadowView>
          <div ref={onRef} className={classNames('markdown-shadow-body', 'tomni-md-body', compact && 'markdown-shadow-body--compact')}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={rehypePlugins} components={components}>
              {normalizedChildren}
            </ReactMarkdown>
          </div>
        </ShadowView>
      </div>
    );
  }
);

MarkdownView.displayName = 'MarkdownView';

export default MarkdownView;
