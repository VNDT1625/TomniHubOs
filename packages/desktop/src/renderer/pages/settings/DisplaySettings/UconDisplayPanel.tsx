import React, { useState } from 'react';
import { Button, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { UconBot } from '@/renderer/components/agents/UconBot';
import {
  resetUconDisplayPrefs,
  setUconDisplayPref,
  useUconDisplayPrefs,
  type UconDisplayPrefs,
} from '@/renderer/components/agents/uconDisplayPrefs';
import UconGalleryModal from './UconGalleryModal';

const KEYS = ['enabled', 'animate', 'live', 'assistants', 'miniSubagents'] as const;
const LABELS: Record<keyof UconDisplayPrefs, { name: string; description: string }> = {
  enabled: { name: 'Show UCON avatars', description: 'Use robot avatars instead of minimal static icons.' },
  animate: { name: 'Animate UCON', description: 'Turn off moving Canvas frames to reduce resource usage.' },
  live: { name: 'Show in Live Dashboard', description: 'Display UCON in running agent and team cards.' },
  assistants: {
    name: 'Show for Assistants',
    description: 'Display selected UCON avatars in Assistant cards and editor.',
  },
  miniSubagents: { name: 'Show mini subagents', description: 'Show inherited mini bots for team members.' },
};

const UconDisplayPanel: React.FC = () => {
  const { t } = useTranslation();
  const prefs = useUconDisplayPrefs();
  const [mode, setMode] = useState<'gallery' | 'studio' | null>(null);
  const [error, setError] = useState(false);
  const update = (key: keyof UconDisplayPrefs, checked: boolean) => {
    setError(false);
    void setUconDisplayPref(key, checked).catch(() => setError(true));
  };
  const reset = () => {
    setError(false);
    void resetUconDisplayPrefs().catch(() => setError(true));
  };
  return (
    <section className='ucon-display-panel' data-testid='ucon-display-panel'>
      <div className='ucon-display-panel__head'>
        <UconBot placement='gallery' staticPreview state='idle' archetype='core' size='large' label='Tomny UCON Core' />
        <div>
          <h3>{t('settings.ucon.title', { defaultValue: 'UCON · Avatars' })}</h3>
          <p>
            {t('settings.ucon.description', {
              defaultValue:
                '21 built-in looks (10 Core + 11 CLI including Grok), plus installed UI package skins. Tomny keeps its original design.',
            })}
          </p>
        </div>
      </div>
      <div className='ucon-display-panel__prefs'>
        {KEYS.map((key) => (
          <label className='ucon-display-panel__row' key={key}>
            <span>
              <strong>{t('settings.ucon.' + key, { defaultValue: LABELS[key].name })}</strong>
              <small>{t('settings.ucon.' + key + 'Hint', { defaultValue: LABELS[key].description })}</small>
            </span>
            <Switch
              data-testid={'ucon-pref-' + key}
              checked={prefs[key]}
              onChange={(checked) => update(key, checked)}
              disabled={!prefs.enabled && key !== 'enabled'}
            />
          </label>
        ))}
      </div>
      <div className='ucon-display-panel__actions'>
        <Button type='primary' data-testid='open-ucon-gallery' onClick={() => setMode('gallery')}>
          {t('settings.ucon.openGallery', { defaultValue: 'Open skin gallery' })}
        </Button>
        <Button data-testid='open-ucon-studio' onClick={() => setMode('studio')}>
          {t('settings.ucon.openStudio', { defaultValue: 'Customize / Studio' })}
        </Button>
        <Button status='warning' data-testid='reset-ucon-prefs' onClick={reset}>
          {t('settings.ucon.reset', { defaultValue: 'Reset display settings' })}
        </Button>
      </div>
      <p className='ucon-display-panel__note'>
        {t('settings.ucon.resetHint', {
          defaultValue:
            'Reset only restores display preferences; it never deletes installed skins, avatar choices or agent data.',
        })}
      </p>
      {error && (
        <p role='alert'>
          {t('settings.ucon.saveError', { defaultValue: 'Could not save UCON preferences. Please retry.' })}
        </p>
      )}
      <UconGalleryModal visible={mode !== null} mode={mode ?? 'gallery'} onClose={() => setMode(null)} />
    </section>
  );
};
export default UconDisplayPanel;
