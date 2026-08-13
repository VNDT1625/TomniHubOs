/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TomnyModal from '@/renderer/components/base/TomnyModal';

vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ fontScale: 1 }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

afterEach(cleanup);

describe('TomnyModal surface contract', () => {
  it('applies requested body spacing while replacing the legacy opaque background', () => {
    render(
      <TomnyModal
        visible
        header={{ title: 'Modal title', showClose: true }}
        contentStyle={{ background: 'var(--dialog-fill-0)', padding: '12px 16px' }}
      >
        <span>Modal content</span>
      </TomnyModal>
    );

    const body = screen.getByText('Modal content').closest('.tomny-modal-body-content');

    expect(body).not.toBeNull();
    expect(body).toHaveStyle({ background: 'transparent', padding: '12px 16px' });
  });

  it('preserves an intentional custom background and keeps the close action working', () => {
    const onCancel = vi.fn();

    render(
      <TomnyModal
        visible
        onCancel={onCancel}
        header={{ title: 'Modal title', showClose: true }}
        contentStyle={{ background: 'var(--surface-glass)', padding: 10 }}
      >
        <span>Custom content</span>
      </TomnyModal>
    );

    const body = screen.getByText('Custom content').closest('.tomny-modal-body-content');
    const closeButton = screen.getByRole('button', { name: 'Close' });

    expect(body).toHaveStyle({ background: 'var(--surface-glass)', padding: '10px' });
    fireEvent.click(closeButton);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
