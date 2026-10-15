import type { RealtimeCity, RealtimeSource } from '@/common/types/platform/realtimeContent';

/** Safe built-in registry. Third-party package widgets require a separate capability contract. */
export type RealtimeWidgetId = 'weather' | 'market' | 'github' | 'huggingface';
export type RealtimeWidgetConfig = Readonly<{ id: RealtimeWidgetId; collapsed: boolean }>;
export type RealtimeWidgetSettings = Readonly<{ widgets: readonly RealtimeWidgetConfig[]; city: RealtimeCity }>;
export const WIDGET_CATALOG: readonly Readonly<{ id: RealtimeWidgetId; source: RealtimeSource; titleKey: string }>[] = [
  { id: 'weather', source: 'weather', titleKey: 'news.weather.title' },
  { id: 'market', source: 'market', titleKey: 'news.market.title' },
  { id: 'github', source: 'github', titleKey: 'news.github.title' },
  { id: 'huggingface', source: 'huggingface', titleKey: 'news.hub.custom.huggingface' },
];
export const DEFAULT_WIDGET_SETTINGS: RealtimeWidgetSettings = {
  widgets: [
    { id: 'weather', collapsed: false },
    { id: 'market', collapsed: false },
    { id: 'github', collapsed: false },
  ],
  city: 'hanoi',
};
const KEY = 'tomni.realtime.widgets.v1';
export const REALTIME_WIDGET_SETTINGS_CHANGED = 'tomni-realtime-widget-settings-changed';
const isId = (raw: unknown): raw is RealtimeWidgetId => WIDGET_CATALOG.some(({ id }) => id === raw);
const isCity = (raw: unknown): raw is RealtimeCity => ['hanoi', 'hochiminh', 'danang'].includes(String(raw));
/** Reject unknown ids and duplicates, never deserialize arbitrary component code. */
export const parseWidgetSettings = (raw: unknown): RealtimeWidgetSettings => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_WIDGET_SETTINGS;
  const input = raw as Record<string, unknown>;
  const ids = new Set<RealtimeWidgetId>();
  const widgets: RealtimeWidgetConfig[] = [];
  if (Array.isArray(input.widgets))
    for (const item of input.widgets.slice(0, 12)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const data = item as Record<string, unknown>;
      if (!isId(data.id) || ids.has(data.id)) continue;
      ids.add(data.id);
      widgets.push({ id: data.id, collapsed: data.collapsed === true });
    }
  return {
    widgets,
    city: isCity(input.city) ? input.city : 'hanoi',
  };
};
export const readWidgetSettings = (): RealtimeWidgetSettings => {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === null ? DEFAULT_WIDGET_SETTINGS : parseWidgetSettings(JSON.parse(saved) as unknown);
  } catch {
    return DEFAULT_WIDGET_SETTINGS;
  }
};
export const saveWidgetSettings = (settings: RealtimeWidgetSettings): void => {
  try {
        window.localStorage.setItem(KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event(REALTIME_WIDGET_SETTINGS_CHANGED));
  } catch {
    /* optional persistence */
  }
};
export const moveWidget = (
  settings: RealtimeWidgetSettings,
  id: RealtimeWidgetId,
  step: -1 | 1
): RealtimeWidgetSettings => {
  const widgets = [...settings.widgets];
  const index = widgets.findIndex((widget) => widget.id === id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= widgets.length) return settings;
  [widgets[index], widgets[target]] = [widgets[target]!, widgets[index]!];
  return { ...settings, widgets };
};
