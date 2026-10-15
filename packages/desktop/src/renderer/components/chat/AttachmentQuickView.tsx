import type { AttachmentQuickView as AttachmentQuickViewResult } from '@/common/chat/attachmentQuickView';
import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type AttachmentQuickViewProps = {
  label: string;
  result: AttachmentQuickViewResult | undefined;
  loading: boolean;
  anchor?: HTMLElement | null;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
};

const AttachmentQuickView: React.FC<AttachmentQuickViewProps> = ({
  label,
  result,
  loading,
  anchor,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}) => {
  const { t } = useTranslation();
  const reasonLabel = result?.kind === 'metadata' ? t(`common.attachmentQuickView.${result.reason}`) : '';
  const bounds = anchor?.getBoundingClientRect();
  const anchoredStyle: React.CSSProperties | undefined = bounds
    ? {
        left: Math.max(12, bounds.left + 12),
        right: 'auto',
        width: Math.max(240, Math.min(440, bounds.width - 24, window.innerWidth - 24)),
        bottom: Math.max(12, window.innerHeight - bounds.top + 8),
      }
    : undefined;
  const content = (
    <div
      className='attachment-quick-view'
      style={anchoredStyle}
      role='status'
      aria-label={t('common.attachmentQuickView.label', { label })}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className='attachment-quick-view__header'>{label}</div>
      {loading ? (
        <div className='attachment-quick-view__state'>{t('common.attachmentQuickView.loading')}</div>
      ) : result?.kind === 'text' ? (
        <pre className='attachment-quick-view__content'>{result.content}</pre>
      ) : result?.kind === 'image' ? (
        <img
          className='attachment-quick-view__image'
          src={result.dataUrl}
          alt={label}
          width={result.width || undefined}
          height={result.height || undefined}
        />
      ) : result ? (
        <div className='attachment-quick-view__state'>{reasonLabel}</div>
      ) : null}
    </div>
  );

  return typeof document === 'undefined' ? content : createPortal(content, document.body);
};

export default AttachmentQuickView;
