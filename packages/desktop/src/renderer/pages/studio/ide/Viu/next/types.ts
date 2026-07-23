/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuProjectState, ViuTransactionResult } from '@/common/viu';

import type { ViuAuthoringInspectorLabels } from './authoring';

export type ViuEditorMode = 'design' | 'prototype' | 'present';

export type ViuNextLabels = {
  productName: string;
  modes: {
    design: string;
    prototype: string;
    present: string;
  };
  teamPreview: {
    publish: string;
    publishing: string;
    published: string;
    copyReference: string;
    unavailable: string;

    success: string;
    error: string;
    referenceCopied: string;
    purpose: string;
  };

  sidebar: {
    pages: string;
    layers: string;
    assets: string;
    components: string;
  };
  add: {
    frame: string;
    text: string;
    button: string;
    shape: string;
    pen: string;
  };
  canvas: {
    zoomIn: string;
    zoomOut: string;
    fit: string;
    panHint: string;
  };
  vectorEdit: {
    enter: string;
    exit: string;
    openPath: string;
    closePath: string;
    union: string;
    subtract: string;
    intersect: string;
    exclude: string;
    clipMask: string;
    alphaMask: string;
    releaseMask: string;
    reorderMask: string;
  };

  present: {
    back: string;
    closeOverlay: string;
    empty: string;
    route: string;
    exit: string;
  };
  authoring: ViuAuthoringInspectorLabels;
  authoringActions: {
    undo: string;
    redo: string;
    duplicate: string;
    delete: string;
    group: string;
    ungroup: string;
    alignLeft: string;
    alignCenter: string;
    alignRight: string;
    alignTop: string;
    alignMiddle: string;
    alignBottom: string;
    distributeHorizontal: string;
    distributeVertical: string;
  };
  inspector: {
    title: string;
    empty: string;
    name: string;
    position: string;
    size: string;
    x: string;
    y: string;
    width: string;
    height: string;
    type: string;
    visible: string;
    locked: string;
  };
  assets: {
    title: string;
    empty: string;
    linkAction: string;
    insertAction: string;
  };
  componentLibrary: {
    title: string;
    searchPlaceholder: string;
    empty: string;
    noResults: string;
    component: string;
    componentSet: string;
    variants: (count: number) => string;
    properties: (count: number) => string;
    insert: string;
    targetScreen: (name: string) => string;
    targetUnavailable: string;
    missingVariant: string;
    insertError: string;
  };
  agent: {
    title: string;
    placeholder: string;
    send: string;
  };
};

export type ViuNextCanvasProps = {
  labels: ViuNextLabels;
  project?: ViuProjectState;
  localAssets?: Array<{
    id: string;
    protocolUrl?: string;
    displayName: string;
    kind: string;
    missing: boolean;
  }>;
  onProjectChange?: (project: ViuProjectState, result: ViuTransactionResult) => void;
  onLinkAsset?: () => void;
  onAgentRequest?: (prompt: string) => void;

  teamPreviewReference?: string;
  teamPreviewBusy?: boolean;
  teamPreviewDisabled?: boolean;
  onPublishPreview?: () => void;
  onCopyPreviewReference?: () => void;
  onModeChange?: (mode: ViuEditorMode) => void;
  onSelectionChange?: (nodeId: string | null) => void;
  className?: string;
};
