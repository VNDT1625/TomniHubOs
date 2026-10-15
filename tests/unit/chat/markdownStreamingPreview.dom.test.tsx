import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import MarkdownView from '@/renderer/components/Markdown';

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

const markdown = (html: string) => 'A landing page:\n\n```html\n' + html + '\n```';

describe('Markdown HTML streaming stability', () => {
  it('preserves the same inline preview component and iframe when Markdown tokens change', async () => {
    const { rerender } = render(
      <MarkdownView streaming previewSourceId='agent:live-1'>
        {markdown('<h1>Step 1</h1>')}
      </MarkdownView>
    );
    const originalBlock = screen.getByTestId('html-live-block');
    const originalFrame = screen.getByTestId('html-live-frame');

    rerender(
      <MarkdownView streaming previewSourceId='agent:live-1'>
        {markdown('<h1>Step 1</h1><p>Still writing…</p>')}
      </MarkdownView>
    );
    expect(screen.getByTestId('html-live-block')).toBe(originalBlock);
    expect(originalFrame.isConnected).toBe(true);
    await waitFor(
      () => expect(screen.getByTestId('html-live-frame').getAttribute('srcdoc')).toContain('Still writing'),
      { timeout: 3000 }
    );

    rerender(
      <MarkdownView streaming={false} previewSourceId='agent:live-1'>
        {markdown('<h1>Step 1</h1><p>Done</p>')}
      </MarkdownView>
    );
    expect(screen.getByTestId('html-live-block')).toBe(originalBlock);
    await waitFor(() => expect(screen.getByTestId('html-live-frame').getAttribute('srcdoc')).toContain('Done'), {
      timeout: 3000,
    });
  });
});
