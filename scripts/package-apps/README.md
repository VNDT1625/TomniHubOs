# Tomny Store package publishing

This pipeline publishes signed, account-free-in-app packages to the public Tomny Store catalog.
Consumers do not sign in to browse, download, run, or uninstall a free package. Publishing is an
operator action and uses the GitHub credentials already configured on the release machine.

## Package project layout

```text
my-package/
??? tomny-package.json       # unsigned manifest; artifact fields are generated
??? payload/                 # files installed on the user's device
    ??? index.html
```

A minimal app module uses the sandboxed runtime:

```json
{
  "schemaVersion": 1,
  "id": "com.example.my-app",
  "publisherId": "com.example",
  "name": "My App",
  "description": "What the app does.",
  "type": "app",
  "bundleKind": "single",
  "version": "1.0.0",
  "engines": { "tomni": ">=0.0.0" },
  "modules": [
    {
      "id": "main",
      "title": "My App",
      "surface": "apps/my-app",
      "pinnable": true,
      "runtime": "sandboxed-web",
      "entrypoint": "index.html"
    }
  ],
  "permissions": [],
  "dependencies": [],
  "tags": ["productivity"]
}
```

Third-party packages must use `sandboxed-web`. `trusted-react` is reserved for signed Tomny
first-party code because it executes in the Hub renderer. Manifest `permissions` are currently signed
declarations shown during review; they are not yet per-permission runtime capability isolation. The runtime
boundary and trusted publisher policy remain the enforced controls.

## Build

```bash
bun run store:pack -- examples/sample-notes-package --key /secure/operator/store.private.pem --key-id approved-store-key-id
```

The builder validates the manifest and entrypoints, hashes every payload file, signs the manifest
with Ed25519, and emits a compressed `.tomny` artifact under `store-artifacts/`. Signing is
fail-closed: there is no default production key path. Operators and CI must inject both values via
`--key` / `--key-id`, or `TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH` /
`TOMNI_PACKAGE_SIGNING_KEY_ID`.

The first-party artifact builder follows the same rule:

```bash
TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH=/secure/ci/tomni-store.private.pem \
TOMNI_PACKAGE_TARGETS=com.tomni.document-studio,com.tomni.design-studio \
bun scripts/package-apps/build.ts
```

For `tomni-store-2026-02`, the public key derived from the injected private key must exactly match
the trust anchor committed in `FIRST_PARTY_PACKAGE_TRUSTED_KEYS`; another Ed25519 key is rejected.
For local experiments only, set `TOMNI_PACKAGE_DEV_SIGNING=1`. That mode auto-generates the distinct
`tomni-store-dev-local` key and writes `.dev.tomni-package.json` plus
`first-party-package-metadata.dev.json`; those files do not replace production artifacts or catalog metadata.

## Publish

Authenticate the release machine once with `gh auth login`, then run:

```bash
bun run store:publish -- store-artifacts/com.example.my-app-1.0.0.tomny
```

A normal publish must fetch, parse, and verify the current remote catalog. Network errors, malformed or
untrusted content, and every non-success HTTP status abort before upload. Redirects are followed manually for
at most five hops, and every hop must remain credential-free HTTPS. Use `--bootstrap` only when creating a
catalog for the first time; it accepts an empty starting state only when the configured catalog URL itself
returns HTTP 404, never when a redirect target returns 404. Existing package IDs cannot change publisher,
SemVer-equivalent versions are immutable, and every new version requires a unique artifact URL.

Publishing is authenticated and ownership-bound: the `gh` identity must have repository `write`, `maintain`, or
`admin` permission and must exactly match the configured owner for the manifest's `publisherId`. Set
`TOMNI_STORE_PUBLISHER_OWNERS` to a non-empty JSON object mapping each publisher ID to its GitHub release operator. The
account-free Store catalog is public-only; `TOMNI_STORE_VISIBILITY=private` fails before any upload so private bytes
can never be routed into the public catalog.

The publisher verifies the ZIP payload and signature, then uses a random staging asset on the `tomni-store-v1`
GitHub Release. It verifies the staging asset's server-reported SHA-256 and size, uploads an immutable final asset
without `--clobber`, re-fetches the catalog to reject stale writes, and uploads `catalog.json` last. The catalog is
therefore the only public discovery point for a release. On a known failed commit, final and staging assets are
deleted in reverse order. If a catalog request has an ambiguous result, the final artifact is deliberately retained
until an operator verifies the signed catalog, preventing a visible catalog from pointing at deleted bytes.

The publisher first acquires the fixed `tomni-store-publish.lock.json` Release asset without `--clobber`, so
GitHub's unique asset name is the atomic cross-process lock. The lock is deleted on success and handled failure.
If the process is forcibly killed, confirm that no publisher is active before removing the stale lock manually:

```bash
gh release delete-asset tomni-store-v1 tomni-store-publish.lock.json --repo owner/repository --yes
```

```text
TOMNI_STORE_REPOSITORY=owner/repository
TOMNI_STORE_RELEASE_TAG=tomni-store-v1
TOMNI_STORE_CATALOG_URL=https://custom.example/catalog.json
TOMNI_STORE_PUBLISHER_OWNERS=<JSON publisher-to-GitHub-login map>
TOMNI_STORE_VISIBILITY=public
```

## Consumer lifecycle

1. Tomny fetches `catalog.json` at startup or when **Refresh** is pressed.
2. A valid remote catalog is cached for offline browsing; a failed fetch falls back to cache.
3. **Download** fetches the `.tomny` artifact and verifies its Store signature and SHA-256 payload.
4. The package is installed atomically under the user's `tomny-packages/packages` directory.
5. **Open** loads the installed entrypoint. The Store artifact is not required while offline.
6. **Remove** deactivates the app, removes the installed artifact, and returns it to available state.

See `examples/sample-notes-package` for a complete package that exercises this lifecycle.
