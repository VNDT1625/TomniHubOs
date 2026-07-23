import type { IConfigStorageRefer } from '@/common/config/storage';

/**
 * Typed config access derives directly from the persisted storage contract so
 * optionality and newly added keys cannot drift between the two declarations.
 */
export type ConfigKeyMap = { [K in keyof IConfigStorageRefer]-?: IConfigStorageRefer[K] };

export type ConfigKey = keyof ConfigKeyMap;
