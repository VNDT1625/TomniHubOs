/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-backed chat for the Company conversation engine.
 *
 * Company is a Main-process caller, but it is not a provider transport. All
 * non-CLI completions are delegated to the account-bound ProviderExecutionBroker
 * configured by Main composition. That broker alone resolves credentials, checks
 * destination authority, obtains the secret lease, records egress evidence and
 * opens the pinned socket. This module never receives a provider key or URL.
 */

import { createProviderChat, isCliModelId, runAgentChatMessages } from '@process/services/agentChat';
import type { ProviderExecutionBroker } from '@process/services/security/providerExecution/providerExecutionBroker';
import { resolveCompanyModelId } from './companyGenerator';
import type { CompanyChat } from './companyConversation';

export type CompanyChatOptions = Readonly<{
  /** Optional only for Main composition/tests; never renderer-provided. */
  providerExecutionBroker?: ProviderExecutionBroker;
  resolveModelId?: () => Promise<string | undefined>;
}>;

/**
 * Builds Company chat from the shared, Main-only provider execution seam. A
 * missing broker deliberately rejects before any provider request can occur.
 */
export const createCompanyChat = (options: CompanyChatOptions = {}): CompanyChat => {
  const resolveModelId = options.resolveModelId ?? resolveCompanyModelId;
  const providerChat = createProviderChat(options.providerExecutionBroker);

  return async ({ model, messages, signal }) => {
    const selectedModel = model ?? (await resolveModelId());
    if (!selectedModel) {
      throw new Error('No usable model is configured. Open Settings → Model and add a provider/model, then try again.');
    }

    return runAgentChatMessages(
      async (providerModel, providerMessages, providerSignal) =>
        providerChat({ model: providerModel, messages: providerMessages, signal: providerSignal }),
      selectedModel,
      messages,
      signal,
      isCliModelId(selectedModel) ? { surface: 'chat', permissionMode: 'workspace-write' } : undefined
    );
  };
};
