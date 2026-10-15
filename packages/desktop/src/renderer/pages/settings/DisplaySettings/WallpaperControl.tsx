/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { WALLPAPER_MAX_FILE_BYTES, isWallpaperDataUrl } from '@/renderer/utils/theme/wallpaper';
import { Button, Message } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const ACCEPTED_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('WALLPAPER_FILE_READ_FAILED'));
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('WALLPAPER_FILE_READ_FAILED'));
    reader.readAsDataURL(file);
  });

/** Selects a bounded raster image that is stored in user configuration, never injected as CSS. */
const WallpaperControl: React.FC = () => {
  const { t } = useTranslation();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [hasWallpaper, setHasWallpaper] = React.useState(() => isWallpaperDataUrl(configService.get('ui.wallpaper')));
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(
    () => configService.subscribe('ui.wallpaper', (value) => setHasWallpaper(isWallpaperDataUrl(value))),
    []
  );

  const selectImage = React.useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        Message.error(t('settings.wallpaper.invalidType'));
        return;
      }
      if (file.size === 0 || file.size > WALLPAPER_MAX_FILE_BYTES) {
        Message.error(t('settings.wallpaper.tooLarge', { size: WALLPAPER_MAX_FILE_BYTES / (1024 * 1024) }));
        return;
      }

      setIsSaving(true);
      try {
        const imageDataUrl = await readAsDataUrl(file);
        if (!isWallpaperDataUrl(imageDataUrl)) throw new Error('WALLPAPER_DATA_INVALID');
        await configService.set('ui.wallpaper', imageDataUrl);
        Message.success(t('settings.wallpaper.saved'));
      } catch (error) {
        console.error('Failed to save wallpaper:', error);
        Message.error(t('settings.wallpaper.saveError'));
      } finally {
        setIsSaving(false);
      }
    },
    [t]
  );

  const clearImage = React.useCallback(async () => {
    setIsSaving(true);
    try {
      await configService.remove('ui.wallpaper');
      Message.success(t('settings.wallpaper.cleared'));
    } catch (error) {
      console.error('Failed to clear wallpaper:', error);
      Message.error(t('settings.wallpaper.saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [t]);

  return (
    <div className='flex flex-wrap items-center gap-8px'>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/avif,image/gif,image/jpeg,image/png,image/webp'
        className='hidden'
        onChange={handleFileChange}
      />
      <Button type='secondary' size='small' loading={isSaving} onClick={selectImage}>
        {t(hasWallpaper ? 'settings.wallpaper.change' : 'settings.wallpaper.select')}
      </Button>
      {hasWallpaper ? (
        <Button type='text' size='small' disabled={isSaving} onClick={() => void clearImage()}>
          {t('settings.wallpaper.remove')}
        </Button>
      ) : null}
    </div>
  );
};

export default WallpaperControl;
