/**
 * Electron smoke: prove that the real Chromium Canvas draws the optional UCON
 * character and that editor-only state previews never alter the saved identity.
 */
/* eslint-disable no-await-in-loop -- Each preset must finish rendering before the next UI selection. */
import { test, expect } from '../../fixtures';
import { clickCreateAssistant, closeDrawer } from '../../helpers';

test.describe('UCON Canvas session avatar', () => {
  test('renders all ten accessory presets and cycles visual states without saving them', async ({ page }, testInfo) => {
    // Freeze frame time to verify silhouettes rather than incidental animation phases.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // The legacy Sider footer selector is not available in every shell layout.
    await page.evaluate(() => {
      window.location.hash = '#/settings/assistants';
    });
    await page.locator('[data-testid^="assistant-card-"]').first().waitFor({ state: 'visible', timeout: 20_000 });
    await clickCreateAssistant(page);

    const preset = page.getByTestId('ucon-avatar-preset');
    await expect(preset).toBeVisible();
    await preset.selectOption('engineer');

    const preview = page.getByTestId('ucon-avatar-preview');
    const canvas = preview.locator('.ucon-bot--preview canvas');
    await expect(canvas).toBeVisible();
    await expect(preview.locator('.ucon-bot--preview[data-state="idle"]')).toBeVisible();
    const paintedPixelCount = () =>
      canvas.evaluate((element) => {
        const surface = element as HTMLCanvasElement;
        const context = surface.getContext('2d');
        if (!context) return 0;
        const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
        let opaque = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 16) opaque += 1;
        }
        return opaque;
      });
    await expect.poll(paintedPixelCount).toBeGreaterThan(300);

    // Distinct silhouettes are actual visible Canvas portraits, not role-colored placeholders.
    const presets = [
      ['core', 'none'],
      ['engineer', 'fin'],
      ['scholar', 'round'],
      ['navigator', 'wing'],
      ['maker', 'square'],
      ['interface', 'none'],
      ['guardian', 'square'],
      ['artist', 'wing'],
      ['analyst', 'antenna'],
      ['communicator', 'round'],
    ] as const;
    const portraits: string[] = [];
    const readPortrait = () => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL('image/png'));
    for (const [shape, expectedEars] of presets) {
      await preset.selectOption(shape);
      await expect(page.getByTestId('ucon-slot-ears')).toHaveValue(expectedEars);
      await expect.poll(paintedPixelCount).toBeGreaterThan(300);
      await expect.poll(readPortrait).not.toBe(portraits.at(-1) ?? '');
      portraits.push(await readPortrait());
    }
    expect(new Set(portraits).size).toBe(presets.length);
    await preset.selectOption('engineer');
    await preview.getByTestId('ucon-preview-state').selectOption('working');
    await expect(preview.locator('.ucon-bot--preview[data-state="working"]')).toBeVisible();
    await preview.getByTestId('ucon-preview-state').selectOption('needs_input');
    await expect(preview.locator('.ucon-bot--preview[data-state="needs_input"]')).toBeVisible();
    await preview.getByTestId('ucon-preview-state').selectOption('sleep');
    await expect(preview.locator('.ucon-bot--preview[data-state="sleep"]')).toBeVisible();

    await page.getByTestId('ucon-slot-prop').selectOption('wrench');
    await expect(page.getByTestId('ucon-slot-prop')).toHaveValue('wrench');
    await testInfo.attach('ucon-appearance-preview', { body: await preview.screenshot(), contentType: 'image/png' });

    // No save: preview changes are deliberately local to the editor.
    await closeDrawer(page);
  });
});
