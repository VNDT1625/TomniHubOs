/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { buildChartSvg, formatNumber, parseChartSpec } from './chartSvg';
import PanZoomFrame from './PanZoomFrame';

const slug = (value: string | undefined): string =>
  (value ?? 'bieu-do')
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 48) || 'bieu-do';

/**
 * A fenced `chart` block: bar, line, area or pie charts drawn from JSON, with zoom, pan, an SVG download and a
 * table of the numbers for anyone who cannot read the picture.
 */
const ChartBlock: React.FC<{ source: string }> = ({ source }) => {
  const parsed = useMemo(() => parseChartSpec(source), [source]);

  if (parsed.ok === false) {
    return (
      <div
        data-testid='chart-error'
        style={{ border: '1px solid var(--bg-3)', borderRadius: 8, padding: 12, margin: '8px 0', fontSize: 13 }}
      >
        <div style={{ fontWeight: 600 }}>Không vẽ được biểu đồ</div>
        <div style={{ opacity: 0.8, margin: '4px 0 8px' }}>{parsed.error}</div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, opacity: 0.7 }}>{source.slice(0, 600)}</pre>
      </div>
    );
  }

  const { spec } = parsed;
  return (
    <div
      data-testid='chart-block'
      style={{ border: '1px solid var(--bg-3)', borderRadius: 8, padding: 10, margin: '8px 0' }}
    >
      <PanZoomFrame
        svgMarkup={buildChartSvg(spec)}
        filename={slug(spec.title)}
        label={spec.title ?? 'Biểu đồ'}
        height={340}
        testId='chart-frame'
      />
      <details style={{ marginTop: 8, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer' }}>Xem bảng số liệu</summary>
        <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr>
              <th style={cell}>&nbsp;</th>
              {spec.series.map((entry) => (
                <th key={entry.name} style={cell}>
                  {entry.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.labels.map((label, row) => (
              <tr key={`${label}-${row}`}>
                <th style={{ ...cell, textAlign: 'left' }}>{label}</th>
                {spec.series.map((entry) => (
                  <td key={entry.name} style={{ ...cell, textAlign: 'right' }}>
                    {formatNumber(entry.data[row], spec.unit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
};

const cell: React.CSSProperties = { border: '1px solid var(--bg-3)', padding: '3px 8px' };

export default ChartBlock;
