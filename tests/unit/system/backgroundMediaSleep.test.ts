import { describe, expect, it, vi } from 'vitest';
import {
  createMediaSleepController,
  PAUSE_MEDIA_SCRIPT,
  RESTORE_MEDIA_SCRIPT,
  type MediaContents,
} from '@process/system/backgroundMedia/mediaSleep';

const fakeContents = (id: number, initiallyMuted = false) => {
  let muted = initiallyMuted;
  const page: MediaContents = {
    id,
    isDestroyed: vi.fn(() => false),
    isAudioMuted: vi.fn(() => muted),
    setAudioMuted: vi.fn((value: boolean) => {
      muted = value;
    }),
    executeJavaScript: vi.fn(async () => undefined),
  };
  return page;
};

describe('close-to-tray media sleep', () => {
  it('mutes immediately, pauses HTML media, and never starts playback on wake', async () => {
    const contents = fakeContents(1);
    const controller = createMediaSleepController(() => [contents]);

    const sleeping = controller.sleep();
    expect(controller.isSleeping()).toBe(true);
    expect(contents.setAudioMuted).toHaveBeenCalledWith(true);
    await sleeping;
    expect(contents.executeJavaScript).toHaveBeenCalledWith(PAUSE_MEDIA_SCRIPT);
    expect(PAUSE_MEDIA_SCRIPT).toContain("document.addEventListener('play', onPlay, true)");
    expect(PAUSE_MEDIA_SCRIPT).toContain('media.pause()');

    await controller.wake();
    expect(controller.isSleeping()).toBe(false);
    expect(contents.executeJavaScript).toHaveBeenCalledWith(RESTORE_MEDIA_SCRIPT);
    expect(RESTORE_MEDIA_SCRIPT).toContain('media.pause()');
    expect(RESTORE_MEDIA_SCRIPT).not.toContain('.play()');
    expect(contents.setAudioMuted).toHaveBeenLastCalledWith(false);
  });

  it('preserves an existing mute choice and does not re-run sleep when already asleep', async () => {
    const contents = fakeContents(2, true);
    const controller = createMediaSleepController(() => [contents]);
    await Promise.all([controller.sleep(), controller.sleep()]);
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1);
    await controller.wake();
    expect(contents.setAudioMuted).toHaveBeenLastCalledWith(true);
  });

  it('pauses media inside child frames, including cross-origin frames', async () => {
    const contents = fakeContents(3);
    const frameA = { executeJavaScript: vi.fn(async () => undefined) };
    const frameB = { executeJavaScript: vi.fn(async () => undefined) };
    contents.mainFrame = { framesInSubtree: [frameA, frameB] };
    const controller = createMediaSleepController(() => [contents]);

    await controller.sleep();
    expect(frameA.executeJavaScript).toHaveBeenCalledWith(PAUSE_MEDIA_SCRIPT);
    expect(frameB.executeJavaScript).toHaveBeenCalledWith(PAUSE_MEDIA_SCRIPT);
    expect(contents.executeJavaScript).not.toHaveBeenCalled();

    await controller.wake();
    expect(frameA.executeJavaScript).toHaveBeenCalledWith(RESTORE_MEDIA_SCRIPT);
    expect(frameB.executeJavaScript).toHaveBeenCalledWith(RESTORE_MEDIA_SCRIPT);
  });

  it('continues to restore other tabs even if one page refuses script execution', async () => {
    const broken = fakeContents(4);
    broken.executeJavaScript = vi.fn(async () => {
      throw new Error('frame navigated');
    });
    const healthy = fakeContents(5);
    const controller = createMediaSleepController(() => [broken, healthy]);

    await expect(controller.sleep()).resolves.toBeUndefined();
    await expect(controller.wake()).resolves.toBeUndefined();
    expect(healthy.setAudioMuted).toHaveBeenLastCalledWith(false);
    expect(healthy.executeJavaScript).toHaveBeenCalledWith(RESTORE_MEDIA_SCRIPT);
  });

    it('guards newly created or navigated tabs while hidden', async () => {
    const original = fakeContents(11);
    const newTab = fakeContents(12);
    const controller = createMediaSleepController(() => [original]);
    await controller.sleep();
    await controller.refreshContent(newTab);
    expect(newTab.setAudioMuted).toHaveBeenCalledWith(true);
    expect(newTab.executeJavaScript).toHaveBeenCalledWith(PAUSE_MEDIA_SCRIPT);
    await controller.refreshContent(newTab);
    await controller.wake();
    expect(newTab.executeJavaScript).toHaveBeenCalledWith(RESTORE_MEDIA_SCRIPT);
    expect(newTab.setAudioMuted).toHaveBeenLastCalledWith(false);
  });

  it('does not attempt to unmute a page destroyed during sleep', async () => {
    const contents = fakeContents(6);
    const destroyed = vi.mocked(contents.isDestroyed);
        destroyed.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    const controller = createMediaSleepController(() => [contents]);
    await controller.sleep();
    await controller.wake();
    expect(contents.setAudioMuted).toHaveBeenCalledTimes(1);
  });

  it('maintains close then immediate reopen transition ordering', async () => {
    const contents = fakeContents(7);
    const controller = createMediaSleepController(() => [contents]);
    const close = controller.sleep();
    const reopen = controller.wake();
    await Promise.all([close, reopen]);
    expect(contents.executeJavaScript).toHaveBeenNthCalledWith(1, PAUSE_MEDIA_SCRIPT);
    expect(contents.executeJavaScript).toHaveBeenNthCalledWith(2, RESTORE_MEDIA_SCRIPT);
    expect(contents.setAudioMuted).toHaveBeenLastCalledWith(false);
  });
});
