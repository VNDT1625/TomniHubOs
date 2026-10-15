/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns the JSON an assistant writes in a `chart` block into a standalone SVG. Every piece of text is escaped
 * and every number is checked, so the markup is safe to insert into the page and to save as a file.
 */

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

export type ChartSeries = Readonly<{ name: string; data: readonly number[] }>;

export type ChartSpec = Readonly<{
  type: ChartType;
  title?: string;
  unit?: string;
  labels: readonly string[];
  series: readonly ChartSeries[];
}>;

export type ParsedChart = { ok: true; spec: ChartSpec } | { ok: false; error: string };

const MAX_SERIES = 8;
const MAX_POINTS = 120;
const TYPES: ReadonlySet<string> = new Set(['bar', 'line', 'area', 'pie']);

/** Okabe-Ito: distinguishable for the common kinds of colour blindness, and legible on light and dark. */
export const CHART_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#D55E00',
  '#CC79A7',
  '#56B4E9',
  '#F0E442',
  '#999999',
] as const;

const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Reads and validates the JSON of a chart block. Never throws. */
export const parseChartSpec = (source: string): ParsedChart => {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: 'Dữ liệu biểu đồ không phải JSON hợp lệ.' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Biểu đồ cần một đối tượng JSON.' };
  }
  const input = raw as Record<string, unknown>;
  const type = typeof input.type === 'string' ? input.type.toLowerCase() : 'bar';
  if (!TYPES.has(type))
    return { ok: false, error: `Loại biểu đồ "${text(input.type, 20)}" chưa được hỗ trợ (bar, line, area, pie).` };

  let labels: string[] = [];
  let series: ChartSeries[] = [];
  if (Array.isArray(input.data) && input.data.every((item) => typeof item === 'object' && item !== null)) {
    const rows = input.data as Array<Record<string, unknown>>;
    labels = rows.map((row) => text(row.label ?? row.name, 60));
    series = [
      {
        name: text(input.seriesName, 60) || 'Giá trị',
        data: rows.map((row) => (finite(row.value) ? row.value : Number.NaN)),
      },
    ];
  } else if (Array.isArray(input.labels) && Array.isArray(input.series)) {
    labels = input.labels.map((label) => text(label, 60));
    series = input.series.slice(0, MAX_SERIES).map((entry, index) => {
      const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
      const data = Array.isArray(item.data) ? item.data.map((value) => (finite(value) ? value : Number.NaN)) : [];
      return { name: text(item.name, 60) || `Chuỗi ${index + 1}`, data };
    });
  } else {
    return { ok: false, error: 'Biểu đồ cần "labels" và "series", hoặc danh sách "data" gồm label và value.' };
  }

  if (labels.length === 0 || series.length === 0) return { ok: false, error: 'Biểu đồ chưa có dữ liệu.' };
  if (labels.length > MAX_POINTS) return { ok: false, error: `Biểu đồ có quá nhiều điểm (tối đa ${MAX_POINTS}).` };
  for (const entry of series) {
    if (entry.data.length !== labels.length) {
      return {
        ok: false,
        error: `Chuỗi "${entry.name}" có ${entry.data.length} giá trị nhưng có ${labels.length} nhãn.`,
      };
    }
    if (entry.data.some((value) => Number.isNaN(value))) {
      return { ok: false, error: `Chuỗi "${entry.name}" có giá trị không phải số.` };
    }
  }
  if (type === 'pie' && series[0].data.some((value) => value < 0)) {
    return { ok: false, error: 'Biểu đồ tròn không nhận giá trị âm.' };
  }
  return {
    ok: true,
    spec: {
      type: type as ChartType,
      ...(text(input.title, 120) ? { title: text(input.title, 120) } : {}),
      ...(text(input.unit, 12) ? { unit: text(input.unit, 12) } : {}),
      labels,
      series,
    },
  };
};

export const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** A tidy axis: ticks at 1, 2, 5 times a power of ten that cover [min, max], always including zero. */
export const niceTicks = (min: number, max: number, target = 5): number[] => {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (low === high) return [0, 1];
  const rough = (high - low) / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.floor(low / step) * step; value <= Math.ceil(high / step) * step + step / 1e6; value += step) {
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
};

export const formatNumber = (value: number, unit = ''): string => {
  const abs = Math.abs(value);
  const compact =
    abs >= 1e9
      ? `${trim(value / 1e9)}B`
      : abs >= 1e6
        ? `${trim(value / 1e6)}M`
        : abs >= 1e4
          ? `${trim(value / 1e3)}K`
          : trim(value);
  return `${compact}${unit}`;
};
const trim = (value: number): string => String(Math.round(value * 100) / 100);

const WIDTH = 640;
const HEIGHT = 360;
const AXIS = '#8b93a1';
const GRID = 'rgba(139, 147, 161, 0.28)';

const truncate = (label: string, limit: number): string =>
  label.length > limit ? `${label.slice(0, limit - 1)}…` : label;

const legend = (series: readonly { name: string }[], y: number): string => {
  let x = 24;
  const parts: string[] = [];
  series.forEach((entry, index) => {
    const name = truncate(entry.name, 22);
    parts.push(
      `<rect x="${x}" y="${y - 9}" width="12" height="12" rx="2" fill="${CHART_COLORS[index % CHART_COLORS.length]}"/>`,
      `<text x="${x + 18}" y="${y + 1}" font-size="12" fill="${AXIS}">${escapeXml(name)}</text>`
    );
    x += 18 + name.length * 6.6 + 18;
  });
  return parts.join('');
};

const pie = (spec: ChartSpec): string => {
  const values = spec.series[0].data;
  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = 190;
  const cy = 180;
  const radius = 120;
  const parts: string[] = [];
  if (total <= 0) {
    parts.push(
      `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="13" fill="${AXIS}">Không có dữ liệu để vẽ</text>`
    );
  } else {
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      if (value <= 0) return;
      const sweep = (value / total) * Math.PI * 2;
      const color = CHART_COLORS[index % CHART_COLORS.length];
      if (sweep >= Math.PI * 2 - 1e-9) {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>`);
      } else {
        const x1 = cx + radius * Math.cos(angle);
        const y1 = cy + radius * Math.sin(angle);
        const x2 = cx + radius * Math.cos(angle + sweep);
        const y2 = cy + radius * Math.sin(angle + sweep);
        parts.push(
          `<path d="M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`
        );
      }
      angle += sweep;
    });
  }
  spec.labels.forEach((label, index) => {
    const y = 80 + index * 22;
    if (y > HEIGHT - 20) return;
    const share = total > 0 ? Math.round((values[index] / total) * 1000) / 10 : 0;
    parts.push(
      `<rect x="360" y="${y - 10}" width="12" height="12" rx="2" fill="${CHART_COLORS[index % CHART_COLORS.length]}"/>`,
      `<text x="380" y="${y}" font-size="13" fill="${AXIS}">${escapeXml(truncate(label, 24))} — ${escapeXml(formatNumber(values[index], spec.unit))} (${share}%)</text>`
    );
  });
  return parts.join('');
};

const cartesian = (spec: ChartSpec): string => {
  const left = 56;
  const right = WIDTH - 20;
  const top = spec.title ? 46 : 22;
  const bottom = HEIGHT - 64;
  const all = spec.series.flatMap((entry) => entry.data);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const yOf = (value: number): number => bottom - ((value - lo) / (hi - lo || 1)) * (bottom - top);
  const count = spec.labels.length;
  const slot = (right - left) / count;
  const xCentre = (index: number): number => left + slot * index + slot / 2;
  const parts: string[] = [];

  for (const tick of ticks) {
    const y = yOf(tick).toFixed(1);
    parts.push(
      `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${tick === 0 ? AXIS : GRID}" stroke-width="1"/>`,
      `<text x="${left - 8}" y="${Number(y) + 4}" text-anchor="end" font-size="11" fill="${AXIS}">${escapeXml(formatNumber(tick, spec.unit))}</text>`
    );
  }

  const every = Math.max(1, Math.ceil(count / 10));
  spec.labels.forEach((label, index) => {
    if (index % every !== 0) return;
    parts.push(
      `<text x="${xCentre(index).toFixed(1)}" y="${bottom + 16}" text-anchor="middle" font-size="11" fill="${AXIS}">${escapeXml(truncate(label, 12))}</text>`
    );
  });

  if (spec.type === 'bar') {
    const group = slot * 0.74;
    const barWidth = group / spec.series.length;
    spec.series.forEach((entry, s) => {
      entry.data.forEach((value, index) => {
        const x = xCentre(index) - group / 2 + s * barWidth;
        const y = Math.min(yOf(value), yOf(0));
        const h = Math.abs(yOf(value) - yOf(0));
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, barWidth - 2).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="2" fill="${CHART_COLORS[s % CHART_COLORS.length]}"><title>${escapeXml(entry.name)}, ${escapeXml(spec.labels[index])}: ${escapeXml(formatNumber(value, spec.unit))}</title></rect>`
        );
      });
    });
  } else {
    spec.series.forEach((entry, s) => {
      const color = CHART_COLORS[s % CHART_COLORS.length];
      const points = entry.data.map((value, index) => `${xCentre(index).toFixed(1)},${yOf(value).toFixed(1)}`);
      if (spec.type === 'area') {
        parts.push(
          `<polygon points="${xCentre(0).toFixed(1)},${yOf(0).toFixed(1)} ${points.join(' ')} ${xCentre(count - 1).toFixed(1)},${yOf(0).toFixed(1)}" fill="${color}" fill-opacity="0.18"/>`
        );
      }
      parts.push(
        `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
      );
      entry.data.forEach((value, index) => {
        parts.push(
          `<circle cx="${xCentre(index).toFixed(1)}" cy="${yOf(value).toFixed(1)}" r="3.4" fill="${color}"><title>${escapeXml(entry.name)}, ${escapeXml(spec.labels[index])}: ${escapeXml(formatNumber(value, spec.unit))}</title></circle>`
        );
      });
    });
  }
  parts.push(legend(spec.series, HEIGHT - 16));
  return parts.join('');
};

/** The complete SVG document for a chart, self-contained so it can be saved or dropped into a report. */
export const buildChartSvg = (spec: ChartSpec): string => {
  const title = spec.title
    ? `<text x="${WIDTH / 2}" y="26" text-anchor="middle" font-size="15" font-weight="600" fill="${AXIS}">${escapeXml(spec.title)}</text>`
    : '';
  const summary = `${spec.title ?? 'Biểu đồ'}: ${spec.series.map((entry) => entry.name).join(', ')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" aria-label="${escapeXml(summary)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"><title>${escapeXml(summary)}</title>${title}${spec.type === 'pie' ? pie(spec) : cartesian(spec)}</svg>`;
};
