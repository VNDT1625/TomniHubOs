import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type {
  RealtimeCity,
  RealtimeHuggingFaceKind,
  RealtimeMarketRange,
  RealtimeSource,
} from '@/common/types/platform/realtimeContent';
import { refreshRealtime, useRealtimeSource } from '../services/realtimeClient';
import { RealtimeHistoryChart } from './RealtimeHistoryChart';
import { weatherGroupOf } from '../services/weatherCodes';

type Props = {
  source: Exclude<RealtimeSource, 'news'>;
  itemId?: string;
  city?: RealtimeCity;
  onOpenExternal: (url: string) => void;
};
const TITLES: Record<Exclude<RealtimeSource, 'news'>, string> = {
  github: 'news.github.title',
  huggingface: 'news.hub.custom.huggingface',
  weather: 'news.weather.title',
  market: 'news.market.title',
};
export const RealtimeSourceFocusView: React.FC<Props> = ({ source, itemId, city, onOpenExternal }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [range, setRange] = useState<RealtimeMarketRange>('1m');
  const [kind, setKind] = useState<RealtimeHuggingFaceKind>('models');
  const [language, setLanguage] = useState('all');
  const marketRange = source === 'market' ? range : undefined;
  const huggingFaceKind = source === 'huggingface' && kind !== 'models' ? kind : undefined;
  const data = useRealtimeSource(source, source === 'weather' ? city : undefined, marketRange, huggingFaceKind);
  const [search, setSearch] = useState('');
  const selected = itemId ? data.items.find((item) => item.id === itemId) : undefined;
  const highlighted = selected ?? data.items[0];
  const languages = [
    ...new Set(data.items.map((item) => item.language).filter((name): name is string => !!name)),
  ].slice(0, 12);
  const items = data.items.filter(
    (item) =>
      `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase()) &&
      (source !== 'github' || language === 'all' || item.language === language)
  );
  const route = (id?: string): string => `/realtime?view=${source}${id ? `&item=${encodeURIComponent(id)}` : ''}`;
  return (
    <main className='realtime-page realtime-focus-page' data-testid={`realtime-focus-${source}`}>
      <button type='button' className='realtime-back' onClick={() => navigate('/realtime')}>
        ← {t('news.hub.back')}
      </button>
      <header className='realtime-page-header'>
        <div>
          <h1>{t(TITLES[source])}</h1>
          <p>{t('news.hub.custom.sourceDescription')}</p>
        </div>
        <button
          type='button'
          className='realtime-action'
          onClick={() =>
            void refreshRealtime(source, source === 'weather' ? city : undefined, true, marketRange, huggingFaceKind)
          }
        >
          {t('news.refresh')} ↻
        </button>
      </header>
      {data.updatedAt && (
        <p className='realtime-metadata'>
          {t('news.lastUpdated', { time: new Date(data.updatedAt).toLocaleString() })}
        </p>
      )}
      {data.error && (
        <p role='status' className='realtime-warning'>
          {t('news.hub.custom.failed')} ({data.error})
        </p>
      )}
      {data.status === 'loading' && <p role='status'>{t('news.refreshing')}</p>}
      {source === 'huggingface' && (
        <div className='realtime-focus-filter-pills' role='tablist' aria-label={t('news.hub.custom.huggingface')}>
          {(['models', 'datasets', 'spaces'] as const).map((next) => (
            <button
              key={next}
              type='button'
              role='tab'
              aria-selected={kind === next}
              onClick={() => {
                setKind(next);
                navigate(route());
              }}
            >
              {t(`news.hub.custom.${next}`)}
            </button>
          ))}
        </div>
      )}
      {source === 'github' && languages.length > 0 && (
        <div className='realtime-focus-filter-pills' role='group' aria-label={t('news.hub.custom.languageFilter')}>
          {['all', ...languages].map((name) => (
            <button key={name} type='button' aria-pressed={language === name} onClick={() => setLanguage(name)}>
              {name === 'all' ? t('news.category.all') : name}
            </button>
          ))}
        </div>
      )}
      {source === 'market' && (
        <section className='realtime-market-history' aria-label={t('news.hub.custom.marketHistory')}>
          <div className='realtime-market-ranges' role='group' aria-label={t('news.hub.timeframe')}>
            {(['1d', '1w', '1m', '1y', '5y'] as const).map((period) => (
              <button
                key={period}
                type='button'
                aria-pressed={range === period}
                className={range === period ? 'realtime-market-range-active' : ''}
                onClick={() => setRange(period)}
              >
                {period.toUpperCase()}
              </button>
            ))}
          </div>
          {highlighted?.history && highlighted.history.length > 1 ? (
            <RealtimeHistoryChart
              points={highlighted.history}
              title={`${highlighted.title} · ${range.toUpperCase()}`}
            />
          ) : (
            data.status !== 'loading' && <p className='realtime-empty'>{t('news.hub.custom.noHistory')}</p>
          )}
        </section>
      )}
      {source === 'weather' && highlighted?.weatherCode !== undefined && (
        <p className='realtime-metadata'>{t(`news.hub.weather.${weatherGroupOf(highlighted.weatherCode)}`)}</p>
      )}
      {source === 'weather' && highlighted?.forecast && highlighted.forecast.length > 0 && (
        <section className='realtime-weather-hourly'>
          <h2>{t('news.hub.custom.hourlyForecast')}</h2>
          <div className='realtime-hourly-grid'>
            {highlighted.forecast.map((hour) => (
              <div key={hour.time} className='realtime-hourly-cell'>
                <time dateTime={hour.time}>{hour.time.slice(11, 16)}</time>
                <strong>{hour.value.toLocaleString()}°C</strong>
              </div>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <section className='realtime-selected-item'>
          <button className='realtime-back' type='button' onClick={() => navigate(route())}>
            ← {t('news.hub.custom.allItems')}
          </button>
          <h2>{selected.title}</h2>
          <p>{selected.description}</p>
          {selected.value !== undefined && (
            <strong>
              {selected.value.toLocaleString()} {selected.unit ?? ''}
            </strong>
          )}
          {selected.url && (
            <button type='button' className='realtime-action' onClick={() => onOpenExternal(selected.url!)}>
              {t('news.openOriginal')} ↗
            </button>
          )}
        </section>
      )}
      {!selected && itemId && data.status === 'ready' && <p role='status'>{t('news.hub.custom.notFound')}</p>}
      <input
        className='realtime-filter-input'
        type='search'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('news.hub.custom.searchItems')}
        aria-label={t('news.hub.custom.searchItems')}
      />
      <div className='realtime-repos-focus-list'>
        {items.map((item) => (
          <div key={item.id} className='realtime-repo-focus-row'>
            <div>
              <button type='button' className='realtime-title-button' onClick={() => navigate(route(item.id))}>
                <strong>{item.title}</strong>
              </button>
              <p>{item.description}</p>
              {item.language && <span className='realtime-metadata'>{item.language}</span>}
            </div>
            <div className='realtime-focus-actions'>
              {item.value !== undefined && (
                <strong>
                  {item.value.toLocaleString()} {item.unit ?? ''}
                </strong>
              )}
              {item.changePercent !== undefined && <small>{item.changePercent.toFixed(2)}%</small>}
              {source === 'github' && item.forks !== undefined && (
                <small>{t('news.hub.custom.forks', { count: item.forks })}</small>
              )}
              {item.url && (
                <button type='button' className='realtime-action' onClick={() => onOpenExternal(item.url!)}>
                  ↗
                </button>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && data.status !== 'loading' && (
          <p className='realtime-empty'>{t('news.hub.custom.noItems')}</p>
        )}
      </div>
    </main>
  );
};
