/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process role-chart generator for the agent-company model.
 *
 * The generator inspects only provider metadata to select a model. Completion
 * execution is delegated to the shared ProviderExecutionBroker, so provider
 * credentials and endpoints remain isolated from Company and only the broker
 * can make external provider requests.
 */

import type { IProvider } from '@/common/config/storage';
import { createProviderChat } from '@process/services/agentChat';
import type { ProviderExecutionBroker } from '@process/services/security/providerExecution/providerExecutionBroker';
import { getReadyProviderStore } from '@process/services/tomnyProviderBridge';
import type { GenerateFn } from './companyConfig';

/** Timeout for the role-chart design call (ms). Design is a single short turn. */
const GENERATE_TIMEOUT_MS = 120_000;

/** Whether a model id is enabled for a provider (defaults to enabled). */
const isModelEnabled = (provider: IProvider, model: string): boolean => provider.model_enabled?.[model] !== false;

/**
 * Pick a displayed model using non-secret provider metadata. The execution
 * broker independently re-resolves the provider from its Main-owned store and
 * rejects if it has no current credential or destination authority.
 */
const pickCompanyModel = (providers: readonly IProvider[]): string | undefined => {
  const enabled = providers.filter((provider) => provider.enabled !== false && Array.isArray(provider.models));

  for (const provider of enabled) {
    const healthy = provider.models.find(
      (model) => isModelEnabled(provider, model) && provider.model_health?.[model]?.status === 'healthy'
    );
    if (healthy) return healthy;
  }

  for (const provider of enabled) {
    const model = provider.models.find((candidate) => isModelEnabled(provider, candidate));
    if (model) return model;
  }

  return undefined;
};

/**
 * Resolve the id of the model that would power this company's agents, or
 * `undefined` when none is configured. This value is display/model metadata;
 * Company never reads the credential or endpoint fields.
 */
export const resolveCompanyModelId = async (): Promise<string | undefined> => {
  const providers = await (await getReadyProviderStore()).list();
  return pickCompanyModel(providers);
};

export type CompanyGeneratorOptions = Readonly<{
  /** Optional only for Main composition/tests; never renderer-provided. */
  providerExecutionBroker?: ProviderExecutionBroker;
  resolveModelId?: () => Promise<string | undefined>;
  timeoutMs?: number;
}>;

/**
 * Build a role-chart generator backed by the shared Main provider execution
 * seam. A missing broker fails closed before network egress or secret access.
 */
export const createCompanyGenerator = (options: CompanyGeneratorOptions = {}): GenerateFn => {
  const resolveModelId = options.resolveModelId ?? resolveCompanyModelId;
  const timeoutMs = options.timeoutMs ?? GENERATE_TIMEOUT_MS;
  const providerChat = createProviderChat(options.providerExecutionBroker);

  return async (prompt: string): Promise<string> => {
    const model = await resolveModelId();
    if (!model) {
      throw new Error('No usable model is configured. Open Settings → Model and add a provider/model, then try again.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const content = await providerChat({
        model,
        messages: [{ role: 'user', content: prompt }],
        signal: controller.signal,
      });
      if (content.trim().length === 0) {
        throw new Error('The model returned an empty response while designing the company.');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
};
