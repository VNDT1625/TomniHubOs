/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser chat is a consumer of the shared Main provider-execution seam. It
 * never receives a provider record, endpoint, or credential: the configured
 * {@link ProviderExecutionBroker} owns selection, Trust grants, opaque secret
 * leases, final-payload inspection, pinned transport, cancellation, and its
 * redacted egress evidence.
 */

import { createProviderChat as createBrokeredProviderChat } from '@process/services/agentChat';
import type { ProviderExecutionBroker } from '@process/services/security/providerExecution/providerExecutionBroker';
import type { AgentChat } from './webAgentRunner';

/**
 * Builds Browser's provider chat from the Main-owned broker. The optional
 * parameter exists solely for Main composition and tests; it is never supplied
 * by Browser IPC or renderer input. Without it, the bootstrap-configured shared
 * broker is required and the request fails closed before provider lookup.
 */
export const createProviderChat = (broker?: ProviderExecutionBroker): AgentChat => createBrokeredProviderChat(broker);
