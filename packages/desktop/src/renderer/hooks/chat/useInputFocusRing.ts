import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';

export const useInputFocusRing = () => {
  const { theme } = useThemeContext();
  const isDarkTheme = theme === 'dark';

  return {
    activeBorderColor: 'var(--primary)',
    inactiveBorderColor: 'var(--border-base)',
    idleShadow: isDarkTheme
      ? '0 16px 40px -6px rgba(0, 0, 0, 0.65), 0 4px 16px -2px rgba(0, 0, 0, 0.45), inset 0 1px 0 0 rgba(255, 255, 255, 0.12)'
      : '0 12px 32px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)',
    activeShadow: isDarkTheme
      ? '0 0 0 2px var(--primary), 0 20px 52px -6px rgba(59, 130, 246, 0.4), 0 6px 20px rgba(0, 0, 0, 0.7)'
      : '0 0 0 2px var(--primary), 0 20px 48px -6px rgba(37, 99, 235, 0.25), 0 6px 16px rgba(15, 23, 42, 0.1)',
  };
};
