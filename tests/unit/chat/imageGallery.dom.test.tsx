import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageGallery from '@/renderer/components/Markdown/richUi/ImageGallery';
import { parseRichUiSpec } from '@/renderer/components/Markdown/richUi/richUiSpec';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl }));

const images = Array.from({ length: 8 }, (_, index) => ({
  src: `https://cdn.example.org/examples/diagram-${index}.png`,
  alt: `Sơ đồ ${index + 1}`,
  caption: `Giải thích ${index + 1}`,
  source: `https://example.org/lessons/${index}`,
  sourceLabel: 'Nguồn bài học',
}));
const payload = (imageSet: unknown[], targetCount?: number) =>
  JSON.stringify({
    version: 1,
    title: 'Ảnh mã QR',
    fallbackText: 'Các hình cấu tạo mã QR',
    blocks: [{ type: 'gallery', images: imageSet, ...(targetCount ? { targetCount } : {}) }],
  });

let originalImage: typeof Image;
const denied = new Set([0, 1, 4]);

beforeEach(() => {
  originalImage = globalThis.Image;
  // The fake browser never downloads from the network. Images 0/1/4 fail,
  // all others decode successfully, with alternating landscape/square ratios.
  class FakeImage {
    private listeners = new Map<string, (event: Event) => void>();
    addEventListener(type: string, listener: (event: Event) => void) {
      this.listeners.set(type, listener);
    }
    removeEventListener(type: string) {
      this.listeners.delete(type);
    }
    naturalWidth = 640;
    naturalHeight = 360;
    referrerPolicy = '';
    set src(url: string) {
      const id = Number(/diagram-(\d+)/.exec(url)?.[1] ?? -1);
      queueMicrotask(() => {
        if (denied.has(id)) this.listeners.get('error')?.(new Event('error'));
        else this.listeners.get('load')?.(new Event('load'));
      });
    }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
});
afterEach(() => {
  cleanup();
  globalThis.Image = originalImage;
  openExternalUrl.mockClear();
});

describe('sourced image gallery', () => {
  it('hides broken candidates and fills five visible slots with working fallback URLs', async () => {
    render(<ImageGallery images={images} targetCount={5} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(5));
    expect(screen.getByText('5 ảnh minh họa')).toBeInTheDocument();
    const rendered = screen.getAllByRole('img');
    expect(rendered[0]).toHaveAttribute('alt', 'Sơ đồ 3');
    expect(rendered[0]).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByText('Giải thích 1')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Nguồn bài học ↗' })[0]);
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.org/lessons/2');
    fireEvent.click(screen.getByRole('button', { name: 'Ảnh tiếp theo' }));
  });

  it('reports a shortfall or zero images, never showing failed-image cards', async () => {
    const { rerender } = render(<ImageGallery images={images.slice(0, 4)} targetCount={4} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Chỉ tải được 2/4'));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    rerender(<ImageGallery images={images.slice(0, 2)} targetCount={2} />);
    await waitFor(() =>
      expect(screen.getByText('Không có ảnh khả dụng từ các nguồn đã cung cấp.')).toBeInTheDocument()
    );
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('validates bounded candidate collections, desired count, and safe URLs', () => {
    expect(parseRichUiSpec(payload(images, 5)).ok).toBe(true);
    for (const source of [
      'file:///etc/passwd',
      'http://localhost/private',
      'https://127.0.0.1/a.png',
      'https://localhost/a.png',
      'https://example.org:444/a.png',
    ]) {
      expect(parseRichUiSpec(payload([{ ...images[0], src: source }])).ok).toBe(false);
    }
    expect(parseRichUiSpec(payload(images, 17)).ok).toBe(false);
    expect(parseRichUiSpec(payload(images, 9)).ok).toBe(false);
    expect(parseRichUiSpec(payload(Array.from({ length: 33 }, () => images[0]))).ok).toBe(false);
  });
});
