import type { AttachmentQuickView as AttachmentQuickViewResult } from '@/common/chat/attachmentQuickView';
import type { SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import AttachmentQuickView from '@/renderer/components/chat/AttachmentQuickView';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AttachmentInventoryRailProps = {
  references: readonly SemanticAttachmentReference[];
  onRemoveReference: (reference: SemanticAttachmentReference) => void;
  quickViews?: Readonly<Record<string, () => Promise<AttachmentQuickViewResult>>>;
  expanded?: boolean;
};

const AttachmentInventoryRail: React.FC<AttachmentInventoryRailProps> = ({
  references,
  onRemoveReference,
  quickViews = {},
  expanded: controlledExpanded,
}) => {
  const { t } = useTranslation();
  const [internalExpanded, setExpanded] = useState(false);
  const expanded = controlledExpanded ?? internalExpanded;
  const [activePath, setActivePath] = useState<string>();
  const [quickView, setQuickView] = useState<AttachmentQuickViewResult>();
  const [loadingQuickView, setLoadingQuickView] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const requestIdRef = useRef(0);
  const toggleLabel = t(
    expanded ? 'common.attachmentQuickView.hideAttachments' : 'common.attachmentQuickView.showAttachments',
    { count: references.length }
  );
  const activeLabel = activePath ? references.find((reference) => reference.attachmentKey === activePath)?.label ?? activePath : '';

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const dismissQuickView = useCallback(() => {
    cancelClose();
    requestIdRef.current += 1;
    setActivePath(undefined);
    setQuickView(undefined);
    setLoadingQuickView(false);
  }, [cancelClose]);

  useEffect(() => {
    if (!expanded || (activePath && !references.some((reference) => reference.attachmentKey === activePath))) {
      dismissQuickView();
    }
  }, [activePath, dismissQuickView, expanded, references]);

  useEffect(() => {
    const onOtherPreview = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === 'composer') dismissQuickView();
    };
    window.addEventListener('tomni:attachment-preview-open', onOtherPreview);
    return () => {
      window.removeEventListener('tomni:attachment-preview-open', onOtherPreview);
      cancelClose();
      requestIdRef.current += 1;
    };
  }, [cancelClose, dismissQuickView]);

  const showQuickView = useCallback(
    (path: string) => {
      const loadQuickView = quickViews[path];
      if (!loadQuickView) return;
      window.dispatchEvent(new CustomEvent('tomni:attachment-preview-open', { detail: 'inventory' }));
      cancelClose();
      const requestId = ++requestIdRef.current;
      setActivePath(path);
      setLoadingQuickView(true);
      setQuickView(undefined);
      void loadQuickView()
        .then((result) => {
          if (requestId === requestIdRef.current) setQuickView(result);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setQuickView({
              kind: 'metadata',
              name: references.find((reference) => reference.attachmentKey === path)?.label ?? path,
              size: 0,
              reason: 'unavailable',
            });
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoadingQuickView(false);
        });
    },
    [cancelClose, quickViews, references]
  );

  const scheduleQuickViewClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(dismissQuickView, 180);
  }, [cancelClose, dismissQuickView]);

  if (!references.length) return null;

  return (
    <div className='attachment-inventory'>
      {controlledExpanded === undefined && (
        <button
          type='button'
          className='attachment-inventory__toggle'
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={toggleLabel}
        >
          📎 {references.length} {expanded ? '⌃' : '⌄'}
        </button>
      )}
      {expanded && (
        <div className='attachment-inventory__rail' id='attachment-inventory-rail' data-testid='attachment-inventory-rail'>
          {references.map((reference) => {
            const { attachmentKey, id, label, source } = reference;
            return (
              <span
                className='attachment-inventory__item'
                data-attachment-source={source}
                key={id}
                onMouseEnter={() => showQuickView(attachmentKey)}
                onMouseLeave={scheduleQuickViewClose}
              >
                <span
                  className='attachment-inventory__name'
                  tabIndex={quickViews[attachmentKey] ? 0 : undefined}
                  onFocus={() => showQuickView(attachmentKey)}
                  onBlur={scheduleQuickViewClose}
                >
                  ▣ {label}
                </span>
                <button
                  type='button'
                  aria-label={t('common.attachmentQuickView.remove', { label })}
                  onClick={() => onRemoveReference(reference)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      {activePath && (
        <AttachmentQuickView
          label={activeLabel}
          anchor={document.querySelector<HTMLElement>('.hub-composer .guid-input-card-shell')}
          result={quickView}
          loading={loadingQuickView}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleQuickViewClose}
          onFocus={cancelClose}
          onBlur={scheduleQuickViewClose}
        />
      )}
    </div>
  );
};

export default AttachmentInventoryRail;
