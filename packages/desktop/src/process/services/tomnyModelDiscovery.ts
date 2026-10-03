/**
 * Model discovery containment pending a shared governed discovery executor.
 *
 * The prior helper accepted arbitrary pre-create credentials and issued a direct
 * request. Model refresh must eventually gain sender/origin, run, destination,
 * opaque-secret lease, final-egress inspection, cancellation, and receipt proof.
 * Until then this module never reads credential or endpoint fields and only
 * returns models already saved with an authenticated Main-owned provider record.
 */
import type { FetchModelsAnonymousRequest, FetchModelsResponse } from '@/common/types/provider/providerApi';
import {
  getProtocolDisplayName,
  getRecommendedPlatform,
  guessProtocolFromKey,
  guessProtocolFromUrl,
  type ProtocolDetectionRequest,
  type ProtocolDetectionResponse,
  type ProtocolType,
} from '@/common/utils/protocolDetector';

/** Retained for the guarded bridge's injection signature; this module never calls it. */
export type ProviderFetch = typeof fetch;

export const PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED = 'PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED';

type SavedProviderModelRequest = FetchModelsAnonymousRequest & Readonly<{ models?: unknown }>;

const configuredModels = (request: SavedProviderModelRequest): string[] => {
  if (!Array.isArray(request.models)) return [];
  return [
    ...new Set(
      request.models
        .filter((model): model is string => typeof model === 'string')
        .map((model) => model.trim())
        .filter((model) => model.length > 0 && model.length <= 2_048)
    ),
  ];
};

/**
 * Returns only cached saved-provider models. Remote model discovery is denied
 * before endpoint or credential access until its own governed Main seam exists.
 */
export const fetchProviderModelList = async (
  request: FetchModelsAnonymousRequest,
  _fetchImpl?: ProviderFetch
): Promise<FetchModelsResponse> => {
  const models = configuredModels(request);
  if (models.length > 0) return { models };
  throw new Error(PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED);
};

/**
 * Protocol verification uses pattern matching over URL and API key format.
 * An explicit preferredProtocol is retained as display-only metadata without network use.
 */
export const detectProviderProtocol = async (
  request: ProtocolDetectionRequest,
  _fetchImpl?: ProviderFetch
): Promise<ProtocolDetectionResponse> => {
  // If a specific preferredProtocol is already asserted and not unknown, preserve display-only metadata
  if (request.preferredProtocol && request.preferredProtocol !== 'unknown') {
    return {
      success: false,
      protocol: request.preferredProtocol,
      confidence: 0,
      error: PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED,
      suggestion: {
        type: 'none',
        message: 'Remote provider verification is unavailable until governed discovery is enabled.',
      },
    };
  }

  let detectedProtocol: ProtocolType = 'unknown';
  let confidence = 0;
  let suggestedPlatform: string | undefined;

  try {
    const urlCandidate =
      typeof request.base_url === 'string'
        ? request.base_url
        : typeof (request as unknown as { endpoint?: unknown }).endpoint === 'string'
          ? (request as unknown as { endpoint: string }).endpoint
          : '';
    if (urlCandidate && urlCandidate.trim()) {
      const guessed = guessProtocolFromUrl(urlCandidate);
      if (guessed) {
        detectedProtocol = guessed;
        confidence = 90;
        suggestedPlatform = getRecommendedPlatform(guessed) ?? undefined;
      }
    }
  } catch {
    // endpoint trap in containment tests
  }

  if (detectedProtocol === 'unknown') {
    try {
      if (typeof request.api_key === 'string' && request.api_key.trim()) {
        const guessedKey = guessProtocolFromKey(request.api_key);
        if (guessedKey) {
          detectedProtocol = guessedKey;
          confidence = 80;
          suggestedPlatform = getRecommendedPlatform(guessedKey) ?? undefined;
        }
      }
    } catch {
      // credential trap in containment tests
    }
  }

  if (detectedProtocol !== 'unknown') {
    return {
      success: true,
      protocol: detectedProtocol,
      confidence,
      suggestion: {
        type: suggestedPlatform ? 'switch_platform' : 'none',
        message: `Đã nhận diện giao thức ${getProtocolDisplayName(detectedProtocol)} qua định dạng địa chỉ.`,
        suggestedPlatform,
        i18nKey: 'settings.protocolDetectedSuccess',
      },
    };
  }

  return {
    success: false,
    protocol: 'unknown',
    confidence: 0,
    error: PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED,
    suggestion: {
      type: 'none',
      message: 'Remote provider verification is unavailable until governed discovery is enabled.',
    },
  };
};
