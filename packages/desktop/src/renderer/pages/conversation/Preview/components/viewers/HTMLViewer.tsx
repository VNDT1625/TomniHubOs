/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */
import { Message } from '@arco-design/web-react';
import MonacoEditor from '@monaco-editor/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildSafeHtmlDocument,
  MAX_HTML_PREVIEW_CHARS,
} from '@/renderer/components/Markdown/htmlPreview/sandboxDocument';
import { useThrottledHtmlPreview } from '@/renderer/components/Markdown/htmlPreview/useThrottledHtmlPreview';

type HTMLPreviewProps = {
  content: string;
  file_path?: string;
  hideToolbar?: boolean;
  compactToolbar?: boolean;
  streaming?: boolean;
};

type SelectedElement = { path: string; html: string };

/** Only used inside an opaque-origin sandbox, and only when the user enables inspection. */
const INSPECTOR_SCRIPT = `<script>
(() => {
  let previous = null;
  document.addEventListener('mouseover', (event) => {
    if (previous) previous.style.outline = '';
    const node = event.target;
    if (!(node instanceof HTMLElement) || node === document.body) return;
    previous = node;
    node.style.outline = '2px solid #3b82f6';
  });
  document.addEventListener('click', (event) => {
    const node = event.target;
    if (!(node instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    const path = node.id ? '#' + node.id : node.tagName.toLowerCase();
    window.parent.postMessage({
      type: 'tomni-html-inspect',
      path: path.slice(0, 200),
      html: node.outerHTML.slice(0, 2000),
    }, '*');
  }, true);
})();
</script>`;

const HTMLViewer: React.FC<HTMLPreviewProps> = ({
  content,
  file_path,
  hideToolbar = false,
  compactToolbar = false,
  streaming = false,
}) => {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [messageApi, messageContextHolder] = Message.useMessage();
  const [htmlCode, setHtmlCode] = useState(content);
  const displayedHtml = useThrottledHtmlPreview(htmlCode, streaming);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [inspectorMode, setInspectorMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  );

  useEffect(() => {
    setHtmlCode(content);
  }, [content]);
  useEffect(() => {
    const update = () =>
      setCurrentTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Sandboxed srcdoc has an opaque 'null' origin; match the exact frame and bound payload.
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== 'null') return;
      if (!inspectorMode || typeof event.data !== 'object' || event.data === null) return;
      if (
        event.data.type !== 'tomni-html-inspect' ||
        typeof event.data.path !== 'string' ||
        typeof event.data.html !== 'string'
      )
        return;
      setSelectedElement({ path: event.data.path.slice(0, 200), html: event.data.html.slice(0, 2000) });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [inspectorMode]);

  const safeDocument = useMemo(
    () =>
      buildSafeHtmlDocument(
        inspectorMode
          ? displayedHtml.replace(/<\/body>/i, `${INSPECTOR_SCRIPT}</body>`) +
              (/<\/body>/i.test(displayedHtml) ? '' : INSPECTOR_SCRIPT)
          : displayedHtml
      ),
    [displayedHtml, inspectorMode]
  );

  const download = useCallback(() => {
    const url = URL.createObjectURL(new Blob([htmlCode], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (file_path?.split(/[\\/]/).pop() || 'document.html').replace(/[^a-z0-9._-]/gi, '_');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [htmlCode, file_path]);

  const tooLarge = htmlCode.length > MAX_HTML_PREVIEW_CHARS;
  return (
    <div className='h-full w-full flex flex-col bg-bg-1 min-w-0' data-testid='html-preview-viewer'>
      {messageContextHolder}
      {!hideToolbar && (
        <div
          className={`flex flex-wrap items-center justify-between gap-8px px-12px py-8px bg-bg-2 border-b border-border-base flex-shrink-0 ${compactToolbar ? 'html-preview-toolbar--compact' : ''}`}
        >
          <div className='flex gap-6px items-center' role='group' aria-label='HTML display mode'>
            <button
              type='button'
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
              className={`px-12px py-6px rd-6px text-12px ${mode === 'preview' ? 'bg-bg-3 font-600' : 'hover:bg-bg-3'}`}
            >
              Giao diện
            </button>
            <button
              type='button'
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
              className={`px-12px py-6px rd-6px text-12px ${mode === 'source' ? 'bg-bg-3 font-600' : 'hover:bg-bg-3'}`}
            >
              Mã nguồn
            </button>
          </div>
          <div className='flex flex-wrap items-center gap-6px'>
            <button
              type='button'
              disabled={mode !== 'preview'}
              aria-pressed={inspectorMode}
              className='px-10px py-6px rd-6px text-12px hover:bg-bg-3'
              onClick={() => {
                setInspectorMode((v) => !v);
                setSelectedElement(null);
              }}
            >
              {inspectorMode ? 'Tắt chọn phần tử' : t('preview.html.inspectorButton')}
            </button>
            <button type='button' className='px-10px py-6px rd-6px text-12px hover:bg-bg-3' onClick={download}>
              {t('common.download')}
            </button>
          </div>
        </div>
      )}
      {selectedElement && inspectorMode && (
        <div className='flex flex-wrap items-center gap-8px px-12px py-6px text-12px bg-bg-2'>
          <code>{selectedElement.path}</code>
          <button
            type='button'
            onClick={() => {
              void navigator.clipboard
                .writeText(selectedElement.html)
                .then(() => messageApi.success(t('preview.html.copySuccess')))
                .catch(() => messageApi.error(t('common.copyFailed')));
            }}
          >
            Sao chép HTML phần tử
          </button>
        </div>
      )}
      <div className='flex-1 min-h-0 w-full overflow-hidden'>
        {tooLarge && mode === 'preview' ? (
          <div className='p-16px text-13px' role='alert'>
            HTML vượt giới hạn xem thử an toàn. Hãy rút gọn nội dung.
          </div>
        ) : mode === 'source' && !hideToolbar ? (
          <MonacoEditor
            height='100%'
            language='html'
            theme={currentTheme === 'dark' ? 'vs-dark' : 'vs'}
            value={htmlCode}
            onChange={(value) => setHtmlCode(value ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              wordWrap: 'on',
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            className='w-full h-full border-0 bg-white'
            title='HTML Preview'
            sandbox='allow-scripts'
            referrerPolicy='no-referrer'
            srcDoc={safeDocument}
            data-testid='html-preview-frame'
          />
        )}
      </div>
    </div>
  );
};

export default HTMLViewer;
