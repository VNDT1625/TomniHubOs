import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShadowView from '@/renderer/components/Markdown/ShadowView';

vi.mock('@/common/config/configService', () => ({
  configService: { get: () => undefined },
}));

afterEach(cleanup);

describe('Markdown Rich UI styling', () => {
  it('copies trusted global rich-ui rules into the message Shadow DOM', () => {
    const style = document.createElement('style');
    style.textContent = '.tomni-rich-ui { border-radius: 12px; }';
    document.head.appendChild(style);
    try {
      const { container } = render(
        <ShadowView>
          <section className='tomni-rich-ui'>Content</section>
        </ShadowView>
      );
      const shadow = container.querySelector('.markdown-shadow')?.shadowRoot;
      expect(shadow?.querySelector('.tomni-rich-ui')?.textContent).toBe('Content');
      expect(
        [...(shadow?.querySelectorAll('style') ?? [])].some((node) => node.textContent?.includes('.tomni-rich-ui'))
      ).toBe(true);
    } finally {
      style.remove();
    }
  });
});
