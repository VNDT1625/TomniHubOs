/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  getActivePaletteQuery,
  filterPaletteItems,
  type ActivePaletteQuery,
  type PaletteItem,
  type PaletteTrigger,
} from '@/renderer/utils/chat/commandPalette';

export interface UseCommandPaletteControllerOptions {
  input: string;
  caretPosition: number;
  extraSlashCommands?: PaletteItem[];
  extraEntityItems?: PaletteItem[];
  onSelect: (newText: string, newCaretPosition: number) => void;
  onExecuteBuiltin?: (name: string) => void;
}

export function useCommandPaletteController(options: UseCommandPaletteControllerOptions) {
  const { input, caretPosition, extraSlashCommands, extraEntityItems, onSelect, onExecuteBuiltin } = options;

  const activeQuery: ActivePaletteQuery | null = useMemo(
    () => getActivePaletteQuery(input, caretPosition),
    [input, caretPosition]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  // Reset active index and dismissed state when active query token changes
  useEffect(() => {
    setActiveIndex(0);
    if (activeQuery?.token !== dismissedToken) {
      setDismissedToken(null);
    }
  }, [activeQuery?.token, dismissedToken]);

  const items: PaletteItem[] = useMemo(() => {
    if (!activeQuery) return [];
    if (activeQuery.prefix === '@') {
      return filterPaletteItems('@', activeQuery.query, extraEntityItems);
    }
    return filterPaletteItems(activeQuery.prefix, activeQuery.query, extraSlashCommands);
  }, [activeQuery, extraEntityItems, extraSlashCommands]);

  const isOpen = Boolean(activeQuery && items.length > 0 && activeQuery.token !== dismissedToken);

  const selectItem = useCallback(
    (item: PaletteItem) => {
      if (!activeQuery) return;

      const replacement = item.insertText ?? `${item.label} `;
      const before = input.slice(0, activeQuery.start);
      const after = input.slice(activeQuery.end);
      const nextText = before + replacement + after;
      const nextCaret = before.length + replacement.length;

      onSelect(nextText, nextCaret);
      setDismissedToken(activeQuery.token);

      if (item.category === 'builtin' && onExecuteBuiltin) {
        onExecuteBuiltin(item.key);
      }
    },
    [activeQuery, input, onExecuteBuiltin, onSelect]
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent): boolean => {
      if (!isOpen || items.length === 0) return false;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (activeQuery) {
          setDismissedToken(activeQuery.token);
        }
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % items.length);
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
        event.preventDefault();
        const selected = items[activeIndex];
        if (selected) {
          selectItem(selected);
          return true;
        }
      }

      return false;
    },
    [activeIndex, activeQuery, isOpen, items, selectItem]
  );

  const getMenuTitle = useCallback((prefix: PaletteTrigger): string => {
    switch (prefix) {
      case '/':
        return 'Slash Commands & Modes';
      case '@':
        return 'Context & Mentions';
      case '#':
        return 'Knowledge & Memory';
      case '*':
        return 'Chat Pipeline Packages';
      default:
        return 'Command Palette';
    }
  }, []);

  const getMenuHint = useCallback((prefix: PaletteTrigger): string => {
    switch (prefix) {
      case '/':
        return 'Modes, tools & prompt snippets';
      case '@':
        return 'Files, agents & context';
      case '#':
        return 'Memory, rules & docs';
      case '*':
        return 'Repo-to-package workflows';
      default:
        return 'Type to search';
    }
  }, []);

  return {
    isOpen,
    activeQuery,
    items,
    activeIndex,
    setActiveIndex,
    selectItem,
    onKeyDown,
    menuTitle: activeQuery ? getMenuTitle(activeQuery.prefix) : '',
    menuHint: activeQuery ? getMenuHint(activeQuery.prefix) : '',
  };
}
