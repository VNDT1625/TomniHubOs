import React, { useCallback, useEffect, useState } from 'react';
import classNames from 'classnames';
import { Popover } from '@arco-design/web-react';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import {
  fetchTomProfile,
  isSupabaseConfigured,
  subscribeToTomBalanceRealtime,
  type TomProfile,
} from '@/renderer/services/supabaseAuth';
import TomWalletModal from './TomWalletModal';
import './TomBalanceWidget.css';

export const TomCoinIcon: React.FC<{ size?: number; className?: string }> = ({ size = 15, className }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
    aria-hidden='true'
  >
    <circle cx='12' cy='12' r='10' fill='url(#tom-coin-gradient)' stroke='#D97706' strokeWidth='1.5' />
    <circle cx='12' cy='12' r='8' stroke='rgba(255, 255, 255, 0.45)' strokeWidth='1' strokeDasharray='2 2' />
    <path
      d='M8 8H16M12 8V16M10.5 16H13.5'
      stroke='#78350F'
      strokeWidth='2.2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <defs>
      <linearGradient id='tom-coin-gradient' x1='4' y1='4' x2='20' y2='20' gradientUnits='userSpaceOnUse'>
        <stop stopColor='#FCD34D' />
        <stop offset='0.5' stopColor='#F59E0B' />
        <stop offset='1' stopColor='#D97706' />
      </linearGradient>
    </defs>
  </svg>
);

const formatBalanceDisplay = (val: number): string => {
  if (val === undefined || val === null || isNaN(val)) return '0.00';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
};

export const TomBalanceWidget: React.FC = () => {
  const { user, ready } = useAuth();
  const [profile, setProfile] = useState<TomProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [walletModalVisible, setWalletModalVisible] = useState(false);

  const isMountedRef = React.useRef(true);
  const activeAbortRef = React.useRef<AbortController | null>(null);

  const supabaseActive = isSupabaseConfigured();

  const loadBalance = useCallback(
    async (isBackground = false) => {
      if (!user?.id || !supabaseActive) {
        if (isMountedRef.current) setLoading(false);
        return;
      }

      if (!isBackground && isMountedRef.current) {
        setLoading(true);
      }

      activeAbortRef.current?.abort();
      const controller = new AbortController();
      activeAbortRef.current = controller;

      try {
        const data = await fetchTomProfile(user.id, undefined, {
          signal: controller.signal,
          timeoutMs: 5000,
        });
        if (isMountedRef.current) {
          if (data) {
            setProfile(data);
            setLoadError(null);
          } else {
            setLoadError('profile_unavailable');
          }
        }
      } catch (err) {
        if (isMountedRef.current && (err as Error)?.name !== 'AbortError') {
          setLoadError((err as Error)?.message || 'network_error');
        }
      } finally {
        if (isMountedRef.current && !isBackground) {
          setLoading(false);
        }
      }
    },
    [user?.id, supabaseActive]
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (!ready || !user?.id || !supabaseActive) {
      setLoading(false);
      return undefined;
    }

    void loadBalance(false);

    // Subscribe to realtime changes from Supabase
    const unsubscribe = subscribeToTomBalanceRealtime(user.id, (updated) => {
      if (!isMountedRef.current) return;
      setIsRealtimeConnected(true);
      setProfile((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          ...updated,
          balance_tom: updated.balance_tom !== undefined ? updated.balance_tom : prev.balance_tom,
        };
      });
    });

    // Window focus refresh & internal event bus listener
    const handleFocus = (): void => {
      void loadBalance(true);
    };
    const handleCustomRefresh = (): void => {
      void loadBalance(false);
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('tomni:balance:refresh', handleCustomRefresh);

    const intervalId = setInterval(() => {
      void loadBalance(true);
    }, 20000);

    return () => {
      isMountedRef.current = false;
      activeAbortRef.current?.abort();
      unsubscribe();
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('tomni:balance:refresh', handleCustomRefresh);
      clearInterval(intervalId);
    };
  }, [loadBalance, ready, supabaseActive, user?.id]);

  const currentBalance = profile?.balance_tom ?? (supabaseActive ? 5.0 : 10.0);
  const currentCurrency = profile?.currency ?? 'TOM';
  const tier = profile?.tier ?? 'free';
  const companyName = profile?.company_name;

  const popoverContent = (
    <div className='tom-balance-popover'>
      <div className='tom-balance-popover__title'>
        <TomCoinIcon size={16} />
        <span>Tomni Balance & Identity</span>
      </div>
      <div className='tom-balance-popover__row'>
        <span className='tom-balance-popover__label'>Số dư khả dụng:</span>
        <span className='tom-balance-popover__value'>
          {formatBalanceDisplay(currentBalance)} {currentCurrency}
        </span>
      </div>
      <div className='tom-balance-popover__row'>
        <span className='tom-balance-popover__label'>Tương đương:</span>
        <span className='tom-balance-popover__value'>${formatBalanceDisplay(currentBalance)} USD</span>
      </div>
      <div className='tom-balance-popover__row'>
        <span className='tom-balance-popover__label'>Cấp tài khoản:</span>
        <span
          className={classNames('tom-balance-popover__badge', {
            'tom-balance-popover__badge--pro': tier === 'pro',
            'tom-balance-popover__badge--enterprise': tier === 'enterprise',
          })}
        >
          {tier}
        </span>
      </div>
      {companyName && (
        <div className='tom-balance-popover__row'>
          <span className='tom-balance-popover__label'>Doanh nghiệp:</span>
          <span className='tom-balance-popover__value'>{companyName}</span>
        </div>
      )}
      <div className='tom-balance-popover__footer'>
        <span className='tom-balance-popover__dot' />
        <span>
          {loading
            ? 'Đang tải số dư...'
            : loadError
              ? 'Chưa thể kết nối đám mây (Click để mở Ví)'
              : supabaseActive
                ? isRealtimeConnected
                  ? 'Realtime Supabase Active (Click để mở Ví)'
                  : 'Supabase Cloud Connected (Click để mở Ví)'
                : 'Local First Mode (Click để mở Ví)'}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <Popover content={popoverContent} position='bottom' trigger='hover'>
        <div
          className={classNames('tom-balance-widget', { 'tom-balance-widget__loading': loading })}
          role='button'
          tabIndex={0}
          onClick={() => setWalletModalVisible(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setWalletModalVisible(true);
            }
          }}
          title='Bấm để xem Ví TOM & Lịch sử Giao dịch'
        >
          <div className='tom-balance-widget__inner'>
            {/* [ hiện có ] */}
            <div className='tom-balance-widget__value'>{formatBalanceDisplay(currentBalance)}</div>
            {/* [ icon Tom ] */}
            <div className='tom-balance-widget__currency'>
              <TomCoinIcon size={14} className='tom-balance-widget__icon' />
              <span className='tom-balance-widget__symbol'>{currentCurrency}</span>
            </div>
          </div>
        </div>
      </Popover>

      <TomWalletModal
        visible={walletModalVisible}
        onClose={() => {
          setWalletModalVisible(false);
          void loadBalance();
        }}
      />
    </>
  );
};

export default TomBalanceWidget;
