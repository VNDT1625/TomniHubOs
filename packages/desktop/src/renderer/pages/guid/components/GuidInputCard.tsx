/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AttachmentQuickView } from '@/common/chat/attachmentQuickView';
import type { SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import AttachmentQuickViewPopover from '@/renderer/components/chat/AttachmentQuickView';
import SemanticAttachmentEditor from '@/renderer/components/chat/SemanticAttachmentEditor';
import SlashCommandMenu from '@/renderer/components/chat/SlashCommandMenu';
import UploadProgressBar from '@/renderer/components/media/UploadProgressBar';
import { useCommandPaletteController } from '@/renderer/hooks/chat/useCommandPaletteController';
import { useCompositionInput } from '@/renderer/hooks/chat/useCompositionInput';
import { usePackageCommandSummaries } from '@/renderer/hooks/chat/useSlashCommands';
import { packageCommandPaletteItems } from '@/renderer/utils/chat/commandPalette';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from '../index.module.css';
import GuidWorkspaceFootnote from './GuidWorkspaceFootnote';

type GuidInputCardProps = {
  variant?: 'default' | 'hub';
  input: string;
  onInputChange: (value: string) => void;
  onAttachmentCaretChange: (caret: number) => void;
  onRemoveAttachmentReference: (referenceId: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onPaste: React.ClipboardEventHandler;
  onFocus: () => void;
  onBlur: () => void;
  placeholder: string;
  isInputActive: boolean;
  isFileDragging: boolean;
  activeBorderColor: string;
  inactiveBorderColor: string;
  activeShadow: string;
  dragHandlers: React.HTMLAttributes<HTMLDivElement>;
  mentionOpen: boolean;
  mentionSelectorBadge: React.ReactNode;
  mentionDropdown: React.ReactNode;
  attachmentReferences: readonly SemanticAttachmentReference[];
  quickViews?: Readonly<Record<string, () => Promise<AttachmentQuickView>>>;
  actionRow: React.ReactNode;
  workspaceDir: string;
  onSelectWorkspace: (dir: string) => void;
  onClearWorkspace: () => void;
};

const GuidInputCard: React.FC<GuidInputCardProps> = ({
  variant = 'default',
  input,
  onInputChange,
  onAttachmentCaretChange,
  onRemoveAttachmentReference,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur,
  placeholder,
  isInputActive,
  isFileDragging,
  activeBorderColor,
  inactiveBorderColor,
  activeShadow,
  dragHandlers,
  mentionOpen,
  mentionSelectorBadge,
  mentionDropdown,
  attachmentReferences,
  quickViews,
  actionRow,
  workspaceDir,
  onSelectWorkspace,
  onClearWorkspace,
}) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { compositionHandlers, isComposing } = useCompositionInput();
  const [caretPosition, setCaretPosition] = useState(0);
  const [inlineQuickViewPath, setInlineQuickViewPath] = useState<string>();
  const [inlineQuickView, setInlineQuickView] = useState<AttachmentQuickView>();
  const [inlineQuickViewLoading, setInlineQuickViewLoading] = useState(false);
  const composerRef = useRef<HTMLDivElement>(null);
  const inlineQuickViewRequestRef = useRef(0);
  const inlineQuickViewCloseTimerRef = useRef<number | undefined>(undefined);
  const packageCommandSummaries = usePackageCommandSummaries();
  const packageSlashItems = useMemo(
    () => packageCommandPaletteItems(packageCommandSummaries),
    [packageCommandSummaries]
  );
  const palette = useCommandPaletteController({
    input,
    caretPosition,
    extraSlashCommands: packageSlashItems,
    onSelect: (nextText, nextCaret) => {
      onInputChange(nextText);
      setCaretPosition(nextCaret);
      onAttachmentCaretChange(nextCaret);
    },
  });
  const paletteOpen = palette.isOpen && palette.activeQuery?.prefix !== '@' && !mentionOpen;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (isComposing.current) return;
    if (paletteOpen && palette.onKeyDown(event)) return;
    onKeyDown(event);
  };

  const borderColor = isFileDragging
    ? 'rgb(var(--primary-3))'
    : isInputActive
      ? activeBorderColor
      : inactiveBorderColor;

  const onCaretChange = useCallback(
    (caret: number) => {
      setCaretPosition(caret);
      onAttachmentCaretChange(caret);
    },
    [onAttachmentCaretChange]
  );

  const cancelInlineQuickViewClose = useCallback(() => {
    if (inlineQuickViewCloseTimerRef.current !== undefined) {
      window.clearTimeout(inlineQuickViewCloseTimerRef.current);
      inlineQuickViewCloseTimerRef.current = undefined;
    }
  }, []);

  const dismissInlineQuickView = useCallback(() => {
    cancelInlineQuickViewClose();
    inlineQuickViewRequestRef.current += 1;
    setInlineQuickViewPath(undefined);
    setInlineQuickView(undefined);
    setInlineQuickViewLoading(false);
  }, [cancelInlineQuickViewClose]);

  useEffect(() => {
    if (inlineQuickViewPath && !attachmentReferences.some((reference) => reference.attachmentKey === inlineQuickViewPath)) {
      dismissInlineQuickView();
    }
  }, [attachmentReferences, dismissInlineQuickView, inlineQuickViewPath]);

  useEffect(() => {
    const onOtherPreview = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === 'inventory') dismissInlineQuickView();
    };
    window.addEventListener('tomni:attachment-preview-open', onOtherPreview);
    return () => {
      window.removeEventListener('tomni:attachment-preview-open', onOtherPreview);
      cancelInlineQuickViewClose();
      inlineQuickViewRequestRef.current += 1;
    };
  }, [cancelInlineQuickViewClose, dismissInlineQuickView]);

  const openInlineQuickView = useCallback(
    (reference: SemanticAttachmentReference) => {
      const loadQuickView = quickViews?.[reference.attachmentKey];
      if (!loadQuickView) return;
      window.dispatchEvent(new CustomEvent('tomni:attachment-preview-open', { detail: 'composer' }));
      cancelInlineQuickViewClose();
      const requestId = ++inlineQuickViewRequestRef.current;
      setInlineQuickViewPath(reference.attachmentKey);
      setInlineQuickViewLoading(true);
      setInlineQuickView(undefined);
      void loadQuickView()
        .then((result) => {
          if (requestId === inlineQuickViewRequestRef.current) setInlineQuickView(result);
        })
        .catch(() => {
          if (requestId === inlineQuickViewRequestRef.current) {
            setInlineQuickView({ kind: 'metadata', name: reference.label, size: 0, reason: 'unavailable' });
          }
        })
        .finally(() => {
          if (requestId === inlineQuickViewRequestRef.current) setInlineQuickViewLoading(false);
        });
    },
    [cancelInlineQuickViewClose, quickViews]
  );

  const scheduleInlineQuickViewClose = useCallback(() => {
    cancelInlineQuickViewClose();
    inlineQuickViewCloseTimerRef.current = window.setTimeout(dismissInlineQuickView, 180);
  }, [cancelInlineQuickViewClose, dismissInlineQuickView]);

  const inlineQuickViewLabel = inlineQuickViewPath
    ? (attachmentReferences.find((reference) => reference.attachmentKey === inlineQuickViewPath)?.label ??
      inlineQuickViewPath)
    : '';

  return (
    <div
      ref={composerRef}
      className={`${styles.guidInputCardWrap} ${variant === 'hub' ? styles.guidInputCardHub : ''} guid-input-card-shell relative rd-24px flex flex-col ${mentionOpen || paletteOpen ? 'overflow-visible' : 'overflow-hidden'} transition-all duration-200 ${isFileDragging ? 'b b-solid border-dashed guid-input-card-shell--dragging' : ''}`}
      style={{
        zIndex: 1,
        transition: 'box-shadow 0.25s ease',
        width: isMobile ? 'calc(100% + 28px)' : undefined,
        marginLeft: isMobile ? -14 : undefined,
        marginRight: isMobile ? -14 : undefined,
        ...(isFileDragging
          ? {
              backgroundColor: 'var(--color-primary-light-1)',
              borderColor: 'rgb(var(--primary-3))',
              borderWidth: '1px',
            }
          : { boxShadow: isInputActive ? activeShadow : 'none' }),
      }}
      {...dragHandlers}
    >
      <div
        className={`${styles.guidInputInner} ${variant === 'hub' ? styles.guidInputInnerHub : ''} p-12px flex flex-col bg-dialog-fill-0`}
        style={{
          transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
          borderColor: isFileDragging ? 'rgb(var(--primary-3))' : borderColor,
          boxShadow: isInputActive && !isFileDragging ? activeShadow : 'none',
        }}
      >
        {mentionSelectorBadge}
        <SemanticAttachmentEditor
          value={input}
          references={attachmentReferences}
          onValueChange={onInputChange}
          onCaretChange={onCaretChange}
          caretOffset={caretPosition}
          onRemoveReference={onRemoveAttachmentReference}
          onQuickViewReference={openInlineQuickView}
          onQuickViewReferenceLeave={scheduleInlineQuickViewClose}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`semantic-attachment-editor ${variant === 'hub' ? styles.guidInputTextAreaHub : ''}`}
          testId='guid-input'
          {...compositionHandlers}
        />
        {inlineQuickViewPath && (
          <AttachmentQuickViewPopover
            label={inlineQuickViewLabel}
            anchor={composerRef.current}
            result={inlineQuickView}
            loading={inlineQuickViewLoading}
            onMouseEnter={cancelInlineQuickViewClose}
            onMouseLeave={scheduleInlineQuickViewClose}
            onFocus={cancelInlineQuickViewClose}
            onBlur={scheduleInlineQuickViewClose}
          />
        )}
        <div style={{ height: variant === 'hub' ? 4 : 12, flexShrink: 0 }} aria-hidden='true' />
        {mentionOpen && (
          <div className='hub-composer-suggestion-menu absolute left-16px bottom-[calc(100%+8px)] z-90'>
            {mentionDropdown}
          </div>
        )}
        <UploadProgressBar source='sendbox' />
        {actionRow}
      </div>
      {paletteOpen && (
        <div className='hub-composer-suggestion-menu absolute left-12px right-12px bottom-[calc(100%+8px)] z-90'>
          <SlashCommandMenu
            title={palette.menuTitle}
            hint={palette.menuHint}
            items={palette.items}
            activeIndex={palette.activeIndex}
            onHoverItem={palette.setActiveIndex}
            onSelectItem={(item) => {
              const selected = palette.items.find((candidate) => candidate.key === item.key);
              if (selected) palette.selectItem(selected);
            }}
            emptyText=''
          />
        </div>
      )}
      {variant === 'default' && (
        <GuidWorkspaceFootnote
          workspaceDir={workspaceDir}
          onSelectWorkspace={onSelectWorkspace}
          onClearWorkspace={onClearWorkspace}
        />
      )}
    </div>
  );
};

export default GuidInputCard;
