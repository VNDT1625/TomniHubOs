/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { openExternalUrl } from '@/renderer/utils/platform';
import { isSafePublicImageUrl } from './richUi/gallerySource';

/** Inline Markdown image with attributed host; richer source-page attribution uses gallery. */
const RemoteImageView: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);
  if (!isSafePublicImageUrl(src)) {
    return <span role='status'>Ảnh có nguồn không hỗ trợ: {alt}</span>;
  }
  const host = new URL(src).hostname;
  return (
    <figure className='tomni-rich-ui-remote-image' data-testid='markdown-linked-image'>
      {failed ? (
        <span role='status'>Không tải được ảnh: {alt}</span>
      ) : (
        <img
          src={src}
          alt={alt}
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          onError={() => setFailed(true)}
        />
      )}
      <figcaption>
        <button
          type='button'
          title={src}
          onClick={(event) => {
            event.stopPropagation();
            void openExternalUrl(src).catch((error: unknown) => console.error('Failed to open image source:', error));
          }}
        >
          {host} ↗
        </button>
      </figcaption>
    </figure>
  );
};

export default RemoteImageView;
