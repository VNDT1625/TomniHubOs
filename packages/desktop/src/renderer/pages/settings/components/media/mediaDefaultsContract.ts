import type { ConfigKeyMap } from '@/common/config/configKeys';

export const MEDIA_MODALITIES = ['image', 'video', 'audioGeneration', 'tts', 'stt'] as const;
export type MediaModality = (typeof MEDIA_MODALITIES)[number];
export type MediaDefaults = NonNullable<ConfigKeyMap['ai.mediaModelDefaults']>;
export type MediaReference = NonNullable<MediaDefaults[MediaModality]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 512 &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/u.test(value);

/** Strictly parse persisted references; never carry extra fields (including credentials) forward. */
export function parseMediaDefaults(value: unknown): MediaDefaults {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).some((key) => !MEDIA_MODALITIES.some((item) => item === key))) {
    throw new Error('INVALID_MEDIA_DEFAULTS');
  }
  const result: MediaDefaults = {};
  for (const modality of MEDIA_MODALITIES) {
    const reference = value[modality];
    if (reference === undefined) continue;
    if (
      !isRecord(reference) ||
      Object.keys(reference).some((key) => key !== 'providerId' && key !== 'modelId') ||
      !isIdentifier(reference.providerId) ||
      !isIdentifier(reference.modelId)
    ) {
      throw new Error('INVALID_MEDIA_REFERENCE');
    }
    result[modality] = { providerId: reference.providerId, modelId: reference.modelId };
  }
  return result;
}

/** Tuple encoding keeps identical model names on different providers distinct. */
export const mediaReferenceKey = (reference: MediaReference): string =>
  JSON.stringify([reference.providerId, reference.modelId]);
