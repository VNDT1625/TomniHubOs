import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RemoteImageView from '@/renderer/components/Markdown/RemoteImageView';

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl }));
afterEach(() => {
  cleanup();
  openExternalUrl.mockClear();
});

describe('plain Markdown images with source attribution', () => {
  it('renders a remote image with an interactive source-domain badge', () => {
    render(<RemoteImageView src='https://images.example.com/qr.png' alt='QR explanation' />);
    expect(screen.getByTestId('markdown-linked-image')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.click(screen.getByRole('button', { name: 'images.example.com ↗' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://images.example.com/qr.png');
  });
  it('does not load private or unsupported remote image URLs', () => {
    render(<RemoteImageView src='http://127.0.0.1/x' alt='Unsafe image' />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('nguồn không hỗ trợ');
  });
});
