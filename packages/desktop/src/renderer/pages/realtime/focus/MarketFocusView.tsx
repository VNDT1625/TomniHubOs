import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMarketMetrics } from '../services/marketProvider';
export const MarketFocusView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { t } = useTranslation();
  const [range, setRange] = useState('1D');
  return (
    <main className='realtime-page realtime-focus-page'>
      <button type='button' className='realtime-back' onClick={onBack}>
        ← {t('news.hub.back')}
      </button>
      <h1>{t('news.hub.marketDetail')}</h1>
      <p>{t('news.hub.marketUnavailable')}</p>
      <div className='realtime-timeframes' aria-label={t('news.hub.timeframe')}>
        {['1D', '1W', '1M', '1Y', 'ALL'].map((value) => (
          <button
            type='button'
            key={value}
            aria-pressed={range === value}
            className={range === value ? 'selected' : ''}
            onClick={() => setRange(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className='realtime-chart-empty' role='status'>
        {t('news.market.error')}
      </div>
      <div className='realtime-market-grid realtime-focus-grid'>
        {getMarketMetrics().map((metric) => (
          <div key={metric.symbol} className='realtime-market-cell'>
            <span>{metric.label}</span>
            <strong>{metric.symbol}</strong>
            <small>{t('news.market.error')}</small>
          </div>
        ))}
      </div>
    </main>
  );
};
