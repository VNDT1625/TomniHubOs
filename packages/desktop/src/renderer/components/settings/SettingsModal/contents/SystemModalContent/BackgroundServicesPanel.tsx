import { ipcBridge } from '@/common';
import type { BackgroundSleepMetrics } from '@/common/types/platform/backgroundSleep';
import { Button, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PreferenceRow from './PreferenceRow';

type BackgroundStatus = {
  webui: boolean | null;
  mcp: boolean | null;
  notifications: boolean | null;
  metrics: BackgroundSleepMetrics | null;
};

/**
 * This panel reuses existing WebUI/MCP lifecycle settings; it never launches
 * an internet-facing listener or reveals a freshly minted WebUI password.
 * The switches here have real providers, not inert "keep running" flags.
 */
const BackgroundServicesPanel: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BackgroundStatus>({
    webui: null,
    mcp: null,
    notifications: null,
    metrics: null,
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [webui, gateway, notifications, metrics] = await Promise.allSettled([
      ipcBridge.webui.getStatus.invoke(),
      ipcBridge.omniGateway.getStatus.invoke(),
      ipcBridge.systemSettings.getNotificationEnabled.invoke(),
      ipcBridge.systemSettings.getBackgroundSleepMetrics.invoke(),
    ]);
    setStatus((previous) => ({
      webui: webui.status === 'fulfilled' ? webui.value.running : previous.webui,
      mcp: gateway.status === 'fulfilled' ? gateway.value.running : previous.mcp,
      notifications: notifications.status === 'fulfilled' ? notifications.value : previous.notifications,
      metrics: metrics.status === 'fulfilled' ? metrics.value : previous.metrics,
    }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeNotifications = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    try {
      await ipcBridge.systemSettings.setNotificationEnabled.invoke({ enabled });
      setStatus((prev) => ({ ...prev, notifications: enabled }));
    } finally {
      setBusy(false);
    }
  };

  const navigate = (route: string): void => {
    window.location.hash = route;
  };
  const m = status.metrics;
  const amount = m?.savedWorkingSetMB;
  const saved = amount === null || amount === undefined
    ? t('settings.backgroundSleep.notMeasured')
    : `${amount >= 0 ? '-' : '+'}${Math.abs(amount)} MB (${m?.savedWorkingSetPercent ?? 0}%)`;

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px space-y-12px' data-testid='background-services-panel'>
      <div className='flex items-center justify-between'>
        <div className='text-16px text-t-primary font-600'>{t('settings.backgroundSleep.title')}</div>
        <Button size='mini' onClick={() => void refresh()}>{t('settings.backgroundSleep.refresh')}</Button>
      </div>
      <div className='text-12px text-t-tertiary'>{t('settings.backgroundSleep.explainer')}</div>
      <div className='divide-y divide-border-2'>
        <PreferenceRow label={t('settings.backgroundSleep.agents')} description={t('settings.backgroundSleep.agentsDesc')}>
          <span className='text-12px text-t-secondary'>{t('settings.backgroundSleep.automatic')}</span>
        </PreferenceRow>
        <PreferenceRow label={t('settings.backgroundSleep.mcp')} description={t('settings.backgroundSleep.mcpDesc')}>
          <Button size='mini' onClick={() => navigate('/settings/capabilities')}>
            {status.mcp === null ? t('settings.backgroundSleep.unknown') : status.mcp ? t('settings.backgroundSleep.running') : t('settings.backgroundSleep.configure')}
          </Button>
        </PreferenceRow>
        <PreferenceRow label={t('settings.backgroundSleep.webui')} description={t('settings.backgroundSleep.webuiDesc')}>
          <Button size='mini' onClick={() => navigate('/settings/webui')}>
            {status.webui === null ? t('settings.backgroundSleep.unknown') : status.webui ? t('settings.backgroundSleep.running') : t('settings.backgroundSleep.configure')}
          </Button>
        </PreferenceRow>
        <PreferenceRow label={t('settings.backgroundSleep.notifications')} description={t('settings.backgroundSleep.notificationsDesc')}>
          <Switch data-testid='background-notifications' disabled={busy || status.notifications === null} checked={status.notifications === true} onChange={(enabled) => { void changeNotifications(enabled).catch((): void => { void refresh(); }); }} />
        </PreferenceRow>
        <PreferenceRow label={t('settings.backgroundSleep.scheduler')} description={t('settings.backgroundSleep.schedulerDesc')}>
          <span className='text-12px text-t-secondary'>{t('settings.backgroundSleep.automatic')}</span>
        </PreferenceRow>
      </div>
      <div className='border-t border-border-2 pt-12px space-y-4px'>
        <div className='text-13px text-t-primary font-600'>{t('settings.backgroundSleep.metricsTitle')}</div>
                <div className='text-12px text-t-secondary' data-testid='background-saved-mb'>
          {t('settings.backgroundSleep.ramChange')}: {saved}
        </div>
        <div className='text-12px text-t-secondary' data-testid='background-cpu-change'>
          {t('settings.backgroundSleep.cpuChange')}: {m?.before && m?.after
            ? `${m.before.cpuPercent}% → ${m.after.cpuPercent}%`
            : t('settings.backgroundSleep.notMeasured')}
        </div>
        <div className='text-12px text-t-tertiary'>
          {t('settings.backgroundSleep.currentRam')}: {m ? `${m.current.workingSetMB} MB` : t('settings.backgroundSleep.notMeasured')}
        </div>
        <div className='text-12px text-t-tertiary'>{t('settings.backgroundSleep.metricsDisclaimer')}</div>
      </div>
    </div>
  );
};

export default BackgroundServicesPanel;
