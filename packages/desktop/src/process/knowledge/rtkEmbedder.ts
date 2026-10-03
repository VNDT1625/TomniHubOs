/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Embedder resolution for Realtime Knowledge.
 *
 * Remote embedding is disabled in this module. The only authority shape retained
 * here is Main-only, secret-free admission metadata; it cannot resolve a
 * credential or execute a transport. Therefore it must not re-enable direct
 * egress. Realtime Knowledge always falls back to a deterministic LOCAL hashing
 * embedder so semantic lookup still works offline.
 * The fallback is a bag-of-words term-frequency hash —
 * crude, but adequate for the small, curated set of volatile facts and zero-cost.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import type { Embedder } from './realtime/rtkVectorIndex';

/** Dimensionality of the local hashing fallback embedder. */
const HASHING_DIMENSIONS = 256;

/** Metadata only: embedding text and provider credentials never cross this boundary. */
export type GovernedEmbeddingRequest = Readonly<{
  providerId: string;
  model: string;
  destination: string;
  textCount: number;
  textBytes: number;
}>;

/**
 * Main-owned admission seam for a possible future remote embedding operation.
 *
 * This contract deliberately carries metadata only. It neither exposes a
 * provider credential nor supplies a network executor, so an allow decision
 * cannot authorize this module to perform direct network I/O. Enabling remote
 * embedding requires a separate shared Trust transport with an opaque,
 * destination-bound secret lease and durable receipt evidence.
 */
export type GovernedEmbeddingAuthority = Readonly<{
  authorizeEmbedding(request: GovernedEmbeddingRequest): Promise<boolean>;
}>;

export type CreateProviderEmbedderOptions = Readonly<{
  authority?: GovernedEmbeddingAuthority;
}>;

/** Tokenise text into lowercase word tokens. */
const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** FNV-1a 32-bit hash → bucket index. */
const bucket = (token: string, dimensions: number): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % dimensions;
};

/**
 * A deterministic, local, network-free embedder. Maps each text to a
 * term-frequency vector over hashed buckets. Used when no embedding model is
 * configured so lookup never hard-fails.
 */
export const createHashingEmbedder = (dimensions: number = HASHING_DIMENSIONS): Embedder => ({
  providerId: 'local-hashing',
  model: `hashing-v1-${dimensions}`,
  embed: (texts) =>
    Promise.resolve(
      texts.map((text) => {
        const vector = Array.from({ length: dimensions }, () => 0);
        for (const token of tokenize(text)) {
          vector[bucket(token, dimensions)] += 1;
        }
        return vector;
      })
    ),
});

/**
 * Remote embedding remains unavailable until its shared Trust transport exists.
 * This intentionally does not inspect even an injected admission authority:
 * observing an allow alone must never cause provider inventory, credential
 * resolution, text serialization, or a direct fetch.
 */
export const createProviderEmbedder = async (_options: CreateProviderEmbedderOptions = {}): Promise<Embedder | null> =>
  null;

/** Resolve the best available embedder: governed provider model or local hashing. */
export const resolveRtkEmbedder = async (options?: CreateProviderEmbedderOptions): Promise<Embedder> => {
  try {
    const provider = await createProviderEmbedder(options);
    if (provider) return provider;
  } catch {
    // fall through to the local fallback
  }
  return createHashingEmbedder();
};
