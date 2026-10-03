/**
 * Narrow Main-only admission seam for the News surface's remote work.
 *
 * This is deliberately only containment while News is migrated to the shared
 * TrustBroker transport. It never supplies an origin, destination, credential,
 * or permissive default: absence and authority errors both deny before a News
 * worker can construct its remote request.
 */
export const NEWS_EGRESS_DENIED = 'NEWS_EGRESS_DENIED';

export type NewsEgressOperation =
  | 'feed-validation'
  | 'github-trending'
  | 'market-data'
  | 'rss-refresh'
  | 'weather'
  | 'bluesky-realtime';

export type NewsEgressRequest = Readonly<{
  operation: NewsEgressOperation;
}>;

export type NewsEgressDecision = Readonly<{
  decision: 'allow' | 'deny';
}>;

export type NewsEgressAuthority = Readonly<{
  authorize(request: NewsEgressRequest): Promise<NewsEgressDecision>;
}>;

/**
 * Require Main-owned admission before a News caller reads an untrusted URL,
 * serializes user input, resolves a provider, or opens remote transport.
 */
export const requireNewsEgressAdmission = async (
  authority: NewsEgressAuthority | undefined,
  operation: NewsEgressOperation
): Promise<void> => {
  if (!authority) throw new Error(NEWS_EGRESS_DENIED);
  try {
    if ((await authority.authorize({ operation })).decision === 'allow') return;
  } catch {
    // Authority failures must not expose policy or transport details to callers.
  }
  throw new Error(NEWS_EGRESS_DENIED);
};
