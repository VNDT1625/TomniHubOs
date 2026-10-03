/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The **"Super"** control that lives in the conversation header.
 *
 * Turning Super ON permits the Hub to plan governed, consented Surface work for
 * the conversation. It never grants a particular Package App, browser, model, or
 * capability: those decisions stay on the Main-process Run/Trust path.
 *
 * This is deliberately only generic Hub chrome. A Browser, IDE, or any other
 * Package App contributes its own Surface UI after installation; the base chat
 * must not import or control an optional application implementation.
 */

import { isElectronDesktop } from '@/renderer/utils/platform';
import type { TChatConversation } from '@/common/config/storage';
import { Message, Switch, Tooltip } from '@arco-design/web-react';
import { Lightning } from '@icon-park/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSuperMode } from '../hooks/useSuperMode';

/** Props for {@link ConversationSurfaces}. */
export type ConversationSurfacesProps = {
  /** The host conversation (used for the Super toggle target). */
  conversation?: TChatConversation;
};

/**
 * Generic Super policy control mounted in the desktop conversation header.
 */
const ConversationSurfaces: React.FC<ConversationSurfacesProps> = ({ conversation }) => {
  const { t } = useTranslation();
  const conversationId = conversation?.id;
  const sup = useSuperMode(conversationId);
  const handleToggle = useCallback(
    async (next: boolean): Promise<void> => {
      const updated = await sup.toggle(next);
      if (!updated) {
        Message.error(t('workspace.super.toggleError'));
        return;
      }
      Message.success(next ? t('workspace.super.enabled') : t('workspace.super.disabled'));
    },
    [sup, t]
  );

  // Super policy applies only in the Electron desktop Hub.
  if (!isElectronDesktop()) return null;
  if (!sup.available || !conversationId) return null;

  return (
    <Tooltip content={sup.enabled ? t('workspace.super.onHint') : t('workspace.super.offHint')} position='bottom'>
      <span className='flex items-center gap-6px h-28px px-10px rd-8px bg-fill-1'>
        <Lightning theme='outline' size='14' className={sup.enabled ? 'text-primary' : 'text-t-secondary'} />
        <span className='text-12px text-t-secondary whitespace-nowrap'>{t('workspace.super.label')}</span>
        <Switch size='small' checked={sup.enabled} loading={sup.pending} onChange={handleToggle} />
      </span>
    </Tooltip>
  );
};

export default ConversationSurfaces;
