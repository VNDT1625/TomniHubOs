/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Only raster data URLs are accepted so a persisted preference cannot inject CSS. */
const WALLPAPER_DATA_URL = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;

export const WALLPAPER_MAX_FILE_BYTES = 8 * 1024 * 1024;
const WALLPAPER_MAX_DATA_URL_LENGTH = Math.ceil((WALLPAPER_MAX_FILE_BYTES * 4) / 3) + 128;

export const isWallpaperDataUrl = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= WALLPAPER_MAX_DATA_URL_LENGTH && WALLPAPER_DATA_URL.test(value);

/** Applies a validated user image to the shared glass shell, or restores desktop transparency. */
export const applyWallpaper = (value: unknown): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (isWallpaperDataUrl(value)) {
    root.style.setProperty('--app-wallpaper', `url("${value}")`);
    root.dataset.wallpaper = 'custom';
    return;
  }
  root.style.removeProperty('--app-wallpaper');
  delete root.dataset.wallpaper;
};
