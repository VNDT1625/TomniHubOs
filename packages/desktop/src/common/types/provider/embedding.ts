/** Provider-neutral batch embedding contract shared by Core and optional packages. */
export type Embedder = {
  providerId: string;
  model: string;
  embed: (texts: readonly string[], signal?: AbortSignal) => Promise<number[][]>;
};
