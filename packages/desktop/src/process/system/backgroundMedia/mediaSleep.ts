/**
 * On close-to-tray, pause all Electron-owned page media without terminating
 * background agents, MCP tools, timers, or the user's browser sessions.
 *
 * The controller restores the original audio mute policy on wake. It never
 * resumes HTMLMediaElement playback automatically.
 */
export type MediaFrame = {
  executeJavaScript: (script: string) => Promise<unknown>;
};

export type MediaContents = MediaFrame & {
  id: number;
  isDestroyed: () => boolean;
  isAudioMuted: () => boolean;
  setAudioMuted: (muted: boolean) => void;
  mainFrame?: { framesInSubtree: readonly MediaFrame[] };
};

export const PAUSE_MEDIA_SCRIPT = `(() => {
  const key = '__tomnyBackgroundMediaSleepV1';
  if (!window[key]) {
    const onPlay = (event) => {
      if (event.target instanceof HTMLMediaElement) event.target.pause();
    };
    document.addEventListener('play', onPlay, true);
    window[key] = { onPlay };
  }
  for (const media of document.querySelectorAll('audio, video')) media.pause();
})()`;

export const RESTORE_MEDIA_SCRIPT = `(() => {
  const key = '__tomnyBackgroundMediaSleepV1';
  const guard = window[key];
  if (guard) {
    document.removeEventListener('play', guard.onPlay, true);
    delete window[key];
  }
  // Visibility changes must not restart playback on behalf of the user.
  for (const media of document.querySelectorAll('audio, video')) media.pause();
})()`;

export type MediaSleepController = {
  sleep: () => Promise<void>;
  wake: () => Promise<void>;
    isSleeping: () => boolean;
  refreshContent: (contents: MediaContents) => Promise<void>;
};

export const createMediaSleepController = (listContents: () => MediaContents[]): MediaSleepController => {
  const previousMute = new Map<number, { contents: MediaContents; muted: boolean }>();
  let sleeping = false;
  let transition: Promise<void> = Promise.resolve();

  const evaluate = async (contents: MediaContents, script: string): Promise<void> => {
    if (contents.isDestroyed()) return;
    // Browser embeds can have cross-origin iframes; evaluate in their individual
    // frame contexts instead of trying to read them from the top document.
    const frames = contents.mainFrame?.framesInSubtree;
    const targets: readonly MediaFrame[] = frames?.length ? frames : [contents];
    await Promise.allSettled(targets.map((frame) => Promise.resolve().then(() => frame.executeJavaScript(script))));
  };

    const trackContent = (contents: MediaContents): boolean => {
    if (contents.isDestroyed()) return false;
    if (previousMute.has(contents.id)) return true;
    try {
      previousMute.set(contents.id, { contents, muted: contents.isAudioMuted() });
      contents.setAudioMuted(true);
      return true;
    } catch (error) {
      console.warn('[BackgroundMedia] Failed to mute page:', error);
      return false;
    }
  };

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = transition.then(operation, operation);
    transition = result.catch((error: unknown) => {
      console.warn('[BackgroundMedia] Transition failed:', error);
    });
    return result;
  };

  return {
        isSleeping: () => sleeping,
    refreshContent: (contents) => {
      if (!sleeping || !trackContent(contents)) return Promise.resolve();
      // A background agent may navigate or open new pages after the Hub closes.
      // Reinstall the play guard in the newly loaded document.
      return enqueue(async () => {
        if (sleeping) await evaluate(contents, PAUSE_MEDIA_SCRIPT);
      });
    },
    sleep: () => {
      if (sleeping) return transition;
      sleeping = true;
      const contents = listContents().filter((entry) => !entry.isDestroyed());
      // Mute synchronously, before Electron hides the window or throttles it.
            for (const entry of contents) trackContent(entry);
      return enqueue(async () => {
        await Promise.allSettled(contents.map((entry) => evaluate(entry, PAUSE_MEDIA_SCRIPT)));
      });
    },
    wake: () => {
      if (!sleeping) return transition;
      sleeping = false;
      return enqueue(async () => {
        const records = [...previousMute.values()];
        previousMute.clear();
        // Remove the autoplay guard but leave all media explicitly paused.
        await Promise.allSettled(records.map(async ({ contents }) => evaluate(contents, RESTORE_MEDIA_SCRIPT)));
        for (const { contents, muted } of records) {
          try {
            if (!contents.isDestroyed()) contents.setAudioMuted(muted);
          } catch (error) {
            console.warn('[BackgroundMedia] Failed to restore mute state:', error);
          }
        }
      });
    },
  };
};
