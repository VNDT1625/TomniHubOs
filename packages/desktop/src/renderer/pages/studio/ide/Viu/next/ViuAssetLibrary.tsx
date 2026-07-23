/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Tooltip } from '@arco-design/web-react';
import { Cube, FolderOpen, Picture, VideoOne } from '@icon-park/react';
import React from 'react';

export const VIU_ASSET_DRAG_MIME = 'application/x-viu-asset-id';

export type ViuCanvasAsset = {
  id: string;
  protocolUrl?: string;
  displayName: string;
  kind: string;
  missing: boolean;
};

export type ViuAssetLibraryLabels = {
  title: string;
  description: string;
  linkAction: string;
  insertAction: string;
};

export type ViuAssetLibraryProps = {
  assets: ViuCanvasAsset[];
  labels: ViuAssetLibraryLabels;
  onLinkAsset?: () => void;
  onInsertAsset?: (asset: ViuCanvasAsset) => void;
};

const iconFor = (kind: string): React.ReactNode => {
  if (kind === 'video') return <VideoOne theme='outline' size={15} />;
  if (kind === 'model' || kind === 'model-3d') return <Cube theme='outline' size={15} />;
  return <Picture theme='outline' size={15} />;
};

export function readViuDraggedAssetId(dataTransfer: DataTransfer): string | null {
  const id = dataTransfer.getData(VIU_ASSET_DRAG_MIME).trim();
  return id || null;
}

const ViuAssetLibrary: React.FC<ViuAssetLibraryProps> = ({ assets, labels, onLinkAsset, onInsertAsset }) => (
  <div className='h-full min-h-0 flex flex-col p-14px'>
    <div className='flex items-start gap-10px'>
      <span className='size-36px shrink-0 rd-12px bg-fill-2 text-primary flex-center'>
        <Picture theme='outline' size={18} />
      </span>
      <div className='min-w-0 flex-1'>
        <div className='text-12px font-700 text-t-primary'>{labels.title}</div>
        <div className='mt-3px text-11px leading-relaxed text-t-tertiary'>{labels.description}</div>
      </div>
    </div>
    <Button
      className='mt-12px'
      size='small'
      disabled={!onLinkAsset}
      icon={<FolderOpen theme='outline' size={13} />}
      onClick={onLinkAsset}
    >
      {labels.linkAction}
    </Button>
    <div className='mt-12px min-h-0 flex-1 overflow-y-auto'>
      {assets.length === 0 ? (
        <Empty description={labels.description} />
      ) : (
        <div className='flex flex-col gap-6px' data-testid='viu-local-assets'>
          {assets.map((asset) => (
            <Tooltip key={asset.id} content={asset.missing ? labels.description : labels.insertAction} position='right'>
              <Button
                type='text'
                long
                disabled={asset.missing}
                draggable={!asset.missing}
                className='!h-auto !justify-start !rd-9px !border !border-b-1 !bg-bg-1 !px-9px !py-8px'
                data-testid={`viu-local-asset-${asset.id}`}
                data-missing={asset.missing}
                onClick={() => onInsertAsset?.(asset)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy';
                  event.dataTransfer.setData(VIU_ASSET_DRAG_MIME, asset.id);
                }}
              >
                <span
                  className={`size-28px shrink-0 rd-8px bg-fill-2 flex-center ${
                    asset.missing ? 'text-danger' : 'text-primary'
                  }`}
                >
                  {iconFor(asset.kind)}
                </span>
                <span className='min-w-0 flex-1 text-left'>
                  <span className='block truncate text-11px font-600 text-t-primary'>{asset.displayName}</span>
                  <span className='block truncate text-10px text-t-tertiary'>{asset.kind}</span>
                </span>
                {asset.missing ? <span className='size-6px shrink-0 rd-full bg-danger' /> : null}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default ViuAssetLibrary;
