import semver from 'semver';
import type { PackageCatalogEntry } from '../../packages/desktop/src/common/packages/index.js';

export type PublishCatalogDocument = {
  packages: readonly PackageCatalogEntry[];
};

type PublishCatalogParser<T extends PublishCatalogDocument> = (value: unknown) => T;

type LoadPublishCatalogOptions<T extends PublishCatalogDocument> = {
  url: string;
  bootstrap: boolean;
  parse: PublishCatalogParser<T>;
  fetcher?: typeof fetch;
};

const MAX_CATALOG_REDIRECTS = 5;
const CATALOG_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const parseCatalogUrl = (value: string | URL): URL => {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Publishing aborted because the current Store catalog URL must use credential-free HTTPS.');
  }
  return url;
};

/**
 * Read the authoritative signed catalog. An exact bootstrap 404 is the only
 * state represented by undefined, so callers cannot overwrite an unavailable
 * or redirected catalog with a local approximation.
 */
export const loadPublishCatalogDocument = async <T extends PublishCatalogDocument>({
  url,
  bootstrap,
  parse,
  fetcher = fetch,
}: LoadPublishCatalogOptions<T>): Promise<T | undefined> => {
  let catalogUrl = parseCatalogUrl(url);
  let response: Response;
  let redirectCount = 0;
  while (true) {
    try {
      response = await fetcher(catalogUrl, { cache: 'no-store', redirect: 'manual' });
    } catch (error) {
      throw new Error('Publishing aborted because the current Store catalog could not be reached.', { cause: error });
    }
    if (!CATALOG_REDIRECT_STATUSES.has(response.status)) break;
    if (redirectCount >= MAX_CATALOG_REDIRECTS) {
      throw new Error('Publishing aborted because the current Store catalog exceeded the redirect limit.');
    }
    const location = response.headers.get('location');
    if (!location) throw new Error('Publishing aborted because the current Store catalog redirect has no location.');
    catalogUrl = parseCatalogUrl(new URL(location, catalogUrl));
    redirectCount += 1;
  }

  if (response.status === 404 && bootstrap && redirectCount === 0) return undefined;
  if (response.status === 404 && bootstrap) {
    throw new Error(
      'Publishing aborted because a redirected Store catalog returned HTTP 404; bootstrap requires an exact authoritative 404.'
    );
  }
  if (!response.ok) {
    throw new Error(`Publishing aborted because the current Store catalog returned HTTP ${response.status}.`);
  }

  try {
    return parse(await response.json());
  } catch (error) {
    throw new Error('Publishing aborted because the current Store catalog is invalid or untrusted.', { cause: error });
  }
};

/** Load only verified package entries for callers that do not need catalog revision metadata. */
export const loadPublishCatalog = async <T extends PublishCatalogDocument>(
  options: LoadPublishCatalogOptions<T>
): Promise<PackageCatalogEntry[]> => {
  const document = await loadPublishCatalogDocument(options);
  return document ? [...document.packages] : [];
};

/** Merge one verified release while preserving unrelated catalog entries and immutable versions. */
export const mergePublishCatalog = (
  packages: readonly PackageCatalogEntry[],
  catalogEntry: PackageCatalogEntry
): PackageCatalogEntry[] => {
  const artifactUrl = catalogEntry.artifactUrl ? new URL(catalogEntry.artifactUrl).toString() : undefined;
  const artifactUrlOwner = packages.find(
    (entry) =>
      entry.manifest.id !== catalogEntry.manifest.id &&
      entry.artifactUrl !== undefined &&
      new URL(entry.artifactUrl).toString() === artifactUrl
  );
  if (artifactUrlOwner) {
    throw new Error(
      `Artifact URL ${catalogEntry.artifactUrl} already belongs to ${artifactUrlOwner.manifest.id}; use a unique artifact filename.`
    );
  }

  const existing = packages.find((entry) => entry.manifest.id === catalogEntry.manifest.id);
  if (existing && existing.manifest.publisherId !== catalogEntry.manifest.publisherId) {
    throw new Error(`Package ${catalogEntry.manifest.id} cannot be transferred to another publisher.`);
  }
  if (existing && semver.gt(existing.manifest.version, catalogEntry.manifest.version)) {
    throw new Error(`Refusing to replace ${existing.manifest.id}@${existing.manifest.version} with an older version.`);
  }
  const sameVersion = existing !== undefined && semver.eq(existing.manifest.version, catalogEntry.manifest.version);
  if (
    sameVersion &&
    (existing.manifest.artifact?.integrity !== catalogEntry.manifest.artifact?.integrity ||
      existing.manifest.artifact?.signature.value !== catalogEntry.manifest.artifact?.signature.value)
  ) {
    throw new Error(
      `Version ${catalogEntry.manifest.id}@${catalogEntry.manifest.version} is immutable; bump the version before publishing new bytes.`
    );
  }
  if (
    existing &&
    !sameVersion &&
    existing.artifactUrl !== undefined &&
    new URL(existing.artifactUrl).toString() === artifactUrl
  ) {
    throw new Error('A new package version requires a unique artifact filename.');
  }

  return [...packages.filter((entry) => entry.manifest.id !== catalogEntry.manifest.id), catalogEntry].toSorted(
    (left, right) => left.manifest.name.localeCompare(right.manifest.name)
  );
};
