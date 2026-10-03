/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageAttachmentPreview from '../../../packages/desktop/src/renderer/components/chat/ImageAttachmentPreview';

describe('ImageAttachmentPreview', () => {
  it('renders thumbnail image correctly', () => {
    render(<ImageAttachmentPreview src='test.png' name='Screenshot' />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('test.png');
    expect(img.getAttribute('alt')).toBe('Screenshot');
  });

  it('shows magnifier preview card on hover', () => {
    render(<ImageAttachmentPreview src='test.png' />);

    const container = screen.getByTestId('image-attachment-preview');
    fireEvent.mouseEnter(container);

    expect(screen.getByTestId('magnifier-preview')).toBeDefined();

    fireEvent.mouseLeave(container);
    expect(screen.queryByTestId('magnifier-preview')).toBeNull();
  });

  it('calls onRemove when clicking delete button', () => {
    const onRemove = vi.fn();
    render(<ImageAttachmentPreview src='test.png' onRemove={onRemove} readonly={false} />);

    const removeBtn = screen.getByTestId('remove-image-btn');
    fireEvent.click(removeBtn);

    expect(onRemove).toHaveBeenCalled();
  });
});
