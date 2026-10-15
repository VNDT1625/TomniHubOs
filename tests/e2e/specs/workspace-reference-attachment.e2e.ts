import { test, expect } from '../fixtures';
import { goToGuid } from '../helpers';

test.describe.configure({ timeout: 90_000 });

test('typed Explorer reference MIME reaches the native fake runtime', async ({ page }) => {
  await goToGuid(page);

  await expect(page.locator('[data-testid="guid-input"]')).toBeVisible({ timeout: 30_000 });

  const reset = await page.evaluate(async () => {
    return window.electronAPI?.e2e?.resetNativeConversationCapture?.();
  });
  expect(reset).toBe(true);

  await page.locator('.guid-input-card-shell').evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'application/x-tomni-explorer-entries',
      JSON.stringify([
        { relativePath: 'src/a.ts', kind: 'file' },
        { relativePath: 'docs', kind: 'folder' },
      ])
    );
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });

  await expect(page.locator('[data-reference-kind="file"]')).toHaveCount(1);
  await expect(page.locator('[data-reference-kind="folder"]')).toHaveCount(1);

  await page.getByTestId('guid-input').fill('Inspect these workspace references.');
  await page.getByTestId('guid-input').press('Enter');

  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          window.electronAPI?.e2e?.getNativeConversationCapture?.().then((value) => value.requests.length)
        ),
      {
        timeout: 30_000,
        message: 'Waiting for the Main-owned native conversation capture',
      }
    )
    .toBe(1);

  const capture = await page.evaluate(() => window.electronAPI?.e2e?.getNativeConversationCapture?.());
  expect(capture?.requests).toHaveLength(1);
  expect(capture?.requests[0]).toEqual(
    expect.objectContaining({
      files: [],
      workspaceReferences: [
        { relativePath: 'src/a.ts', kind: 'file' },
        { relativePath: 'docs', kind: 'folder' },
      ],
      prompt: expect.stringContaining('[Untrusted workspace file: src/a.ts]'),
    })
  );

  expect(capture?.requests[0]?.prompt).toContain('export const answer = 42;');
  expect(capture?.requests[0]?.prompt).toContain('[Untrusted workspace folder: docs]');
  expect(capture?.requests[0]?.prompt).toContain('Canonical docs summary.');
});
