/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentQuickView } from '@/common/chat/attachmentQuickView';
import type { SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import AttachmentInventoryRail from '@/renderer/components/chat/AttachmentInventoryRail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; label?: string }) => {
      const translations: Record<string, string> = {
        'common.attachmentQuickView.showAttachments': 'Show attachments (' + values?.count + ')',
        'common.attachmentQuickView.hideAttachments': 'Hide attachments (' + values?.count + ')',
        'common.attachmentQuickView.remove': 'Remove ' + values?.label,
        'common.attachmentQuickView.label': 'Quick view for ' + values?.label,
        'common.attachmentQuickView.loading': 'Loading preview…',
        'common.attachmentQuickView.unsupported': 'This file type cannot be previewed here.',
        'common.attachmentQuickView.directory': 'Folders cannot be previewed here.',
        'common.attachmentQuickView.too-large': 'This file is too large for a quick view.',
        'common.attachmentQuickView.unavailable': 'This file is no longer available.',
      };
      return translations[key] ?? key;
    },
  }),
}));

const reference: SemanticAttachmentReference = {
  id: 'image-1',
  attachmentKey: '/tmp/before.png',
  label: 'before.png',
  referencePath: '/tmp/before.png',
  source: 'file',
};
const secondReference: SemanticAttachmentReference = {
  id: 'image-2',
  attachmentKey: '/tmp/after.png',
  label: 'after.png',
  referencePath: '/tmp/after.png',
  source: 'file',
};

const reveal = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Show attachments (1)' }));
};

describe('AttachmentInventoryRail', () => {
  it('can transition from no references to a referenced Explorer file without changing its hook order', () => {
    const { rerender } = render(<AttachmentInventoryRail references={[]} onRemoveReference={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Show attachments (1)' })).toBeNull();
    rerender(<AttachmentInventoryRail references={[reference]} onRemoveReference={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Show attachments (1)' })).toBeDefined();
  });

  it('keeps the inventory collapsed until the attachment toggle is selected', () => {
    render(<AttachmentInventoryRail references={[reference]} onRemoveReference={vi.fn()} />);

    expect(screen.queryByTestId('attachment-inventory-rail')).toBeNull();
    reveal();
    expect(screen.getByTestId('attachment-inventory-rail')).toBeDefined();
    expect(screen.getByText((_, element) => element?.textContent === '▣ before.png')).toBeDefined();
  });

  it('requests an owned quick-view capability on hover and shows its bounded text', async () => {
    const loadQuickView = vi.fn<() => Promise<AttachmentQuickView>>().mockResolvedValue({
      kind: 'text',
      content: 'safe excerpt',
      truncated: false,
    });
    render(
      <AttachmentInventoryRail
        references={[reference]}
        onRemoveReference={vi.fn()}
        quickViews={{ '/tmp/before.png': loadQuickView }}
      />
    );

    reveal();
    fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ before.png'));

    expect(await screen.findByText('safe excerpt')).toBeDefined();
    expect(loadQuickView).toHaveBeenCalledTimes(1);
  });

  it('renders the quick view outside the clipped inventory container', async () => {
    render(
      <AttachmentInventoryRail
        references={[reference]}
        onRemoveReference={vi.fn()}
        quickViews={{ '/tmp/before.png': async () => ({ kind: 'text', content: 'portal excerpt', truncated: false }) }}
      />
    );

    reveal();
    fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ before.png'));
    const preview = await screen.findByText('portal excerpt');

    expect(preview.closest('.attachment-inventory')).toBeNull();
  });


  it('keeps the quick view open while the pointer moves from the item into it', async () => {
    render(
      <AttachmentInventoryRail
        references={[reference]}
        onRemoveReference={vi.fn()}
        quickViews={{
          '/tmp/before.png': async () => ({ kind: 'text', content: 'scrollable excerpt', truncated: false }),
        }}
      />
    );

    reveal();
    const item = screen.getByText((_, element) => element?.textContent === '▣ before.png').parentElement!;
    fireEvent.mouseEnter(item);
    const preview = await screen.findByRole('status', { name: 'Quick view for before.png' });
    fireEvent.mouseLeave(item);
    fireEvent.mouseEnter(preview);

    expect(screen.getByText('scrollable excerpt')).toBeDefined();
  });

  it('ignores a stale quick-view response after the pointer reaches another attachment', async () => {
    let resolveFirst!: (result: AttachmentQuickView) => void;
    const first = new Promise<AttachmentQuickView>((resolve) => {
      resolveFirst = resolve;
    });
    render(
      <AttachmentInventoryRail
        references={[reference, secondReference]}
        onRemoveReference={vi.fn()}
        quickViews={{
          '/tmp/before.png': () => first,
          '/tmp/after.png': async () => ({ kind: 'text', content: 'current excerpt', truncated: false }),
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show attachments (2)' }));
    fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ before.png'));
    fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ after.png'));
    expect(await screen.findByText('current excerpt')).toBeDefined();

    resolveFirst({ kind: 'text', content: 'stale excerpt', truncated: false });
    await Promise.resolve();

    expect(screen.queryByText('stale excerpt')).toBeNull();
    expect(screen.getByText('current excerpt')).toBeDefined();
  });

    it('closes a preview when the attached reference disappears, including pending loads', async () => {
    let finish!: (result: AttachmentQuickView) => void;
    const pending = new Promise<AttachmentQuickView>((resolve) => { finish = resolve; });
    const view = render(
      <AttachmentInventoryRail references={[reference]} onRemoveReference={vi.fn()}
        quickViews={{ '/tmp/before.png': () => pending }} />
    );
    reveal();
    fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ before.png'));
    expect(screen.getByRole('status', { name: 'Quick view for before.png' })).toBeDefined();
    view.rerender(<AttachmentInventoryRail references={[]} onRemoveReference={vi.fn()} />);
    expect(screen.queryByRole('status', { name: 'Quick view for before.png' })).toBeNull();
    finish({ kind: 'text', content: 'stale preview', truncated: false });
    await Promise.resolve();
    expect(screen.queryByText('stale preview')).toBeNull();
  });

  it('dismisses its preview when a composer token preview takes over', async () => {
    render(<AttachmentInventoryRail references={[reference]} onRemoveReference={vi.fn()}
      quickViews={{ '/tmp/before.png': async () => ({ kind: 'text', content: 'rail preview', truncated: false }) }} />);
    reveal();
    fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ before.png'));
    expect(await screen.findByText('rail preview')).toBeDefined();
    fireEvent(window, new CustomEvent('tomni:attachment-preview-open', { detail: 'composer' }));
    expect(screen.queryByText('rail preview')).toBeNull();
  });

  it('anchors the inventory preview above the composer rather than using a fixed screen corner', async () => {
    const anchor = document.createElement('div');
    anchor.className = 'guid-input-card-shell';
    const parent = document.createElement('div');
    parent.className = 'hub-composer';
    parent.append(anchor);
    document.body.append(parent);
    Object.defineProperty(anchor, 'getBoundingClientRect', { value: () => ({ left: 110, top: 450, width: 600 }) });
    try {
      render(<AttachmentInventoryRail references={[reference]} onRemoveReference={vi.fn()}
        quickViews={{ '/tmp/before.png': async () => ({ kind: 'text', content: 'anchored preview', truncated: false }) }} />);
      reveal();
      fireEvent.mouseEnter(screen.getByText((_, element) => element?.textContent === '▣ before.png'));
      const preview = await screen.findByRole('status', { name: 'Quick view for before.png' });
      expect(preview.style.left).toBe('122px');
      expect(preview.style.bottom).toBe(`${window.innerHeight - 450 + 8}px`);
    } finally {
      parent.remove();
    }
  });

  it('removes only the selected attachment from the inventory', () => {
    const onRemoveReference = vi.fn();
    render(<AttachmentInventoryRail references={[reference]} onRemoveReference={onRemoveReference} />);

    reveal();
    fireEvent.click(screen.getByRole('button', { name: 'Remove before.png' }));

    expect(onRemoveReference).toHaveBeenCalledWith(reference);
  });
});
