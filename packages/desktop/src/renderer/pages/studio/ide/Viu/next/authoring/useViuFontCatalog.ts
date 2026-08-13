/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ViuFontCatalogStatus, ViuFontOption } from './types';

export type ViuLocalFontDescriptor = {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
};

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<readonly ViuLocalFontDescriptor[]>;
};

const CURATED_FONT_FAMILIES = [
  'Aptos',
  'Aptos Display',
  'Arial',
  'Arial Narrow',
  'Bahnschrift',
  'Be Vietnam Pro',
  'Book Antiqua',
  'Calibri',
  'Cambria',
  'Candara',
  'Cascadia Code',
  'Cascadia Mono',
  'Century Gothic',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Fira Code',
  'Fira Sans',
  'Franklin Gothic Medium',
  'Garamond',
  'Georgia',
  'Helvetica',
  'IBM Plex Mono',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'Impact',
  'JetBrains Mono',
  'Lato',
  'Leelawadee UI',
  'Lucida Sans Unicode',
  'Malgun Gothic',
  'Meiryo',
  'Microsoft JhengHei UI',
  'Microsoft YaHei UI',
  'Montserrat',
  'Nirmala UI',
  'Noto Sans',
  'Noto Sans CJK JP',
  'Noto Sans CJK KR',
  'Noto Sans CJK SC',
  'Noto Sans CJK TC',
  'Noto Sans Mono',
  'Noto Sans Thai',
  'Noto Sans Vietnamese',
  'Noto Serif',
  'Noto Serif CJK JP',
  'Open Sans',
  'Palatino Linotype',
  'Roboto',
  'Roboto Condensed',
  'Segoe Print',
  'Segoe UI',
  'Segoe UI Emoji',
  'Segoe UI Variable',
  'Source Code Pro',
  'Source Sans 3',
  'Source Serif 4',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Ubuntu',
  'Verdana',
  'Yu Gothic UI',
] as const;

const normalizeFamily = (family: string): string => family.trim().replace(/^['"]|['"]$/g, '');

type MutableFontEntry = {
  source: NonNullable<ViuFontOption['source']>;
  styles: Set<string>;
};

export const createViuFontOptions = (
  localFonts: readonly ViuLocalFontDescriptor[],
  currentFont?: string
): ViuFontOption[] => {
  const entries = new Map<string, MutableFontEntry>();

  for (const family of CURATED_FONT_FAMILIES) {
    entries.set(family, { source: 'curated', styles: new Set() });
  }
  for (const font of localFonts) {
    const family = normalizeFamily(font.family);
    if (!family) continue;
    const entry = entries.get(family) ?? { source: 'system' as const, styles: new Set<string>() };
    entry.source = 'system';
    if (font.style?.trim()) entry.styles.add(font.style.trim());
    entries.set(family, entry);
  }
  if (currentFont) {
    const primaryFamily = normalizeFamily(currentFont.split(',')[0] ?? '');
    if (primaryFamily && !entries.has(primaryFamily)) {
      entries.set(primaryFamily, { source: 'document', styles: new Set() });
    }
  }

  return [...entries.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .map(([family, entry]) => ({
      value: family,
      label: family,
      source: entry.source,
      styles: [...entry.styles].toSorted((left, right) => left.localeCompare(right)),
    }));
};

/** Loads every locally installed font exposed by Chromium's Local Font Access API. */
export const useViuFontCatalog = (currentFont?: string) => {
  const [localFonts, setLocalFonts] = useState<readonly ViuLocalFontDescriptor[]>([]);
  const [status, setStatus] = useState<ViuFontCatalogStatus>('idle');
  const inFlightRef = useRef<Promise<void> | null>(null);

  const loadSystemFonts = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const request = (async (): Promise<void> => {
      const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;
      if (!queryLocalFonts) {
        setStatus('unsupported');
        return;
      }
      setStatus('loading');
      try {
        const fonts = await queryLocalFonts();
        setLocalFonts(fonts);
        setStatus('ready');
      } catch (error) {
        setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission-denied' : 'error');
      }
    })();
    inFlightRef.current = request;
    void request.then(
      () => {
        inFlightRef.current = null;
      },
      () => {
        inFlightRef.current = null;
      }
    );
    return request;
  }, []);

  const options = useMemo(() => createViuFontOptions(localFonts, currentFont), [currentFont, localFonts]);
  const systemFontCount = useMemo(
    () => new Set(localFonts.map((font) => normalizeFamily(font.family)).filter(Boolean)).size,
    [localFonts]
  );

  return { options, status, systemFontCount, loadSystemFonts } as const;
};
