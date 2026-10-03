/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Image, Tooltip } from '@arco-design/web-react';
import { CloseSmall, ZoomIn } from '@icon-park/react';
import classNames from 'classnames';

export interface ImageAttachmentPreviewProps {
  src: string;
  name?: string;
  onRemove?: () => void;
  readonly?: boolean;
  size?: number;
}

export const ImageAttachmentPreview: React.FC<ImageAttachmentPreviewProps> = ({
  src,
  name,
  onRemove,
  readonly = false,
  size = 80,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className='relative inline-flex items-center justify-center rd-8px overflow-hidden b-1 b-solid border-border-2 group transition-all'
      style={{
        width: size,
        height: size,
        background: 'var(--bg-2)',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-testid='image-attachment-preview'
    >
      <Image
        src={src}
        alt={name || 'Attachment'}
        width={size}
        height={size}
        style={{ objectFit: 'cover' }}
        preview={true}
      />

      {/* Magnifier Hover Preview Card */}
      {isHovered && (
        <div
          className='absolute z-100 pointer-events-none p-4px rd-8px bg-bg-popup b-1 b-solid border-border-2 shadow-xl'
          style={{
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 200,
            height: 200,
          }}
          data-testid='magnifier-preview'
        >
          <img
            src={src}
            alt={name || 'Preview'}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              borderRadius: 6,
            }}
          />
        </div>
      )}

      {/* Remove Button in editable mode */}
      {!readonly && onRemove && (
        <div
          className='absolute top-2px right-2px w-18px h-18px rd-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white cursor-pointer transition-colors z-10 opacity-0 group-hover:opacity-100'
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          data-testid='remove-image-btn'
          title='Xóa ảnh'
        >
          <CloseSmall theme='outline' size='12' />
        </div>
      )}
    </div>
  );
};

export default ImageAttachmentPreview;
