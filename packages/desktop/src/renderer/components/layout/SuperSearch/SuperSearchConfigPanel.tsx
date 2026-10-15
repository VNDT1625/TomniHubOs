/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidAlias, type AliasMap } from './engine/aliases';
import { DEFAULT_CONFIG, isInAll, isSourceEnabled, isValidUrlTemplate, type SuperSearchConfig } from './engine/config';
import type { SearchProvider } from './engine/types';

type SuperSearchConfigPanelProps = {
  providers: readonly SearchProvider[];
  config: SuperSearchConfig;
  aliasMap: AliasMap;
  onChange: (config: SuperSearchConfig) => void;
};

/** Per-source switches, alias editor and "add a site search from a link". Nothing is queried for a source until it is on. */
const SuperSearchConfigPanel: React.FC<SuperSearchConfigPanelProps> = ({ providers, config, aliasMap, onChange }) => {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ label: '', alias: '', urlTemplate: '' });
  const [formError, setFormError] = useState(false);
  const hasConnected = providers.some(({ source }) => source.kind === 'connected');

  const aliasTaken = (sourceId: string | null, alias: string): boolean =>
    Object.entries(aliasMap).some(([otherId, other]) => otherId !== sourceId && other === alias);

  const commitAlias = (sourceId: string) => {
    const draft = (drafts[sourceId] ?? aliasMap[sourceId] ?? '').trim().toLowerCase();
    if (!isValidAlias(draft) || aliasTaken(sourceId, draft)) {
      setInvalid((prev) => ({ ...prev, [sourceId]: true }));
      return;
    }
    setInvalid((prev) => ({ ...prev, [sourceId]: false }));
    setDrafts((prev) => ({ ...prev, [sourceId]: draft }));
    const isCustom = config.custom.some((entry) => entry.id === sourceId);
    onChange(
      isCustom
        ? {
            ...config,
            custom: config.custom.map((entry) => (entry.id === sourceId ? { ...entry, alias: draft } : entry)),
          }
        : { ...config, aliases: { ...config.aliases, [sourceId]: draft } }
    );
  };

  const addCustom = () => {
    const alias = form.alias.trim().toLowerCase();
    const label = form.label.trim();
    const urlTemplate = form.urlTemplate.trim();
    if (
      !label ||
      label.length > 40 ||
      !isValidAlias(alias) ||
      aliasTaken(null, alias) ||
      !isValidUrlTemplate(urlTemplate)
    ) {
      setFormError(true);
      return;
    }
    setFormError(false);
    setForm({ label: '', alias: '', urlTemplate: '' });
    const id = `custom-${Date.now().toString(36)}`;
    onChange({ ...config, custom: [...config.custom, { id, label, alias, urlTemplate }] });
  };

  const removeCustom = (id: string) =>
    onChange({ ...config, custom: config.custom.filter((entry) => entry.id !== id) });

  return (
    <div className='super-search-config' aria-label={t('common.superSearch.config.title')} role='group'>
      <div className='super-search-config__title'>{t('common.superSearch.config.title')}</div>
      <div className='super-search-config__head' aria-hidden='true'>
        <span>{t('common.superSearch.config.source')}</span>
        <span>{t('common.superSearch.config.enabled')}</span>
        <span>{t('common.superSearch.config.inAll')}</span>
        <span>{t('common.superSearch.config.alias')}</span>
        <span />
      </div>
      {providers.map(({ source }) => {
        const isCustom = config.custom.some((entry) => entry.id === source.id);
        return (
          <div key={source.id} className='super-search-config__row'>
            <span className='super-search-config__name'>{source.label}</span>
            <input
              type='checkbox'
              aria-label={`${source.label} — ${t('common.superSearch.config.enabled')}`}
              checked={isSourceEnabled(source, config)}
              onChange={(event) =>
                onChange({ ...config, enabled: { ...config.enabled, [source.id]: event.target.checked } })
              }
            />
            <input
              type='checkbox'
              aria-label={`${source.label} — ${t('common.superSearch.config.inAll')}`}
              checked={isInAll(source, config)}
              onChange={(event) =>
                onChange({ ...config, inAll: { ...config.inAll, [source.id]: event.target.checked } })
              }
            />
            <input
              className='super-search-config__alias'
              type='text'
              maxLength={12}
              aria-label={`${source.label} — ${t('common.superSearch.config.alias')}`}
              aria-invalid={invalid[source.id] ? true : undefined}
              value={drafts[source.id] ?? aliasMap[source.id] ?? ''}
              onChange={(event) => setDrafts((prev) => ({ ...prev, [source.id]: event.target.value }))}
              onBlur={() => commitAlias(source.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitAlias(source.id);
                }
                event.stopPropagation();
              }}
            />
            {isCustom ? (
              <button type='button' className='super-search-footer__btn' onClick={() => removeCustom(source.id)}>
                {t('common.superSearch.config.remove')}
              </button>
            ) : (
              <span />
            )}
            {invalid[source.id] && (
              <span className='super-search-config__error' role='alert'>
                {t('common.superSearch.config.aliasInvalid')}
              </span>
            )}
          </div>
        );
      })}

      <div className='super-search-config__title'>{t('common.superSearch.config.addCustom')}</div>
      <p className='super-search-config__note'>{t('common.superSearch.config.customHelp')}</p>
      <div className='super-search-config__form' onKeyDown={(event) => event.stopPropagation()}>
        <input
          type='text'
          value={form.label}
          maxLength={40}
          placeholder={t('common.superSearch.config.customName')}
          aria-label={t('common.superSearch.config.customName')}
          onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
        />
        <input
          type='text'
          value={form.alias}
          maxLength={12}
          placeholder={t('common.superSearch.config.alias')}
          aria-label={t('common.superSearch.config.alias')}
          onChange={(event) => setForm((prev) => ({ ...prev, alias: event.target.value }))}
        />
        <input
          type='url'
          value={form.urlTemplate}
          placeholder='https://www.google.com/maps/search/{q}'
          aria-label={t('common.superSearch.config.customUrl')}
          onChange={(event) => setForm((prev) => ({ ...prev, urlTemplate: event.target.value }))}
        />
        <button type='button' className='super-search-footer__btn' onClick={addCustom}>
          {t('common.superSearch.config.add')}
        </button>
      </div>
      {formError && (
        <span className='super-search-config__error' role='alert'>
          {t('common.superSearch.config.customInvalid')}
        </span>
      )}

      <p className='super-search-config__note'>
        {hasConnected ? t('common.superSearch.config.connectedNote') : t('common.superSearch.config.none')}
      </p>
      <button
        type='button'
        className='super-search-footer__btn'
        onClick={() => {
          setDrafts({});
          setInvalid({});
          onChange(DEFAULT_CONFIG);
        }}
      >
        {t('common.superSearch.config.reset')}
      </button>
    </div>
  );
};

export default SuperSearchConfigPanel;
