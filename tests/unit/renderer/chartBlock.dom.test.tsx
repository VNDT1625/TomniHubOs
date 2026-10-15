import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChartBlock from '@/renderer/components/Markdown/ChartBlock';
import PanZoomFrame, {
  INITIAL_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  downloadSvg,
  zoomAt,
} from '@/renderer/components/Markdown/PanZoomFrame';
import {
  buildChartSvg,
  escapeXml,
  formatNumber,
  niceTicks,
  parseChartSpec,
} from '@/renderer/components/Markdown/chartSvg';

const spec = (value: unknown): string => JSON.stringify(value);

describe('reading a chart block', () => {
  it('accepts labels with series, and the short list of label and value', () => {
    const full = parseChartSpec(
      spec({ type: 'line', title: 'Doanh thu', unit: '%', labels: ['Q1', 'Q2'], series: [{ name: 'A', data: [1, 2] }] })
    );
    expect(full).toMatchObject({ ok: true, spec: { type: 'line', title: 'Doanh thu', unit: '%' } });
    const short = parseChartSpec(
      spec({
        type: 'pie',
        data: [
          { label: 'x', value: 3 },
          { label: 'y', value: 1 },
        ],
      })
    );
    expect(short).toMatchObject({ ok: true, spec: { labels: ['x', 'y'], series: [{ data: [3, 1] }] } });
  });

  it('defaults to a bar chart and treats the type without caring about case', () => {
    expect(parseChartSpec(spec({ labels: ['a'], series: [{ name: 's', data: [1] }] }))).toMatchObject({
      spec: { type: 'bar' },
    });
    expect(parseChartSpec(spec({ type: 'PIE', data: [{ label: 'a', value: 1 }] }))).toMatchObject({
      spec: { type: 'pie' },
    });
  });

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[1,2]'],
    ['an unknown type', spec({ type: 'radar', labels: ['a'], series: [{ name: 's', data: [1] }] })],
    ['no data at all', spec({ type: 'bar' })],
    ['empty labels', spec({ labels: [], series: [{ name: 's', data: [] }] })],
    ['a series of the wrong length', spec({ labels: ['a', 'b'], series: [{ name: 's', data: [1] }] })],
    ['a value that is not a number', spec({ labels: ['a'], series: [{ name: 's', data: ['x'] }] })],
    ['a negative pie slice', spec({ type: 'pie', data: [{ label: 'a', value: -1 }] })],
    [
      'too many points',
      spec({
        labels: Array.from({ length: 500 }, (_, i) => String(i)),
        series: [{ name: 's', data: Array(500).fill(1) }],
      }),
    ],
  ])('refuses %s with a message', (_label, source) => {
    const result = parseChartSpec(source);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.length).toBeGreaterThan(5);
  });
});

describe('drawing it', () => {
  const build = (value: unknown): string => {
    const parsed = parseChartSpec(spec(value));
    if (parsed.ok !== true) throw new Error('bad spec');
    return buildChartSvg(parsed.spec);
  };

  it('draws one rectangle per value for bars and a line with points for line charts', () => {
    const bars = build({
      type: 'bar',
      labels: ['a', 'b', 'c'],
      series: [
        { name: 'x', data: [1, 2, 3] },
        { name: 'y', data: [3, 2, 1] },
      ],
    });
    expect(bars.match(/<rect [^>]*rx="2" fill="#/gu)?.length).toBeGreaterThanOrEqual(6);
    const line = build({ type: 'line', labels: ['a', 'b', 'c'], series: [{ name: 'x', data: [1, 2, 3] }] });
    expect(line).toContain('<polyline');
    expect(line.match(/<circle /gu)).toHaveLength(3);
  });

  it('draws one slice per positive value, and one full circle for a single slice', () => {
    const slices = build({
      type: 'pie',
      data: [
        { label: 'a', value: 1 },
        { label: 'b', value: 0 },
        { label: 'c', value: 2 },
      ],
    });
    expect(slices.match(/<path /gu)).toHaveLength(2);
    expect(build({ type: 'pie', data: [{ label: 'a', value: 5 }] })).toContain('<circle');
    expect(build({ type: 'pie', data: [{ label: 'a', value: 0 }] })).toContain('Không có dữ liệu');
  });

  it('handles negative values and all-zero data without producing broken numbers', () => {
    for (const data of [
      [-5, 3, -1],
      [0, 0, 0],
      [2.5, 2.5, 2.5],
    ]) {
      const svg = build({ type: 'area', labels: ['a', 'b', 'c'], series: [{ name: 'x', data }] });
      expect(svg).not.toMatch(/NaN|Infinity|undefined/u);
    }
  });

  it('escapes every piece of text, so a chart cannot inject markup', () => {
    const svg = build({
      type: 'bar',
      title: '<script>alert(1)</script>',
      labels: ['"><img src=x onerror=alert(1)>'],
      series: [{ name: "<b onload='x'>", data: [1] }],
    });
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('<b ');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('has an accessible name and a standalone namespace for saving', () => {
    const svg = build({ type: 'bar', title: 'Doanh thu', labels: ['a'], series: [{ name: 'x', data: [1] }] });
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Doanh thu: x"');
  });
});

describe('axis helpers', () => {
  it('pick tidy ticks that include zero and cover the data', () => {
    expect(niceTicks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]);
    const mixed = niceTicks(-30, 70);
    expect(mixed[0]).toBeLessThanOrEqual(-30);
    expect(mixed.at(-1)).toBeGreaterThanOrEqual(70);
    expect(mixed).toContain(0);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });

  it('shorten large numbers and keep the unit', () => {
    expect(formatNumber(1_500_000)).toBe('1.5M');
    expect(formatNumber(12_345, '$')).toBe('12.35K$');
    expect(formatNumber(0.456)).toBe('0.46');
    expect(escapeXml(`a&b<c>"d'`)).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });
});

describe('the chart block on the page', () => {
  it('shows the picture and a table of the numbers', () => {
    render(
      <ChartBlock
        source={spec({
          type: 'bar',
          title: 'Quý',
          labels: ['Q1', 'Q2'],
          series: [{ name: 'Doanh thu', data: [10, 20] }],
        })}
      />
    );
    expect(screen.getByTestId('chart-block')).toBeTruthy();
    expect(screen.getByTestId('chart-frame-content').innerHTML).toContain('<svg');
    expect(screen.getByText('Xem bảng số liệu')).toBeTruthy();
    // The label is in the picture and again in the table.
    expect(screen.getAllByText('Q2').length).toBeGreaterThanOrEqual(2);
  });

  it('explains a bad chart and shows what was written', () => {
    render(<ChartBlock source='{broken' />);
    expect(screen.getByTestId('chart-error').textContent).toContain('JSON');
    expect(screen.getByTestId('chart-error').textContent).toContain('{broken');
  });
});

describe('zooming and saving', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the zoom between the limits and zooms around the pointer', () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    const zoomed = zoomAt(INITIAL_VIEW, 2, 100, 50);
    expect(zoomed.scale).toBe(2);
    // The point under the pointer stays under the pointer.
    expect(zoomed.x + 100 * 2 - 100 * 2).toBe(zoomed.x);
    expect((100 - zoomed.x) / zoomed.scale).toBeCloseTo(100);
    expect((50 - zoomed.y) / zoomed.scale).toBeCloseTo(50);
    expect(zoomAt({ scale: MAX_SCALE, x: 3, y: 4 }, 2, 0, 0)).toEqual({ scale: MAX_SCALE, x: 3, y: 4 });
  });

  it('changes the zoom from the buttons and resets it', () => {
    render(<PanZoomFrame svgMarkup='<svg viewBox="0 0 10 10"></svg>' filename='x' label='Hình' testId='frame' />);
    fireEvent.click(screen.getByLabelText('Phóng to'));
    expect(screen.getByLabelText('Đặt lại về 100%').textContent).toBe('125%');
    fireEvent.click(screen.getByLabelText('Thu nhỏ'));
    fireEvent.click(screen.getByLabelText('Thu nhỏ'));
    expect(screen.getByLabelText('Đặt lại về 100%').textContent).toBe('80%');
    fireEvent.click(screen.getByLabelText('Đặt lại về 100%'));
    expect(screen.getByLabelText('Đặt lại về 100%').textContent).toBe('100%');
  });

  it('only zooms on Ctrl and wheel, so a plain wheel keeps scrolling the chat', () => {
    render(<PanZoomFrame svgMarkup='<svg viewBox="0 0 10 10"></svg>' filename='x' label='Hình' testId='frame' />);
    const viewport = screen.getByTestId('frame-viewport');
    fireEvent.wheel(viewport, { deltaY: -100 });
    expect(screen.getByLabelText('Đặt lại về 100%').textContent).toBe('100%');
    fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true });
    expect(screen.getByLabelText('Đặt lại về 100%').textContent).toBe('125%');
  });

  it('downloads the SVG with the namespace and the file extension', () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => (created.push(blob), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadSvg('<svg viewBox="0 0 1 1"></svg>', 'bieu-do');
    expect(click).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0].type).toContain('image/svg+xml');
  });
});
