/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tag, Tooltip } from '@arco-design/web-react';
import {
  CheckOne,
  Copy,
  FullScreen,
  GraphicDesign,
  Left,
  PlayOne,
  Right,
  ShareOne,
  ZoomIn,
  ZoomOut,
} from '@icon-park/react';
import React from 'react';
import styles from '../ViuNextCanvas.module.css';
import type { ViuEditorMode, ViuNextLabels } from '../types';

type EditorHeaderProps = {
  labels: ViuNextLabels;
  projectTitle: string;
  mode: ViuEditorMode;
  zoom: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;

  teamPreviewReference?: string;
  teamPreviewBusy: boolean;
  teamPreviewDisabled: boolean;
  onModeChange: (mode: ViuEditorMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;

  onPublishPreview?: () => void;
  onCopyPreviewReference?: () => void;
};

const EditorHeader: React.FC<EditorHeaderProps> = ({
  labels,
  projectTitle,
  mode,
  zoom,
  leftCollapsed,
  rightCollapsed,

  teamPreviewReference,
  teamPreviewBusy,
  teamPreviewDisabled,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleLeft,
  onToggleRight,

  onPublishPreview,
  onCopyPreviewReference,
}) => (
  <header className={styles.commandBar}>
    <div className={styles.brandLockup}>
      <span className={styles.brandMark}>
        <GraphicDesign theme='outline' size={18} />
      </span>
      <div className={styles.brandCopy}>
        <strong>{labels.productName}</strong>
        <span title={projectTitle}>{projectTitle}</span>
      </div>
    </div>

    <div className={styles.modeSwitch} role='group'>
      {(['design', 'prototype', 'present'] as const).map((item) => (
        <Button
          key={item}
          type={mode === item ? 'primary' : 'text'}
          size='small'
          className={mode === item ? styles.modeButtonActive : styles.modeButton}
          data-testid={`viu-mode-${item}`}
          icon={item === 'present' ? <PlayOne size={14} /> : undefined}
          onClick={() => onModeChange(item)}
        >
          {labels.modes[item]}
        </Button>
      ))}
    </div>

    <div className={styles.commandActions}>
      {mode !== 'present' ? (
        <Tooltip content={labels.sidebar.layers}>
          <Button
            type={leftCollapsed ? 'secondary' : 'text'}
            size='small'
            className={styles.iconButton}
            aria-label={labels.sidebar.layers}
            data-testid='viu-toggle-left-panel'
            icon={leftCollapsed ? <Right size={15} /> : <Left size={15} />}
            onClick={onToggleLeft}
          />
        </Tooltip>
      ) : null}
      {onPublishPreview ? (
        <div className='flex items-center gap-6px'>
          <Tooltip content={teamPreviewDisabled ? labels.teamPreview.unavailable : labels.teamPreview.publish}>
            <Button
              type='primary'
              size='small'
              data-testid='viu-team-preview-publish'
              aria-label={labels.teamPreview.publish}
              icon={<ShareOne size={14} />}
              loading={teamPreviewBusy}
              disabled={teamPreviewDisabled}
              onClick={onPublishPreview}
            >
              {teamPreviewBusy ? labels.teamPreview.publishing : labels.teamPreview.publish}
            </Button>
          </Tooltip>
          {teamPreviewReference ? (
            <>
              <Tag size='small' color='green' icon={<CheckOne size={12} />}>
                {labels.teamPreview.published}
              </Tag>
              <Tooltip content={teamPreviewReference}>
                <Button
                  type='secondary'
                  size='small'
                  data-testid='viu-team-preview-copy'
                  aria-label={labels.teamPreview.copyReference}
                  icon={<Copy size={13} />}
                  onClick={onCopyPreviewReference}
                >
                  {labels.teamPreview.copyReference}
                </Button>
              </Tooltip>
            </>
          ) : null}
        </div>
      ) : null}
      <div className={styles.zoomCluster}>
        <Tooltip content={labels.canvas.zoomOut}>
          <Button
            aria-label={labels.canvas.zoomOut}
            size='small'
            type='text'
            className={styles.iconButton}
            icon={<ZoomOut size={15} />}
            onClick={onZoomOut}
          />
        </Tooltip>
        <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
        <Tooltip content={labels.canvas.zoomIn}>
          <Button
            aria-label={labels.canvas.zoomIn}
            size='small'
            type='text'
            className={styles.iconButton}
            icon={<ZoomIn size={15} />}
            onClick={onZoomIn}
          />
        </Tooltip>
        <Tooltip content={labels.canvas.fit}>
          <Button
            aria-label={labels.canvas.fit}
            size='small'
            type='text'
            className={styles.iconButton}
            icon={<FullScreen size={15} />}
            onClick={onFit}
          />
        </Tooltip>
      </div>
      {mode !== 'present' ? (
        <Tooltip content={labels.inspector.title}>
          <Button
            type={rightCollapsed ? 'secondary' : 'text'}
            size='small'
            className={styles.iconButton}
            aria-label={labels.inspector.title}
            data-testid='viu-toggle-right-panel'
            icon={rightCollapsed ? <Left size={15} /> : <Right size={15} />}
            onClick={onToggleRight}
          />
        </Tooltip>
      ) : null}
    </div>
  </header>
);

export default EditorHeader;
