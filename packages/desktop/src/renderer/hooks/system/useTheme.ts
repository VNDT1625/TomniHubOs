// hooks/useTheme.ts
import { configService } from '@/common/config/configService';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Theme = 'light' | 'dark';

const DEFAULT_THEME: Theme = 'light';
const THEME_CACHE_KEY = '__tomny_theme';

const applyThemeToDom = (value: Theme) => {
  document.documentElement.setAttribute('data-theme', value);
  document.body.setAttribute('arco-theme', value);
};

const readCachedTheme = (): Theme => {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === 'light' || cached === 'dark') return cached;
  } catch {
    /* noop */
  }
  return DEFAULT_THEME;
};

// Apply localStorage hint synchronously to avoid FOUC, then resolve to the
// authoritative value from configService once it has loaded from the backend.
const initTheme = async (): Promise<Theme> => {
  const hint = readCachedTheme();
  applyThemeToDom(hint);
  try {
    await configService.whenReady();
    const theme = (configService.get('theme') as Theme) || hint;
    applyThemeToDom(theme);
    try {
      localStorage.setItem(THEME_CACHE_KEY, theme);
    } catch {
      /* noop */
    }
    return theme;
  } catch (error) {
    console.error('Failed to load initial theme:', error);
    return hint;
  }
};

// Run theme initialization immediately
let initialThemePromise: Promise<Theme> | null = null;
if (typeof window !== 'undefined') {
  initialThemePromise = initTheme();
}

const useTheme = (): [Theme, (theme: Theme) => Promise<void>] => {
  const [theme, setThemeState] = useState<Theme>(readCachedTheme);
  const userChangedThemeRef = useRef(false);

  // Apply theme to document
  const applyTheme = useCallback((newTheme: Theme) => {
    applyThemeToDom(newTheme);
    try {
      localStorage.setItem(THEME_CACHE_KEY, newTheme);
    } catch {
      /* noop */
    }
  }, []);

  // Set theme with persistence
  const setTheme = useCallback(
    async (newTheme: Theme) => {
      userChangedThemeRef.current = true;
      setThemeState(newTheme);
      applyTheme(newTheme);
      try {
        await configService.set('theme', newTheme);
      } catch (error) {
        console.error('Failed to save theme:', error);
      }
    },
    [applyTheme]
  );

  // Initialize theme state from the early initialization
  useEffect(() => {
    if (initialThemePromise) {
      initialThemePromise
        .then((initialTheme) => {
          if (userChangedThemeRef.current) return;
          setThemeState(initialTheme);
          applyTheme(initialTheme);
        })
        .catch((error) => {
          console.error('Failed to initialize theme:', error);
        });
    }
  }, [applyTheme]);

  return [theme, setTheme];
};

export default useTheme;
