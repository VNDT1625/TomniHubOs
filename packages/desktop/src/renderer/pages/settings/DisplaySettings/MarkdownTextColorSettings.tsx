/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import {
  MARKDOWN_TEXT_TOKENS,
  applyMarkdownTextColors,
  getDefaultMarkdownTextColor,
  sanitizeMarkdownTextColors,
} from '@/renderer/utils/theme/markdownTextColors';
import type { MarkdownTextColors, MarkdownTextTokenId } from '@/renderer/utils/theme/markdownTextColors';
import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/** Literal label keys so the typed translation function checks each one. */
const TOKEN_LABEL_KEYS = {
  h1: 'settings.markdownColors.tokens.h1',
  h2: 'settings.markdownColors.tokens.h2',
  h3: 'settings.markdownColors.tokens.h3',
  text: 'settings.markdownColors.tokens.text',
  bold: 'settings.markdownColors.tokens.bold',
  link: 'settings.markdownColors.tokens.link',
  path: 'settings.markdownColors.tokens.path',
  codeFg: 'settings.markdownColors.tokens.codeFg',
  codeBg: 'settings.markdownColors.tokens.codeBg',
  quote: 'settings.markdownColors.tokens.quote',
} as const satisfies Record<MarkdownTextTokenId, string>;

const currentTheme = (): 'light' | 'dark' =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

/**
 * Per-token color overrides for chat Markdown. Colors are deterministic defaults from
 * tomni-ui.css; a user value is stored in config and applied as a root --md-* property.
 */
const MarkdownTextColorSettings: React.FC = () => {
  const { t } = useTranslation();
  const [colors, setColors] = React.useState<MarkdownTextColors>(() =>
    sanitizeMarkdownTextColors(configService.get('ui.markdownTextColors'))
  );
  const [theme, setTheme] = React.useState<'light' | 'dark'>(currentTheme);

  React.useEffect(
    () =>
      configService.subscribe('ui.markdownTextColors', (value) => {
        setColors(sanitizeMarkdownTextColors(value));
      }),
    []
  );

  // Defaults differ per theme; the displayed default follows the active theme.
  React.useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const save = React.useCallback((next: MarkdownTextColors) => {
    setColors(next);
    applyMarkdownTextColors(next);
    const persist =
      Object.keys(next).length > 0
        ? configService.set('ui.markdownTextColors', next)
        : configService.remove('ui.markdownTextColors');
    void persist.catch((error: unknown) => console.error('Failed to save Markdown text colors:', error));
  }, []);

  const setToken = (id: MarkdownTextTokenId, value: string) => save({ ...colors, [id]: value.toLowerCase() });

  const resetToken = (id: MarkdownTextTokenId) => {
    const next = { ...colors };
    delete next[id];
    save(next);
  };

  const resetAll = () => save({});

  return (
    <div className='flex flex-col gap-12px w-full'>
      <div className='tomni-md-colors'>
        {MARKDOWN_TEXT_TOKENS.map(({ id }) => {
          const label = t(TOKEN_LABEL_KEYS[id]);
          const override = colors[id];
          const value = override ?? getDefaultMarkdownTextColor(id, theme);
          return (
            <div key={id} className='tomni-md-colors__row'>
              <span className='text-14px text-t-primary leading-22px'>{label}</span>
              <input
                type='color'
                className='tomni-md-colors__input'
                aria-label={label}
                value={value}
                onChange={(event) => setToken(id, event.target.value)}
              />
              <Button type='text' size='small' disabled={!override} onClick={() => resetToken(id)}>
                {t('settings.markdownColors.resetToken')}
              </Button>
            </div>
          );
        })}
      </div>

      <div className='flex items-center justify-between gap-8px'>
        <span className='text-12px text-t-tertiary'>{t('settings.markdownColors.previewLabel')}</span>
        <Button type='secondary' size='small' disabled={Object.keys(colors).length === 0} onClick={resetAll}>
          {t('settings.markdownColors.resetAll')}
        </Button>
      </div>

      <div className='tomni-md-body tomni-md-preview' data-testid='markdown-color-preview'>
        <h1>{t(TOKEN_LABEL_KEYS.h1)}</h1>
        <h2>{t(TOKEN_LABEL_KEYS.h2)}</h2>
        <h3>{t(TOKEN_LABEL_KEYS.h3)}</h3>
        <p>
          {t('settings.markdownColors.previewBody')} <strong>{t(TOKEN_LABEL_KEYS.bold)}</strong>{' '}
          <a href='#' onClick={(event) => event.preventDefault()}>
            {t(TOKEN_LABEL_KEYS.link)}
          </a>
        </p>
        <p>
          <code className='tomni-md-chip tomni-md-chip--path'>packages/desktop/src/renderer/App.tsx</code>{' '}
          <code className='tomni-md-chip'>opencode -s ses_ebf67622fffeMxGeKVYk9Ax8tx</code>
        </p>
        <blockquote>{t(TOKEN_LABEL_KEYS.quote)}</blockquote>
      </div>
    </div>
  );
};

export default MarkdownTextColorSettings;
