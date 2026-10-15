import React from 'react';
import type { RealtimePoint } from '@/common/types/platform/realtimeContent';

type Props = {
  points: readonly RealtimePoint[];
  title: string;
};

/** Draw only timestamps and numbers returned by the governed Main provider. */
export const RealtimeHistoryChart: React.FC<Props> = ({ points, title }) => {
  const numbers = points.map((point) => point.value).filter(Number.isFinite);
  if (numbers.length < 2) return null;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  const spread = high - low || 1;
  const coordinates = points
    .map((point, index) => {
      const x = 24 + (index / (points.length - 1)) * 592;
      const y = 170 - ((point.value - low) / spread) * 140;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <div className='realtime-history-chart'>
      <svg viewBox='0 0 640 200' role='img' aria-label={title} preserveAspectRatio='xMidYMid meet'>
        <line x1='24' y1='170' x2='616' y2='170' stroke='currentColor' strokeOpacity='0.18' />
        <polyline points={coordinates} fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinejoin='round' />
      </svg>
      <div className='realtime-history-legend'>
        <span>{new Date(points[0]!.time).toLocaleDateString()}</span>
        <span>
          {low.toLocaleString()} – {high.toLocaleString()}
        </span>
        <span>{new Date(points[points.length - 1]!.time).toLocaleDateString()}</span>
      </div>
    </div>
  );
};
