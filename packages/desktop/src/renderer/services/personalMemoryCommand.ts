/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import {
  parseMemoryCommand,
  runMemoryCommand,
  type MemoryCommandApi,
  type MemoryCommandResult,
} from '@/common/chat/slash/memoryCommand';
// The shared instance the app's i18n setup initialises; importing that setup module here would pull it into
// every component that offers these commands.
import i18n from 'i18next';

const personalMemoryApi: MemoryCommandApi = {
  get: () => ipcBridge.personal.get.invoke(),
  save: (profile) => ipcBridge.personal.save.invoke({ profile }),
  forgetLearning: (recordId) => ipcBridge.personal.forgetLearning.invoke({ recordId }),
};

const report = (result: MemoryCommandResult): void => {
  if (result.kind === 'empty') {
    Message.info(
      i18n.t(
        result.command === 'remember' ? 'messages.memoryCommand.emptyRemember' : 'messages.memoryCommand.emptyForget'
      )
    );
  } else if (result.kind === 'remembered') {
    Message.success(
      i18n.t(result.duplicate ? 'messages.memoryCommand.duplicate' : 'messages.memoryCommand.remembered')
    );
  } else if (result.count === 0) {
    Message.info(i18n.t('messages.memoryCommand.nothingForgotten'));
  } else {
    Message.success(i18n.t('messages.memoryCommand.forgotten', { count: result.count }));
  }
};

/**
 * Handles `/remember ...` and `/forget ...` typed in a message box by editing the Personal Context directly.
 * Returns true when the input was one of them, so the caller must not send it as a message.
 */
export const handlePersonalMemoryCommand = (input: string, api: MemoryCommandApi = personalMemoryApi): boolean => {
  const command = parseMemoryCommand(input);
  if (!command) return false;
  void runMemoryCommand(command, api)
    .then(report)
    .catch(() => Message.error(i18n.t('messages.memoryCommand.failed')));
  return true;
};
