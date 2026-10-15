import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { configService } from '@/common/config/configService';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import {
  MEDIA_MODALITIES,
  mediaReferenceKey,
  parseMediaDefaults,
  type MediaDefaults,
  type MediaModality,
} from './mediaDefaultsContract';

const CONFIG_KEY = 'ai.mediaModelDefaults';
const LABELS = {
  image: 'Image',
  video: 'Video',
  audioGeneration: 'Audio generation',
  tts: 'Text to speech (TTS)',
  stt: 'Speech to text (STT)',
};

/** Stores preferences only. Catalog membership is not proof of transport capability. */
export default function MediaModelDefaults(): React.JSX.Element {
  const { t } = useTranslation();
  const { data, error: catalogError, mutate } = useProvidersQuery();
  const [defaults, setDefaults] = useState<MediaDefaults>({});
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'loadError' | 'saveError'>('loading');
  const busy = useRef(false);
  const mounted = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const options = useMemo(
    () =>
      (data ?? [])
        .filter((provider) => provider.enabled !== false)
        .flatMap((provider) =>
          [...new Set(provider.models)]
            .filter((modelId) => provider.model_enabled?.[modelId] !== false)
            .flatMap((modelId) => {
              try {
                const reference = parseMediaDefaults({ image: { providerId: provider.id, modelId } }).image;
                return reference
                  ? [{ reference, value: mediaReferenceKey(reference), label: `${provider.name} / ${modelId}` }]
                  : [];
              } catch {
                return [];
              }
            })
        ),
    [data]
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    setState('loading');
    void configService
      .whenReady()
      .then(() => configService.refresh(CONFIG_KEY))
      .then((value) => {
        const parsed = parseMediaDefaults(value);
        if (active) {
          setDefaults(parsed);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) setState('loadError');
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [attempt]);

  const save = async (modality: MediaModality, value: string): Promise<void> => {
    if (busy.current) return;
    const option = options.find((item) => item.value === value);
    if (value && !option) return;
    const previous = defaults;
    const next = { ...previous };
    if (option) next[modality] = option.reference;
    else delete next[modality];
    busy.current = true;
    setState('saving');
    try {
      await configService.set(CONFIG_KEY, parseMediaDefaults(next));
      if (mounted.current) {
        setDefaults(next);
        setState('saved');
      }
    } catch {
      configService.setLocal(CONFIG_KEY, previous);
      if (mounted.current) setState('saveError');
    } finally {
      busy.current = false;
    }
  };

  const unavailable =
    state === 'loading' || state === 'loadError' || state === 'saving' || !data || Boolean(catalogError);
  return (
    <section aria-label={t('settings.mediaDefaults.title', { defaultValue: 'Media model defaults' })}>
      <h3>{t('settings.mediaDefaults.title', { defaultValue: 'Media model defaults' })}</h3>
      <p>
        {t('settings.mediaDefaults.notice', {
          defaultValue:
            'Configuration only. These choices do not enable image, video, audio generation, TTS or STT transports. Configured models are not verified for these capabilities.',
        })}
      </p>
      {(state === 'loading' || (!data && !catalogError)) && (
        <p role='status'>{t('settings.mediaDefaults.loading', { defaultValue: 'Loading model defaults…' })}</p>
      )}
      {(state === 'loadError' || catalogError) && (
        <div role='alert'>
          <p>
            {t('settings.mediaDefaults.loadError', {
              defaultValue: 'Could not load model defaults or the configured catalog.',
            })}
          </p>
          <button
            type='button'
            onClick={() => {
              setAttempt((value) => value + 1);
              void mutate().catch((): undefined => undefined);
            }}
          >
            {t('settings.mediaDefaults.retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      )}
      {data && options.length === 0 && (
        <p>
          {t('settings.mediaDefaults.empty', {
            defaultValue: 'No enabled configured models. Add models in provider settings.',
          })}
        </p>
      )}
      <fieldset disabled={unavailable}>
        {MEDIA_MODALITIES.map((modality) => {
          const reference = defaults[modality];
          const value = reference ? mediaReferenceKey(reference) : '';
          const missing = Boolean(value) && !options.some((option) => option.value === value);
          return (
            <p key={modality}>
              <label>
                {t(`settings.mediaDefaults.${modality}`, { defaultValue: LABELS[modality] })}
                <select
                  value={value}
                  onChange={(event) => {
                    void save(modality, event.target.value);
                  }}
                >
                  <option value=''>{t('settings.mediaDefaults.none', { defaultValue: 'Not selected (clear)' })}</option>
                  {missing && (
                    <option value={value} disabled>
                      {t('settings.mediaDefaults.unavailable', {
                        defaultValue: 'Saved model unavailable — choose another or clear',
                      })}
                    </option>
                  )}
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </p>
          );
        })}
      </fieldset>
      {state === 'saving' && <p role='status'>{t('settings.mediaDefaults.saving', { defaultValue: 'Saving…' })}</p>}
      {state === 'saved' && (
        <p role='status'>{t('settings.mediaDefaults.saved', { defaultValue: 'Model defaults saved.' })}</p>
      )}
      {state === 'saveError' && (
        <p role='alert'>
          {t('settings.mediaDefaults.saveError', {
            defaultValue: 'Could not save. The last acknowledged choices are retained; select again to retry.',
          })}
        </p>
      )}
    </section>
  );
}
