import { Image, Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IMessageLiveImageOutput } from '@/common/chat/chatLib';

const STATUS_KEYS = {
  queued: 'messages.liveImage.queued',
  running: 'messages.liveImage.running',
  finalizing: 'messages.liveImage.finalizing',
  failed: 'messages.liveImage.failed',
  cancelled: 'messages.liveImage.cancelled',
} as const;

const STATUS_DEFAULTS = {
  queued: 'Image queued',
  running: 'Creating image',
  finalizing: 'Verifying image',
  failed: 'Image creation failed',
  cancelled: 'Image creation canceled',
} as const;

type ReadLiveImageResult = Readonly<{
  dataUrl: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}> | null;

const MessageLiveImageOutput: React.FC<{ message: IMessageLiveImageOutput }> = ({ message }) => {
  const { t } = useTranslation();
  const output = message.content;
  const [image, setImage] = useState<ReadLiveImageResult>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setUnavailable(false);
    if (output.state !== 'completed' || !output.image || !output.receiptId) return;

    setLoading(true);
    void ipcBridge.conversation.readLiveImageOutput
      .invoke({
        conversation_id: output.conversationId,
        output_id: output.outputId,
        output_ref: output.image.outputRef,
      })
      .then((result) => {
        if (cancelled) return;
        setImage((result as ReadLiveImageResult) ?? null);
        setUnavailable(!result);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [output.conversationId, output.outputId, output.image?.outputRef, output.receiptId, output.revision, output.state]);

  if (output.state !== 'completed') {
    const label = t(STATUS_KEYS[output.state], { defaultValue: STATUS_DEFAULTS[output.state] });
    return (
      <div
        className='tomni-live-image-output tomni-live-image-output--pending'
        data-testid={`live-image-output-${output.state}`}
        role='status'
        aria-live='polite'
      >
        {output.state === 'running' || output.state === 'finalizing' ? <Spin size={16} /> : <span aria-hidden='true'>◌</span>}
        <span>{label}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className='tomni-live-image-output tomni-live-image-output--pending' role='status'>
        <Spin size={16} />
        <span>{t('messages.liveImage.loading', { defaultValue: 'Loading image' })}</span>
      </div>
    );
  }

  if (unavailable || !image) {
    return (
      <div className='tomni-live-image-output tomni-live-image-output--unavailable' role='status'>
        {t('messages.liveImage.unavailable', { defaultValue: 'Image unavailable' })}
      </div>
    );
  }

  return (
    <div className='tomni-live-image-output tomni-live-image-output--completed' data-testid='live-image-output-completed'>
      <Image
        src={image.dataUrl}
        alt={t('messages.liveImage.alt', { defaultValue: 'Generated image' })}
        width={Math.min(image.width, 520)}
        height={Math.min(image.height, 420)}
        preview
      />
    </div>
  );
};

export default MessageLiveImageOutput;
