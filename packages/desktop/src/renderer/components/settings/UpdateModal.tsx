/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Message, Progress } from '@arco-design/web-react';
import { CheckOne, CloseOne, Download, Install, Refresh } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { AutoUpdateStatus } from '@/common/update/updateTypes';
import TomnyModal from '@/renderer/components/base/TomnyModal';
import MarkdownView from '@/renderer/components/Markdown';
import { useTranslation } from 'react-i18next';

type UpdateStatus = 'checking' | 'upToDate' | 'available' | 'downloading' | 'downloaded' | 'error';
type NativeUpdateInfo = { version: string; releaseNotes?: string };

const formatSpeed = (bytesPerSecond: number) =>
  bytesPerSecond > 1024 * 1024
    ? `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
    : `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;

const formatSize = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

const UpdateModal: React.FC = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [currentVersion, setCurrentVersion] = useState('');
  const [updateInfo, setUpdateInfo] = useState<NativeUpdateInfo | null>(null);
  const [progress, setProgress] = useState({ percent: 0, speed: '', total: 0, transferred: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  const resetState = () => {
    setStatus('checking');
    setCurrentVersion('');
    setUpdateInfo(null);
    setProgress({ percent: 0, speed: '', total: 0, transferred: 0 });
    setErrorMsg('');
  };

  const checkForUpdates = async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const includePrerelease = localStorage.getItem('update.includePrerelease') === 'true';
      const result = await ipcBridge.autoUpdate.check.invoke({ includePrerelease });
      if (!result?.success || !result.data) {
        throw new Error(result?.msg || t('update.checkFailed'));
      }

      setCurrentVersion(result.data.currentVersion);
      if (result.data.updateInfo) {
        setUpdateInfo({
          version: result.data.updateInfo.version,
          releaseNotes: result.data.updateInfo.releaseNotes,
        });
        setStatus('available');
        return;
      }

      setUpdateInfo(null);
      setStatus('upToDate');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Signed update check failed:', error);
      setErrorMsg(message);
      setStatus('error');
    }
  };

  const startDownload = async () => {
    if (!updateInfo) return;
    setStatus('downloading');
    try {
      const result = await ipcBridge.autoUpdate.download.invoke();
      if (!result?.success) {
        throw new Error(result?.msg || t('update.downloadStartFailed'));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Signed update download failed:', error);
      setErrorMsg(message);
      setStatus('error');
    }
  };

  const quitAndInstall = async () => {
    try {
      await ipcBridge.autoUpdate.quitAndInstall.invoke();
    } catch (error: unknown) {
      Message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenUpdateModal = () => {
    setVisible(true);
    resetState();
    void checkForUpdates();
  };

  useEffect(() => {
    const removeOpenListener = ipcBridge.update.open.on(handleOpenUpdateModal);
    window.addEventListener('tomny-open-update-modal', handleOpenUpdateModal);
    return () => {
      removeOpenListener();
      window.removeEventListener('tomny-open-update-modal', handleOpenUpdateModal);
    };
  }, []);

  useEffect(() => {
    const removeListener = ipcBridge.autoUpdate.status.on((event: AutoUpdateStatus) => {
      switch (event.status) {
        case 'available':
          setUpdateInfo({ version: event.version || '', releaseNotes: event.releaseNotes });
          setStatus('available');
          setVisible(true);
          break;
        case 'not-available':
          setStatus('upToDate');
          break;
        case 'downloading':
          if (event.progress) {
            setProgress({
              percent: Math.round(event.progress.percent),
              speed: formatSpeed(event.progress.bytesPerSecond),
              total: event.progress.total,
              transferred: event.progress.transferred,
            });
          }
          break;
        case 'downloaded':
          setStatus('downloaded');
          break;
        case 'error':
          setErrorMsg(event.error || t('update.downloadFailed'));
          setStatus('error');
          break;
      }
    });
    return removeListener;
  }, [t]);

  const renderContent = () => {
    switch (status) {
      case 'checking':
        return (
          <div className='flex flex-col items-center justify-center py-48px'>
            <div className='w-48px h-48px mb-20px relative'>
              <div className='absolute inset-0 border-3 border-fill-3 rounded-full' />
              <div className='absolute inset-0 border-3 border-primary border-t-transparent rounded-full animate-spin' />
            </div>
            <div className='text-15px text-t-primary font-500'>{t('update.checking')}</div>
          </div>
        );
      case 'upToDate':
        return (
          <div className='flex flex-col items-center justify-center py-48px'>
            <div className='w-56px h-56px bg-[rgb(var(--success-6))]/12 rounded-full flex items-center justify-center mb-20px'>
              <CheckOne theme='filled' size='28' fill='rgb(var(--success-6))' />
            </div>
            <div className='text-16px text-t-primary font-600 mb-8px'>{t('update.upToDateTitle')}</div>
            <div className='text-13px text-t-tertiary'>
              {t('update.currentVersion', { version: currentVersion || '-' })}
            </div>
          </div>
        );
      case 'available':
        return (
          <div className='flex flex-col h-full'>
            <div className='flex items-center justify-between px-24px py-16px border-b border-border-2 bg-fill-1'>
              <div className='flex items-center gap-12px'>
                <div className='w-40px h-40px bg-[rgb(var(--primary-6))]/12 rounded-10px flex items-center justify-center'>
                  <Download size='20' fill='rgb(var(--primary-6))' />
                </div>
                <div>
                  <div className='text-15px font-600 text-t-primary'>{t('update.availableTitle')}</div>
                  <div className='text-12px text-t-tertiary mt-2px'>
                    {currentVersion} →{' '}
                    <span className='text-[rgb(var(--primary-6))] font-500'>{updateInfo?.version}</span>
                  </div>
                </div>
              </div>
              <Button type='primary' size='small' onClick={startDownload} className='!px-16px'>
                {t('update.downloadAndInstall')}
              </Button>
            </div>
            <div className='flex-1 min-h-0 overflow-y-auto px-24px py-16px custom-scrollbar'>
              {updateInfo?.releaseNotes ? (
                <div className='text-13px text-t-secondary leading-relaxed'>
                  <MarkdownView allowHtml>{updateInfo.releaseNotes}</MarkdownView>
                </div>
              ) : (
                <div className='text-13px text-t-tertiary italic'>{t('update.noReleaseNotes')}</div>
              )}
            </div>
          </div>
        );
      case 'downloading':
        return (
          <div className='flex flex-col items-center justify-center py-48px px-32px'>
            <div className='w-56px h-56px bg-[rgb(var(--primary-6))]/12 rounded-full flex items-center justify-center mb-20px'>
              <Download size='24' fill='rgb(var(--primary-6))' className='animate-bounce' />
            </div>
            <div className='text-16px text-t-primary font-600 mb-20px'>{t('update.downloadingTitle')}</div>
            <div className='w-full max-w-320px'>
              <Progress
                percent={progress.percent}
                status='normal'
                showText={false}
                strokeWidth={6}
                className='!mb-12px'
              />
              <div className='flex justify-between text-12px text-t-tertiary'>
                <span>
                  {formatSize(progress.transferred)} / {formatSize(progress.total)}
                </span>
                <span className='text-[rgb(var(--primary-6))] font-500'>{progress.speed}</span>
              </div>
            </div>
          </div>
        );
      case 'downloaded':
        return (
          <div className='flex flex-col items-center justify-center py-48px px-32px'>
            <div className='w-56px h-56px bg-[rgb(var(--success-6))]/12 rounded-full flex items-center justify-center mb-20px'>
              <CheckOne theme='filled' size='28' fill='rgb(var(--success-6))' />
            </div>
            <div className='text-16px text-t-primary font-600 mb-8px'>{t('update.readyToInstall')}</div>
            <div className='mb-24px text-13px text-[rgb(var(--warning-6))] max-w-360px text-center'>
              {t('update.installWarning')}
            </div>
            <Button
              type='primary'
              size='small'
              onClick={quitAndInstall}
              icon={<Install size='14' />}
              className='!px-16px'
            >
              {t('update.installNow')}
            </Button>
          </div>
        );
      case 'error':
        return (
          <div className='flex flex-col items-center justify-center py-48px px-32px'>
            <div className='w-56px h-56px bg-[rgb(var(--danger-6))]/12 rounded-full flex items-center justify-center mb-20px'>
              <CloseOne theme='filled' size='28' fill='rgb(var(--danger-6))' />
            </div>
            <div className='text-16px text-t-primary font-600 mb-8px'>{t('update.errorTitle')}</div>
            <div className='text-13px text-t-tertiary mb-24px text-center max-w-360px'>{errorMsg}</div>
            <Button size='small' onClick={checkForUpdates} icon={<Refresh size='14' />} className='!px-16px'>
              {t('common.retry')}
            </Button>
          </div>
        );
    }
  };

  return (
    <TomnyModal
      visible={visible}
      onCancel={() => setVisible(false)}
      size={status === 'available' ? 'medium' : 'small'}
      header={{ title: t('update.modalTitle'), showClose: true }}
      footer={{ render: () => null }}
      contentStyle={{ height: status === 'available' ? '420px' : 'auto', padding: 0, overflow: 'hidden' }}
    >
      <div className='flex flex-col h-full w-full'>{renderContent()}</div>
    </TomnyModal>
  );
};

export default UpdateModal;
