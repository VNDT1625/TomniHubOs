/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Tooltip } from '@arco-design/web-react';
import {
  AlignTextBottom,
  AlignTextCenter,
  AlignTextLeft,
  AlignTextMiddle,
  AlignTextRight,
  AlignTextTop,
  Copy,
  Delete,
  DistributeHorizontally,
  DistributeVertically,
  Group,
  Redo,
  Undo,
  Ungroup,
} from '@icon-park/react';
import React from 'react';
import type { ViuAlignment, ViuDistributionAxis } from '@/common/viu/authoring';
import type { ViuNextLabels } from './types';

type ViuAuthoringToolbarProps = {
  labels: ViuNextLabels['authoringActions'];
  canUndo: boolean;
  canRedo: boolean;
  canMutate: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canAlign: boolean;
  canDistribute: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onAlign: (alignment: ViuAlignment) => void;
  onDistribute: (axis: ViuDistributionAxis) => void;
};

type ToolbarAction = {
  id: string;
  label: string;
  disabled: boolean;
  icon: React.ReactNode;
  danger?: boolean;
  run: () => void;
};

/** Compact structural-authoring command surface shared by pointer and keyboard workflows. */
const ViuAuthoringToolbar: React.FC<ViuAuthoringToolbarProps> = ({
  labels,
  canUndo,
  canRedo,
  canMutate,
  canGroup,
  canUngroup,
  canAlign,
  canDistribute,
  onUndo,
  onRedo,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
  onAlign,
  onDistribute,
}) => {
  const actions: ToolbarAction[] = [
    { id: 'undo', label: labels.undo, disabled: !canUndo, icon: <Undo size={14} />, run: onUndo },
    { id: 'redo', label: labels.redo, disabled: !canRedo, icon: <Redo size={14} />, run: onRedo },
    { id: 'duplicate', label: labels.duplicate, disabled: !canMutate, icon: <Copy size={14} />, run: onDuplicate },
    {
      id: 'delete',
      label: labels.delete,
      disabled: !canMutate,
      icon: <Delete size={14} />,
      danger: true,
      run: onDelete,
    },
    { id: 'group', label: labels.group, disabled: !canGroup, icon: <Group size={14} />, run: onGroup },
    { id: 'ungroup', label: labels.ungroup, disabled: !canUngroup, icon: <Ungroup size={14} />, run: onUngroup },
    {
      id: 'align-left',
      label: labels.alignLeft,
      disabled: !canAlign,
      icon: <AlignTextLeft size={14} />,
      run: () => onAlign('left'),
    },
    {
      id: 'align-center',
      label: labels.alignCenter,
      disabled: !canAlign,
      icon: <AlignTextCenter size={14} />,
      run: () => onAlign('horizontal-center'),
    },
    {
      id: 'align-right',
      label: labels.alignRight,
      disabled: !canAlign,
      icon: <AlignTextRight size={14} />,
      run: () => onAlign('right'),
    },
    {
      id: 'align-top',
      label: labels.alignTop,
      disabled: !canAlign,
      icon: <AlignTextTop size={14} />,
      run: () => onAlign('top'),
    },
    {
      id: 'align-middle',
      label: labels.alignMiddle,
      disabled: !canAlign,
      icon: <AlignTextMiddle size={14} />,
      run: () => onAlign('vertical-center'),
    },
    {
      id: 'align-bottom',
      label: labels.alignBottom,
      disabled: !canAlign,
      icon: <AlignTextBottom size={14} />,
      run: () => onAlign('bottom'),
    },
    {
      id: 'distribute-horizontal',
      label: labels.distributeHorizontal,
      disabled: !canDistribute,
      icon: <DistributeHorizontally size={14} />,
      run: () => onDistribute('horizontal'),
    },
    {
      id: 'distribute-vertical',
      label: labels.distributeVertical,
      disabled: !canDistribute,
      icon: <DistributeVertically size={14} />,
      run: () => onDistribute('vertical'),
    },
  ];

  return (
    <div className='grid grid-cols-7 gap-2px border-b border-b-1 bg-fill-1 p-6px'>
      {actions.map((action) => (
        <Tooltip key={action.id} content={action.label}>
          <Button
            data-testid={`viu-authoring-${action.id}`}
            type='text'
            size='mini'
            status={action.danger ? 'danger' : undefined}
            disabled={action.disabled}
            aria-label={action.label}
            icon={action.icon}
            onClick={action.run}
          />
        </Tooltip>
      ))}
    </div>
  );
};

export default ViuAuthoringToolbar;
