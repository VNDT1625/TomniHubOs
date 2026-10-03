/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CodeDiffViewer from '../../../packages/desktop/src/renderer/components/chat/CodeDiffViewer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue || k }),
}));

describe('CodeDiffViewer', () => {
  const sampleDiff = `@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;`;

  it('renders unified diff view with added and deleted lines', () => {
    render(<CodeDiffViewer diff={sampleDiff} fileName='src/index.ts' />);

    expect(screen.getByText('src/index.ts')).toBeDefined();
    expect(screen.getByText('const b = 2;')).toBeDefined();
    expect(screen.getByText('const b = 3;')).toBeDefined();
  });

  it('toggles to split view mode', () => {
    render(<CodeDiffViewer diff={sampleDiff} />);

    const splitRadio = screen.getByLabelText('Split');
    fireEvent.click(splitRadio);

    expect(screen.getByText('const b = 2;')).toBeDefined();
    expect(screen.getByText('const b = 3;')).toBeDefined();
  });

  it('calls onApplyPatch and marks applied on 1-click', async () => {
    const onApplyPatch = vi.fn().mockResolvedValue(undefined);
    render(<CodeDiffViewer diff={sampleDiff} onApplyPatch={onApplyPatch} />);

    const applyBtn = screen.getByTestId('apply-patch-btn');
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(onApplyPatch).toHaveBeenCalledWith(sampleDiff);
      expect(screen.getByText('✓ Đã áp dụng')).toBeDefined();
    });
  });
});
