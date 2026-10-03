import type { ModelPackBaseBinding, ModelPackRegistryRecord } from '../../catalog/modelPackTypes';
import {
  LocalInferenceBroker,
  type CoreModelOutputValidator,
  type CoreModelFallbacks,
  type LocalInferenceProvider,
  type ModelRegistryReader,
} from './localInferenceBroker';
import type { CoreModelPurpose } from '../../catalog/modelPackTypes';

/** Constructs the Main-owned broker from explicit verified runtime dependencies. */
export type LocalInferenceBootstrapOptions = Readonly<{
  registry: ModelRegistryReader;
  provider: LocalInferenceProvider;
  validator: CoreModelOutputValidator;
  baseBinding: ModelPackBaseBinding;
  fallbacks?: CoreModelFallbacks;
}>;

export const createProductionLocalInferenceBroker = (options: LocalInferenceBootstrapOptions): LocalInferenceBroker =>
  new LocalInferenceBroker(options.registry, options.provider, options.validator, options.fallbacks, {
    baseBinding: options.baseBinding,
  });

export const isPromotedActiveRecord = (
  record: ModelPackRegistryRecord | undefined
): record is ModelPackRegistryRecord => Boolean(record && record.status === 'active' && record.promotionReceipts);

/** Admission check used by startup before exposing any local model service. */
export const hasPromotedAdapterSet = async (
  registry: ModelRegistryReader,
  purposes: readonly CoreModelPurpose[] = ['security', 'user-understanding', 'semantic-analysis']
): Promise<boolean> => {
  const records = await Promise.all(purposes.map((purpose) => registry.getActive(purpose)));
  return records.every(isPromotedActiveRecord);
};
