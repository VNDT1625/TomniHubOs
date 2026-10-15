/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useRef, useState } from 'react';
import { openExternalUrl } from '@/renderer/utils/platform';
import type { RichUiImage } from './richUiSpec';

type ImageResult = { image: RichUiImage; width: number; height: number };
const MAX_CONCURRENT = 4;

/**
 * Validate candidate images by actual decode before rendering cards. The AI
 * provides candidate URLs; failed candidates are never shown as broken cards.
 */
export const ImageGallery: React.FC<{ images: readonly RichUiImage[]; targetCount?: number }> = ({
  images,
  targetCount,
}) => {
  const target = Math.min(targetCount ?? images.length, 16);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [complete, setComplete] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let cursor = 0;
    let active = 0;
    let accepted = 0;
    const success = new Map<number, ImageResult>();
    setResults([]);
    setComplete(false);
    const publish = () => {
      if (cancelled) return;
      setResults(
        [...success.entries()]
          .toSorted(([a], [b]) => a - b)
          .slice(0, target)
          .map(([, result]) => result)
      );
    };
    const next = () => {
      if (cancelled || accepted >= target) return;
      while (active < MAX_CONCURRENT && cursor < images.length) {
        const index = cursor++;
        const image = images[index];
        const probe = new Image();
        active++;
        probe.referrerPolicy = 'no-referrer';
        let settled = false;
        const expiry = window.setTimeout(() => finish(false), 12000);
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(expiry);
          probe.removeEventListener('load', onLoad);
          probe.removeEventListener('error', onError);
          active--;
          if (cancelled) return;
          if (ok && accepted < target) {
            accepted++;
            success.set(index, { image, width: probe.naturalWidth, height: probe.naturalHeight });
            publish();
          }
          if ((cursor >= images.length && active === 0) || (accepted >= target && active === 0)) {
            setComplete(true);
          } else {
            next();
          }
        };
        const onLoad = () => finish(probe.naturalWidth > 0 && probe.naturalHeight > 0);
        const onError = () => finish(false);
        probe.addEventListener('load', onLoad);
        probe.addEventListener('error', onError);
        probe.src = image.src;
      }
      if (active === 0 && (cursor >= images.length || accepted >= target)) setComplete(true);
    };
    next();
    return () => {
      cancelled = true;
    };
  }, [images, target]);

  const scroll = (direction: number) => {
    const element = listRef.current;
    if (!element) return;
    const delta = direction * Math.max(260, element.clientWidth * 0.8);
    if (typeof element.scrollBy === 'function') element.scrollBy({ left: delta, behavior: 'smooth' });
    else element.scrollLeft += delta;
  };

  return (
    <section className='tomni-rich-ui-gallery' data-testid='rich-ui-gallery' aria-label='Thư viện ảnh minh họa'>
      <div className='tomni-rich-ui-gallery-tools'>
        <span role='status'>
          {complete
            ? results.length < target
              ? `Chỉ tải được ${results.length}/${target} ảnh minh họa`
              : `${results.length} ảnh minh họa`
            : `Đang kiểm tra ảnh minh họa… ${results.length}/${target}`}
        </span>
        <div>
          <button type='button' aria-label='Ảnh trước' disabled={results.length < 2} onClick={() => scroll(-1)}>
            ‹
          </button>
          <button type='button' aria-label='Ảnh tiếp theo' disabled={results.length < 2} onClick={() => scroll(1)}>
            ›
          </button>
        </div>
      </div>
      {complete && results.length === 0 && (
        <p className='tomni-rich-ui-gallery-empty'>Không có ảnh khả dụng từ các nguồn đã cung cấp.</p>
      )}
      <div
        className='tomni-rich-ui-gallery-track'
        ref={listRef}
        tabIndex={0}
        role='region'
        aria-label='Cuộn ngang để xem ảnh'
      >
        {results.map(({ image, width, height }) => {
          const source = image.source ?? image.src;
          const wide = width > height * 1.3;
          return (
            <figure
              key={image.src}
              className={`tomni-rich-ui-gallery-item ${wide ? 'tomni-rich-ui-gallery-item--wide' : ''}`}
            >
              <div className='tomni-rich-ui-gallery-image'>
                <img src={image.src} alt={image.alt} loading='lazy' decoding='async' referrerPolicy='no-referrer' />
              </div>
              <figcaption>
                <span>{image.caption ?? image.alt}</span>
                <button
                  type='button'
                  title={source}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openExternalUrl(source).catch(() => {});
                  }}
                >
                  {image.sourceLabel ?? new URL(source).hostname} ↗
                </button>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
};

export default ImageGallery;
