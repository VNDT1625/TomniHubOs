import type { MarketMetric } from './types';
/** Empty prices mean no Main-approved market data; never fabricate quotes. */
export const getMarketMetrics = (): MarketMetric[] => [
  { symbol: 'ES=F', label: 'S&P Futures', sparkline: [] },
  { symbol: 'NQ=F', label: 'NASDAQ Futures', sparkline: [] },
  { symbol: 'BTC-USD', label: 'Bitcoin', sparkline: [] },
  { symbol: '^VIX', label: 'VIX', sparkline: [] },
];
