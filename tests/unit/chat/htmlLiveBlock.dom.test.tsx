import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HtmlLiveBlock from '@/renderer/components/Markdown/htmlPreview/HtmlLiveBlock';

afterEach(cleanup);

describe('live HTML fenced block', () => {
  it('shows a partial HTML document during streaming, then refreshes without losing preview mode', async () => {
    const rendered = render(<HtmlLiveBlock source='<h1>Landing' streaming />);
    expect(screen.getByTestId('html-live-frame').getAttribute('srcdoc')).toContain('<h1>Landing');
    expect(screen.getByText(/Đang viết code/)).toBeInTheDocument();
    const firstVisible = screen.getByTestId('html-live-frame');
    rendered.rerender(<HtmlLiveBlock source='<h1>Landing</h1><button>New</button>' streaming />);
    await waitFor(
      () => expect(screen.getByTestId('html-live-frame').getAttribute('srcdoc')).toContain('<button>New</button>'),
      { timeout: 2500 }
    );
    // The old sandbox was never navigated to an empty document: it is
    // removed only after the newly staged sandbox becomes visible.
    expect(firstVisible.getAttribute('srcdoc')).toContain('<h1>Landing');
    expect(screen.getAllByTitle('HTML interactive preview').length).toBeLessThanOrEqual(2);
    rendered.rerender(<HtmlLiveBlock source='<h1>Landing</h1><button>Final</button>' streaming={false} />);
    await waitFor(() =>
      expect(screen.getByTestId('html-live-frame').getAttribute('srcdoc')).toContain('<button>Final</button>')
    );
    expect(screen.queryByText(/Đang viết code/)).toBeNull();
  });

  it('shows live sandboxed preview by default and can switch to source', () => {
    const onOpen = vi.fn();
    render(
      <HtmlLiveBlock
        fileName='lesson.html'
        source='<button id="next">Next</button><script>document.querySelector("#next").onclick=()=>{};</script>'
        onOpen={onOpen}
      />
    );
    const iframe = screen.getByTestId('html-live-frame');
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    expect(iframe).not.toHaveAttribute('sandbox', expect.stringContaining('allow-same-origin'));
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(iframe.getAttribute('srcdoc')).toContain('Content-Security-Policy');
    expect(screen.getByText('lesson.html')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mã nguồn' }));
    expect(screen.queryByTestId('html-live-frame')).toBeNull();
    expect(screen.getByText(/document.querySelector/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Giao diện' }));
    fireEvent.click(screen.getByText('Mở trong Preview'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
