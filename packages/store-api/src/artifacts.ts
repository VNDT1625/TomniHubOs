export type StoredArtifact = Readonly<{ digest: string; size: number; metadata: Readonly<Record<string, string>> }>;
export type ArtifactObjectStore = Readonly<{
  head: (key: string) => Promise<StoredArtifact | undefined>;
  create: (
    key: string,
    bytes: Uint8Array,
    options: Readonly<{ ifGenerationMatch: 0; metadata: Readonly<Record<string, string>> }>
  ) => Promise<StoredArtifact>;
}>;
export const artifactKey = (digest: string): string => {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('ARTIFACT_DIGEST_INVALID');
  return `sha256/${digest}`;
};
export const putAuthoritativeArtifact = async (
  store: ArtifactObjectStore,
  digest: string,
  bytes: Uint8Array
): Promise<StoredArtifact> => {
  const key = artifactKey(digest);
  const metadata = { sha256: digest };
  const existing = await store.head(key);
  if (existing) {
    if (existing.digest !== digest || existing.size !== bytes.byteLength || existing.metadata.sha256 !== digest)
      throw new Error('ARTIFACT_IMMUTABILITY_CONFLICT');
    return existing;
  }
  return store.create(key, bytes, { ifGenerationMatch: 0, metadata });
};
