import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Settings2, ChevronDown, ChevronRight, ArrowUp, ArrowDown, X, RotateCw } from 'lucide-react';
import type { RealtimeCity, RealtimeSource } from '@/common/types/platform/realtimeContent';
import { refreshRealtime, useRealtimeSource } from '../services/realtimeClient';
import { weatherGroupOf } from '../services/weatherCodes';
import {
  WIDGET_CATALOG,
  readWidgetSettings,
  saveWidgetSettings,
  moveWidget,
  type RealtimeWidgetId,
  type RealtimeWidgetSettings,
} from './widgetRegistry';

const pageFor = (id: RealtimeWidgetId, item?: string): string =>
  `/realtime?view=${encodeURIComponent(id)}${item ? `&item=${encodeURIComponent(item)}` : ''}`;

const RealtimeCard: React.FC<{
  id: RealtimeWidgetId;
  collapsed: boolean;
  city: RealtimeCity;
  editing: boolean;
  onCollapse: () => void;
  onRemove: () => void;
  onMove: (step: -1 | 1) => void;
}> = ({ id, collapsed, city, editing, onCollapse, onRemove, onMove }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const definition = WIDGET_CATALOG.find((item) => item.id === id)!;
  const source: RealtimeSource = definition.source;
  const data = useRealtimeSource(source, source === 'weather' ? city : undefined);
  return (
    <section className='realtime-rail-card' data-testid={`realtime-widget-${id}`}>
      <div className='realtime-rail-card-header'>
        {editing && (
          <>
            <button
              type='button'
              title={t('news.hub.custom.up')}
              aria-label={t('news.hub.custom.up')}
              onClick={() => onMove(-1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type='button'
              title={t('news.hub.custom.down')}
              aria-label={t('news.hub.custom.down')}
              onClick={() => onMove(1)}
            >
              <ArrowDown size={13} />
            </button>
          </>
        )}
        <button type='button' className='realtime-rail-open' onClick={() => navigate(pageFor(id))}>
          {t(definition.titleKey)} <ChevronRight size={14} />
        </button>
        <button
          type='button'
          title={t('news.refresh')}
          aria-label={t('news.refresh')}
          onClick={() => void refreshRealtime(source, source === 'weather' ? city : undefined, true)}
        >
          <RotateCw size={13} />
        </button>
        <button
          type='button'
          title={t('news.hub.custom.collapse')}
          aria-label={t('news.hub.custom.collapse')}
          onClick={onCollapse}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        {editing && (
          <button type='button' title={t('news.market.remove')} aria-label={t('news.market.remove')} onClick={onRemove}>
            <X size={13} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className='realtime-rail-card-body'>
          {data.status === 'loading' && <p role='status'>{t('news.refreshing')}</p>}
          {data.error && (
            <p role='status' className='realtime-rail-error'>
              {t('news.hub.custom.failed')} ({data.error})
            </p>
          )}
          <div className={id === 'market' ? 'realtime-rail-market-grid' : 'realtime-rail-items'}>
            {data.items.slice(0, id === 'market' ? 4 : 3).map((item) => (
              <button
                className='realtime-rail-item'
                type='button'
                key={item.id}
                onClick={() => navigate(pageFor(id, item.id))}
              >
                <span className='realtime-rail-item-title'>{item.title}</span>
                <span className='realtime-rail-item-value'>
                  {item.value === undefined
                    ? item.description
                    : `${item.value.toLocaleString()}${item.unit === '°C' ? '°C' : ''}`}
                </span>
                {item.changePercent !== undefined && (
                  <span className='realtime-rail-item-change'>
                    {item.changePercent > 0 ? '+' : ''}
                    {item.changePercent.toFixed(2)}%
                  </span>
                )}
                {id === 'github' && item.language && <small>{item.language}</small>}
                {id === 'github' && item.description && <small>{item.description}</small>}
              </button>
            ))}
          </div>
          {id === 'weather' && data.items[0]?.weatherCode !== undefined && (
            <p className='realtime-metadata'>{t(`news.hub.weather.${weatherGroupOf(data.items[0].weatherCode)}`)}</p>
          )}
          {id === 'weather' && data.items[0]?.forecast && data.items[0].forecast.length > 0 && (
            <div className='realtime-rail-forecast' aria-label={t('news.hub.custom.hourlyForecast')}>
              {data.items[0].forecast.slice(0, 5).map((hour) => (
                <span key={hour.time}>
                  <small>{hour.time.slice(11, 16)}</small>
                  <strong>{hour.value.toLocaleString()}°</strong>
                </span>
              ))}
            </div>
          )}
          {data.status === 'ready' && data.updatedAt && (
            <small>{t('news.lastUpdated', { time: new Date(data.updatedAt).toLocaleTimeString() })}</small>
          )}
        </div>
      )}
    </section>
  );
};

export const RealtimeWidgetRail: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<RealtimeWidgetSettings>(readWidgetSettings);
  const [editing, setEditing] = useState(false);
  const update = (next: RealtimeWidgetSettings): void => {
    setSettings(next);
    saveWidgetSettings(next);
  };
  const missing = WIDGET_CATALOG.filter(({ id }) => !settings.widgets.some((widget) => widget.id === id));
  return (
    <section className='realtime-rail-content' data-testid='hub-rail-realtime'>
      <div className='realtime-rail-controls'>
        <strong>{t('news.navTitle')}</strong>
        <button
          type='button'
          aria-label={t('news.hub.custom.settings')}
          title={t('news.hub.custom.settings')}
          onClick={() => setEditing((value) => !value)}
        >
          <Settings2 size={15} />
        </button>
      </div>
      {editing && (
        <div className='realtime-widget-editor'>
          <span>{t('news.hub.custom.description')}</span>
          <label>
            {t('news.weather.setLocation')}
            <select
              aria-label={t('news.weather.setLocation')}
              value={settings.city}
              onChange={(event) => update({ ...settings, city: event.target.value as RealtimeCity })}
            >
              <option value='hanoi'>Hà Nội</option>
              <option value='hochiminh'>TP. Hồ Chí Minh</option>
              <option value='danang'>Đà Nẵng</option>
            </select>
          </label>
          {missing.map(({ id, titleKey }) => (
            <button
              type='button'
              key={id}
              onClick={() => update({ ...settings, widgets: [...settings.widgets, { id, collapsed: false }] })}
            >
              <Plus size={13} /> {t('news.hub.custom.add')} {t(titleKey)}
            </button>
          ))}
        </div>
      )}
      {settings.widgets.map(({ id, collapsed }) => (
        <RealtimeCard
          key={id}
          id={id}
          city={settings.city}
          collapsed={collapsed}
          editing={editing}
          onCollapse={() =>
            update({
              ...settings,
              widgets: settings.widgets.map((item) =>
                item.id === id ? { ...item, collapsed: !item.collapsed } : item
              ),
            })
          }
          onRemove={() => update({ ...settings, widgets: settings.widgets.filter((item) => item.id !== id) })}
          onMove={(step) => update(moveWidget(settings, id, step))}
        />
      ))}
      {settings.widgets.length === 0 && <p className='realtime-widget-empty'>{t('news.hub.custom.noWidgets')}</p>}
      {!editing && missing.length > 0 && (
        <button className='realtime-rail-add' type='button' onClick={() => setEditing(true)}>
          <Plus size={14} /> {t('news.hub.custom.addWidget')}
        </button>
      )}
    </section>
  );
};
