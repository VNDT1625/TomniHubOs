/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileViewerContent } from '@/common/integrations/library/libraryContracts';
import MarkdownView from '@renderer/components/Markdown';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { explorerSize } from '@/renderer/pages/guid/HubHome/explorer/path';

type FileViewerBodyProps = { name: string; content: FileViewerContent };

/** An object URL for the bytes of a PDF, released when the document changes or the viewer closes. */
const usePdfUrl = (base64: string | undefined): string | undefined => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (base64 === undefined || typeof URL.createObjectURL !== 'function') {
      setUrl(undefined);
      return undefined;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [base64]);
  return url;
};

/** Renders what Main read. Nothing here executes file content: HTML and SVG arrive as source text. */
export const FileViewerBody: React.FC<FileViewerBodyProps> = ({ name, content }) => {
  const { t } = useTranslation();
  const pdfUrl = usePdfUrl(content.kind === 'pdf' ? content.base64 : undefined);

  switch (content.kind) {
    case 'unsupported':
      return (
        <p className='hub-fv-notice' role='status'>
          {t('guid.hubHome.fileViewer.unsupported')}
        </p>
      );
    case 'too-large':
      return (
        <p className='hub-fv-notice' role='status'>
          {t('guid.hubHome.fileViewer.tooLarge', { limit: explorerSize(content.limitBytes) })}
        </p>
      );
    case 'image':
      return (
        <div className='hub-fv-image'>
          <img
            src={`data:${content.mime};base64,${content.base64}`}
            alt={t('guid.hubHome.fileViewer.imageAlt', { name })}
          />
        </div>
      );
    case 'pdf':
      return pdfUrl ? (
        <embed
          className='hub-fv-pdf'
          type='application/pdf'
          src={pdfUrl}
          title={t('guid.hubHome.fileViewer.pdfTitle', { name })}
        />
      ) : null;
    default:
      return (
        <>
          {content.truncated && (
            <p className='hub-fv-notice' role='status'>
              {t('guid.hubHome.fileViewer.truncated')}
            </p>
          )}
          {content.kind === 'markdown' ? (
            <div className='hub-fv-markdown'>
              <MarkdownView>{content.text}</MarkdownView>
            </div>
          ) : content.kind === 'code' ? (
            <div className='hub-fv-code' data-testid='file-viewer-code'>
              <SyntaxHighlighter language={content.language} useInlineStyles={false} showLineNumbers>
                {content.text}
              </SyntaxHighlighter>
            </div>
          ) : (
            <pre className='hub-fv-text'>{content.text}</pre>
          )}
        </>
      );
  }
};
