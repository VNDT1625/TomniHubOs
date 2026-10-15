/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { buildSafeHtmlDocument, MAX_HTML_PREVIEW_CHARS } from './sandboxDocument';
import { useThrottledHtmlPreview } from './useThrottledHtmlPreview';
import SeamlessHtmlFrame from './SeamlessHtmlFrame';

type HtmlLiveBlockProps = Readonly<{ source: string; fileName?: string; streaming?: boolean; onOpen?: () => void }>;

/** Preview small interactive HTML lessons directly in chat, with inspectable source. */
const HtmlLiveBlock: React.FC<HtmlLiveBlockProps> = ({ source, fileName, streaming = false, onOpen }) => {
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const tooLarge = source.length > MAX_HTML_PREVIEW_CHARS;
  const displayedHtml = useThrottledHtmlPreview(source, streaming);
  return (
    <section className='tomni-html-live' data-testid='html-live-block'>
      <div className='tomni-html-live-toolbar'>
        <span className='tomni-html-live-label'>{fileName ?? 'HTML'}</span>
        <div className='tomni-html-live-tabs' role='group' aria-label='HTML display mode'>
          <button type='button' aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
            Giao diện
          </button>
          <button type='button' aria-pressed={tab === 'source'} onClick={() => setTab('source')}>
            Mã nguồn
          </button>
        </div>
        {onOpen && (
          <button type='button' data-testid='code-block-open-in-panel' onClick={onOpen}>
            Mở trong Preview
          </button>
        )}
      </div>
      {streaming && (
        <p className='tomni-html-live-progress' role='status'>
          Đang viết code… Giao diện đang cập nhật trực tiếp.
        </p>
      )}
      {tooLarge && tab === 'preview' ? (
        <p role='alert' className='tomni-html-live-notice'>
          Nội dung HTML quá lớn để chạy trong tin nhắn. Chuyển sang Mã nguồn để xem nội dung.
        </p>
      ) : tab === 'preview' ? (
        <SeamlessHtmlFrame documentHtml={buildSafeHtmlDocument(displayedHtml)} />
      ) : (
        <pre className='tomni-html-live-source'>
          <code>{source}</code>
        </pre>
      )}
      <p className='tomni-html-live-notice'>
        Chạy thử HTML/CSS/JS trong sandbox ngoại tuyến; không có quyền truy cập tệp, ứng dụng hoặc mạng.
      </p>
    </section>
  );
};

export default HtmlLiveBlock;
