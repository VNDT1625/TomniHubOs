/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./MermaidBlock', () => ({ default: () => null }));

import CodeBlock from '@/renderer/components/Markdown/CodeBlock';

type PreviewDetail = { content: string; contentType: string; metadata: Record<string, unknown> };

const opened = (): PreviewDetail[] => {
  const details: PreviewDetail[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<PreviewDetail>).detail);
  window.addEventListener('preview.open', listener);
  return details;
};

afterEach(cleanup);

const lines = (...rows: string[]) => rows.join(String.fromCharCode(10));

describe('code block preview button', () => {
  const details = opened();

  it('opens an HTML block rendered, named after the file in its fence', () => {
    const html = ['<!doctype html>', '<h1>Hi</h1>', '<p>x</p>', '<p>y</p>'].join(String.fromCharCode(10));
    render(<CodeBlock className='language-html:index.html'>{html}</CodeBlock>);
    expect(screen.getByText('index.html')).toBeTruthy();
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)).toMatchObject({
      content: html,
      contentType: 'html',
      metadata: {
        language: 'html',
        title: 'index.html',
        file_name: 'index.html',
        pending: false,
        previewId: expect.any(String),
      },
    });
  });

  it('updates the opened HTML preview when the streaming code finishes without opening another tab', async () => {
    const html = '<!doctype html><title>Loading</title>';
    const updates: Array<{ previewId: string; content: string; pending: boolean }> = [];
    const listener = (event: Event) =>
      updates.push((event as CustomEvent<{ previewId: string; content: string; pending: boolean }>).detail);
    window.addEventListener('preview.update', listener);
    const rendered = render(
      <CodeBlock className='language-html' streaming>
        {html}
      </CodeBlock>
    );
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    const openedId = details.at(-1)?.metadata.previewId;
    expect(details.at(-1)?.metadata.pending).toBe(true);
    rendered.rerender(
      <CodeBlock className='language-html'>{'<!doctype html><title>Finished</title><body>Complete</body>'}</CodeBlock>
    );
    await waitFor(() =>
      expect(
        updates.some(
          (update) => update.previewId === openedId && update.pending === false && update.content.includes('Complete')
        )
      ).toBe(true)
    );
    window.removeEventListener('preview.update', listener);
  });

  it('attaches a stable Home Agent identity to the open Preview event', () => {
    render(
      <CodeBlock className='language-html' streaming previewSourceId='agent:session-12' previewBlockIndex={1}>
        {'<h1>Partial</h1>'}
      </CodeBlock>
    );
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)).toMatchObject({
      contentType: 'html',
      metadata: { sourceId: 'agent:session-12', blockIndex: 1, pending: true },
    });
  });

  it('opens SVG and Markdown rendered, and other languages as code', () => {
    render(<CodeBlock className='language-svg'>{lines('<svg>', '<circle r="4"/>', '</svg>')}</CodeBlock>);
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)?.contentType).toBe('html');
    cleanup();

    render(<CodeBlock className='language-md'>{lines('# Title', '', 'Body')}</CodeBlock>);
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)?.contentType).toBe('markdown');
    cleanup();

    render(<CodeBlock className='language-python'>{lines('def f():', '    return 1')}</CodeBlock>);
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)).toMatchObject({ contentType: 'code', metadata: { language: 'python', title: 'python' } });
  });

  it('opens a diff in the side-by-side diff viewer', () => {
    const patch = ['@@ -1,2 +1,2 @@', '-old', '+new', ' same'].join(String.fromCharCode(10));
    render(<CodeBlock className='language-diff'>{patch}</CodeBlock>);
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    const nl = String.fromCharCode(10);
    expect(details.at(-1)).toMatchObject({
      content: ['--- a/snippet', '+++ b/snippet', patch].join(nl),
      contentType: 'diff',
    });
    cleanup();

    const bare = ['-old', '+new', ' same'].join(nl);
    render(<CodeBlock className='language-diff:app.ts'>{bare}</CodeBlock>);
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)?.content).toBe(['--- a/app.ts', '+++ b/app.ts', '@@ -1,2 +1,2 @@', bare].join(nl));
    cleanup();

    const full = ['--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b'].join(nl);
    render(<CodeBlock className='language-patch'>{full}</CodeBlock>);
    fireEvent.click(screen.getByTestId('code-block-open-in-panel'));
    expect(details.at(-1)?.content).toBe(full);
  });

  it('renders a schema-validated visual block from a Markdown language fence', () => {
    render(
      <CodeBlock className='language-tomni-ui'>
        {JSON.stringify({
          version: 1,
          title: 'MCP workflow',
          fallbackText: 'Agent > gateway',
          blocks: [{ type: 'flow', steps: [{ title: 'Agent' }, { title: 'Gateway' }] }],
        })}
      </CodeBlock>
    );
    expect(screen.getByTestId('rich-ui-block')).toBeInTheDocument();
    expect(screen.getByText('MCP workflow')).toBeInTheDocument();
    cleanup();
  });

  it('shows no button on inline code', () => {
    render(<CodeBlock className='language-js'>{'x'}</CodeBlock>);
    expect(screen.queryByTestId('code-block-open-in-panel')).toBeNull();
  });
});
