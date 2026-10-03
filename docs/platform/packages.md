# Package ABI and optional application extraction

**Status:** CURRENT manifest and installer foundations; PARTIAL package capability seams; PARTIAL physical base separation and production registration.

The package platform is how TomniHubOS grows without turning the trusted base into a permanently installed suite. Installation is not merely a navigation toggle. Package code, routes, assets, translations, bridges, binaries, and data ownership must be physically separate from the base artifact.

Commercial fees, payouts, developer programs, sponsorship, and ranking are defined only in [Store commerce](store-commerce.md). Payment never changes package trust or isolation.

## Release checkpoint boundary

The **Core plus Store candidate** requires the signed pilot, four-state capability resolver, one remote zero-install descriptor, one brokered package-to-package call, one private workflow or Super Package fixture, and clean-base proof for every optional package. Browser and IDE remain default base surfaces. Catalog, free publishing/install, technical package lifecycle, and ordinary Store commerce do not depend on Tomni Credit or Tomni-managed cloud.

A package or Super Package step that explicitly selects managed AI or managed cloud uses those separately gated billing contracts. Failure of managed usage disables only that step or target; it does not disable catalog browsing, free packages, ordinary paid Store entitlement, local execution, or an already valid package installation.

## Current contract

packages/desktop/src/common/packages/types.ts defines manifest schema version 1 with:

- package types app, ui, and agent-capsule;
- single or suite bundle kind;
- package, publisher, engine, version, dependency, permission, tag, and artifact metadata;
- Ed25519 artifact signature metadata;
- module runtimes sandboxed-web and trusted-react;
- app and IDE-oriented contribution version 1;
- lifecycle and trust states;
- filesystem, network, and IPC sandbox policy types.

The package manager provides substantial download, verification, transaction, restore, catalog, quarantine, and contribution-registry behavior.

### Package taxonomy and operational archetypes

The complete canonical taxonomy, classification rules, and least-privilege matrix for Store packages and Repo-to-Package compilation are detailed in [Package taxonomy](package-taxonomy.md). It establishes:

- **Separation of prompt presets from executable packages**: Plain text prompts and persona profiles are persisted as lightweight JSON/Markdown presets, never wrapped in .tomny archives.
- **UI packages**: Theme, skin, and shell layout customizers targeting CSS variables, UnoCSS semantic tokens, and system dashboard widgets.
- **Workflow capsules**: Deterministic-first pipelines following an n8n-style architecture (80% deterministic code nodes for zero-token operations + 20% AI on-demand nodes for creative/reasoning tasks), available as Instant Run or Parametric Wizard flows.
- **Chat stage packages**: Dynamic pipeline stages for pre_query,
  retrieve, pre_model, and post_model execution (e.g., Context7, Laya).
- **Web surface apps, IDE document viewers, and service daemons**: Clear sandboxing boundaries (sandboxed-web vs admin-approved supervised-process).

## Source extraction evidence (2026-09-06)

**CURRENT, dirty development snapshot:** IDE, Design and Document Studio implementation now lives under `packages/package-apps/ide/src`, `packages/package-apps/design/src` and `packages/package-apps/document-studio/src`. Build entries, main/renderer aliases and tests point to these roots. Optional collaboration services, renderer helpers and mount support live under `packages/package-apps/shared`; the provider-neutral embedding type is a Core contract. IDE no longer imports Document Studio implementation. The newly built development artifacts have disjoint app source closures.

**CURRENT, local integration:** `tests/unit/package-manager/firstPartyAppArtifacts.test.ts` builds all three apps with a temporary development signing identity and proves absence, verified installation, asset access, manager restart, disable/enable and uninstall against an empty temporary data root. This does not prove interactive UI use, native IDE runtime activation, or AI access. The emitted production base graphs are checked against both legacy and relocated optional roots by `optionalOwnership.test.ts`.

**CURRENT, signed-artifact compatibility:** An enabled app package with a verified installed manifest may project a missing Apps Library contribution only from its own declared `sandboxed-web` module. Explicit app contributions remain authoritative, and UI or `trusted-react` modules receive no fallback. This keeps the historical signed Calculator artifact on the same identity, trust, review, and runtime-validation seam rather than trusting renderer or catalog metadata.

**CURRENT, legacy root cleanup:** The disconnected `music-daw/` prototype and `musicdaw/` standalone app have been removed. Their active shared engine successor is `packages/music-core`; this only removes duplicate source roots. Music remains **PARTIAL** until its UI and process services are shipped exclusively as an installable package rather than through the base desktop artifact.

### Priority extraction inventory

These domains are **PARTIAL**: their renderer bundles build under package roots, but no signed production catalog artifact or clean-machine lifecycle proof exists.

Browser is CURRENT as a default, always-on base surface. Its renderer remains under packages/package-apps/browser/src/renderer/browser while the Main runtime, bridge, and MCP host live under packages/desktop/src/process/browser. Electron bootstrap starts it directly; Browser is absent from Store and has no install, disable, or uninstall lifecycle.

- **Company** — **PARTIAL**: its renderer is under packages/package-apps/company/src/renderer/company, builds as com.tomni.company, and Core routes only to /apps/com.tomni.company/company. Main still registers company.\*, and Hub automation/agent paths consume it.

- **Knowledge** — **PARTIAL**: its renderer is under packages/package-apps/knowledge/src/renderer/knowledge, builds as com.tomni.knowledge, and Core routes only to /apps/com.tomni.knowledge/knowledge. Main still registers the knowledge bridge/MCP and other base services consume the realtime store.
- **Pet** — **PARTIAL**: its controls renderer is under packages/package-apps/pet/src/renderer/PetPage.tsx, builds as com.tomni.pet, and Settings routes only to /apps/com.tomni.pet/pet. The Main lifecycle admits its native window manager only while that exact package is installed and enabled; disabling, uninstalling, or bridge disposal destroys all Pet windows and handlers. `systemSettings` now calls the fixed host and fails closed while Pet is inactive. The native Pet implementation and overlay assets still remain in the desktop artifact.
- **IDE and Terminal** — **CURRENT**: IDE is a default, always-on base surface, absent from Store and unavailable for disable or uninstall. Terminal is an IDE-integrated dock capability; Electron bootstrap starts its Main runtime and stops schedules and child processes at shutdown. There is no standalone Terminal app, Store artifact, or route.
- **Testing** — **CURRENT**: Testing has no standalone app, route, renderer page, or MCP host. Shared Quick Test engines remain available to Browser and IDE capabilities.
  Each needs its own package artifact, contribution identity, package-owned route, capability contract, install/disable/uninstall lifecycle proof, and an emitted-base graph absence check. Moving files or redirecting a route alone is insufficient.

**PARTIAL:** Current production-signed Design and Document artifacts and catalog manifests now match the extracted source closure at this snapshot. This is still not a release candidate: other optional domains and legacy consumers remain in desktop source, shared host imports and locales have not all become a separately published package SDK, and a real clean-machine desktop/UI and AI lifecycle remains required; installation tests do not satisfy it.

## Current blockers

**PARTIAL:** Legacy optional bridge consumers remain in source outside the emitted base closure. The fresh base graph excludes the extracted apps; full runtime absence still needs the clean-machine desktop harness.

**PARTIAL:** Other optional renderer implementations remain in desktop source. The three extracted app roots are now audited explicitly in emitted base graphs; hidden routes alone remain insufficient evidence.

**BLOCKED:** Some package entrypoints reference source still compiled with the base, so a separate package artifact can remain coupled to base output.

**PARTIAL (C5A0):** VIU canvas, client, presentation runtime, authoring, and asset renderer sources are owned by packages/package-apps/design/src/renderer/viu. IdeWorkspace and Team preview no longer render or import VIU; an IDE package forwards only the existing Design package callback, which cannot install Design or carry a Team snapshot. The committed Store artifact must be rebuilt to prove the new closure. The renderer now calls only the fixed preloaded `designViu.*` ABI, never an `ide.viu.*` provider. Legacy display contracts now live in `packages/desktop/src/common/viu/legacyDisplay.ts`; they are JSON-safe and exclude Main-only filesystem provenance. `packages/package-apps/design/src/process/viu/types.ts` explicitly adapts that contract for legacy Main internals. `registerViuBridge` has no current bootstrap caller, and base IDE MCP registers no `viu_*` tool.

**PARTIAL (C5 fixed Design lifecycle):** manifest schema v1 permits only the inert, signed `design-viu-v1` Main contribution for `com.tomni.design-studio`, and the Design build definition emits its exact `{ schemaVersion, id }` declaration before the existing canonical manifest-signing flow. Paths, argv, environment, code, module names, and generic loaders are not expressible. A Main-only manager re-reads the verified installed listing and admits only an enabled, nonrevoked, reviewed, signed-first-party Design artifact whose exact installed manifest declares `design-viu-v1`; identity, artifact integrity, review, denial, and cancellation evidence remain Main-owned. Disable, revocation, uninstall, state mismatch, and bridge disposal cancel the active service. The fixed V1 ABI has ten named `designViu.*` operations only; it derives the trusted top-level sender, online account and current Design contribution in Main, hashes the renderer workspace key into an account/sender-scoped session key, validates renderer transactions against the exact bounded command schema, and rechecks cancellation before returning. It never returns a loopback URL, port, token, generic MCP method, package ID or account identity. `inspect`, `preview`, `commit`, `validate`, and secret-free asset listing are currently admitted; raw path, browser-network, persistence, image and asset-grant requests remain explicit `DESIGN_VIU_OPERATION_DENIED` until a user-granted handle and relevant egress/persistence authority exist. The separate fixed loopback `tomni-design-viu` MCP host exists only while the service is admitted; it is not a renderer transport or global catalog entry. The checked-in Design artifact and catalog manifest predate this definition and are deliberately not hand-edited: they cannot prove the new declaration until the approved production pipeline rebuilds the artifact and publishes the matching Store-root-signed catalog entry atomically.

**PARTIAL:** Version 1 exposes the narrow `host.runtime.info` syscall through a main-process lease, invocation receipt, and cancellation path. A tiny sandboxed pilot can be built as a signed `.tomny` artifact and has a developer-signed install, update, restart, disable, enable, rollback, and uninstall test. Broader native capabilities and production release signing remain incomplete.

**CURRENT (package workspace route):** Store is limited to discovery, installation, update, permission, and package-management views. An enabled package Surface opens through the Hub-owned `#/apps/:packageId/:moduleId` workspace, which retains the Hub navigation and header but gives the package the full content area. The legacy `#/store/app/...` path only resolves compatibility and redirects; it no longer renders a package inside the Store view.

**CURRENT (remote development delivery):** Development installs use the signed remote artifact URL from the verified Store catalog, then verify and extract it into the Electron `userData/tomny-packages` root. `TOMNI_STORE_LOCAL_ARTIFACTS=1` admits only local Company, Knowledge, and Pet fixtures from `store-artifacts/first-party-package-metadata.dev.json`; non-admitted metadata is ignored before manifest parsing. The development key is accepted for the protected `com.tomni` namespace only inside that opt-in, unpackaged local process; it is never a production key or cloud-delivery trust anchor. Browser and IDE are excluded because they are default base surfaces. The fixture lifecycle has fresh-profile integration proof for all three admitted default packages: build, signed-manifest admission, install, asset read, manager restart/reconcile, disable, enable, uninstall, and package-root cleanup pass in tests/unit/package-manager/firstPartyAppArtifacts.test.ts. Current production Design/Document artifacts are signed and catalog-bound; external catalog publication and clean-machine packaged release remain required.

**BLOCKED:** trusted-react loads code into a privileged renderer context. It cannot be the default for community code.

**PARTIAL:** Windows sandbox admission and lifecycle components exist, but cross-platform isolated execution and release proof are incomplete.

## Package identity and trust

Every installed package has:

- globally stable package and publisher identifiers;
- semantic version and minimum/maximum host ABI range;
- content digest and artifact size;
- signature algorithm, signing key, and trust chain;
- catalog source and retrieval time;
- declared runtime and entrypoints;
- dependencies with version ranges;
- requested capabilities and activation triggers;
- data-retention and uninstall declarations;
- update, rollback, and revocation metadata.

The installed identity is bound to every contribution, capability request, process, storage namespace, audit event, and receipt.

Trust classes:

- **base** - reviewed platform code shipped in the main artifact;
- **signed first-party package** - independent artifact, eligible for narrowly approved privileged runtime;
- **signed Store package** - isolated runtime with mediated syscalls;
- **local developer package** - explicit developer mode, visible warning, isolated by default;
- **revoked or invalid** - cannot activate; active leases are cancelled and the package is quarantined.

A signature proves artifact origin, not safe behavior. Capability and sandbox policy still apply.

`signed first-party package` is additionally bound to the exact key pinned for the protected `com.tomni.*` namespace in the main process. A valid generic Store signature, catalog label, or modified durable rollback record can at most be treated as `signed-store`; it never grants first-party trust or activates a protected namespace. Every retained rollback manifest is re-verified against its own artifact digest and this pinned keyring before activation.

## Target Package ABI

The ABI has two planes.

The list below is the complete target surface. MVP implements only the syscalls required by the signed pilot, extracted IDE, remote descriptor, package-call, semantic-theme, and Super Package fixtures, but every operation those fixtures use must cross the versioned broker. An unimplemented syscall fails closed; no fixture can bypass the ABI to preserve scope.

### Declarative contribution plane

A manifest can contribute:

- application route and navigation metadata;
- commands and settings schemas;
- agents, skills, workflows, prompts, and tool descriptions;
- provider or model adapter descriptors;
- MCP servers and tools;
- file viewers, editors, importers, exporters, or preview handlers;
- background jobs and activation triggers;
- remote zero-install capability descriptors;
- semantic theme tokens and compatible UI component descriptors;
- translations, icons, themes, and package-owned assets.

Contributions are data until activated. The base renderer resolves them through a registry and never imports a package page statically.

### Capability syscall plane

A running package communicates with the main process through versioned requests for:

- namespaced storage;
- workspace file read, write, watch, and transaction;
- network fetch to declared origins;
- secret-handle use at declared destinations;
- subprocess or isolated worker execution;
- AI target invocation through the Run Kernel;
- another installed or remote package capability through brokered caller/callee identity and narrowed grants;
- MCP registration and calls;
- notifications, clipboard, dialog, and external-open;
- route, preview, and artifact interaction;
- resource lease, progress, cancellation, and evidence.

Every syscall includes package identity, run identity when applicable, capability grant, schema version, timeout, cancellation token, and resource budget. The broker validates scope and returns stable errors.

No package receives a generic main IPC bridge, unrestricted Node.js, arbitrary Electron APIs, or the ability to import core process modules.

## Runtime classes

### Sandboxed web

Default for community UI. It runs without Node.js integration, uses an isolated origin, strict content security policy, bounded storage, and a capability-message bridge. Navigation, popup, download, clipboard, camera, microphone, and network behavior are denied unless declared and approved.

### Isolated worker or native helper

Used for CLIs, local models, compilers, or high-performance tools. It runs in a supervised process or platform sandbox with a verified executable, environment allowlist, filesystem roots, network origins, resource leases, output limits, process-tree cleanup, and revocation.

### Trusted React

Reserved for signed first-party packages whose risk has been reviewed. It is an exception, clearly displayed in package trust metadata, and must migrate toward isolation as the package SDK becomes capable.

## Install transaction

For a paid package, the Store commerce owner first issues an opaque AcquisitionGrant bound to the account, product offer, package identity, entitlement, and expiry or offline policy. Package Supervisor validates that grant before acquisition or paid activation, then still applies every technical step below. The grant is not a signature, trust class, CapabilityGrant, or permission approval. A free package has no paid-entitlement requirement but still requires reviewable installation consent and the same technical policy.

1. Resolve catalog and dependency graph without executing package code.
2. Validate HTTPS or approved local source, redirects, DNS, size, and rate limits.
3. Download into a bounded staging area.
4. Verify digest, signature, publisher, schema, engine range, archive entries, and decompressed size.
5. Evaluate revocation, trust class, permissions, runtimes, and conflicts.
6. Extract without path traversal or symlink escape.
7. Validate every entrypoint and contribution.
8. Present capability and data behavior to the user.
9. Commit package files and state atomically.
10. Activate in an isolated runtime, run health checks, and publish registry revision.
11. On any failure, terminate processes, revoke leases, restore the previous version, and record safe diagnostics.

Catalog expiry or offline state never turns an unverified artifact into trusted content.

## Update, disable, revoke, and uninstall

Updates stage beside the active version and switch only after verification and health checks. Rollback retains the last known-good version within a declared storage budget, but restores its historical signed identity only after re-verifying the exact retained manifest, digest, and pinned trust key.

Disable removes contributions and cancels package-owned background work without deleting user data. Revocation additionally blocks activation and quarantines unsafe artifacts.

Uninstall:

- removes registry contributions and routes;
- cancels processes, tasks, capabilities, and resource leases;
- deletes package code and caches;
- applies the declared data-retention choice;
- removes package secrets or transfers only those explicitly owned by the user;
- verifies no orphan bridge, menu, translation, worker, or scheduled job remains.

## Independent application model

Minimum package identities are independent:

- com.tomni.browser;
- independent document, spreadsheet, slide, PDF, email, and other Office-like packages;
- independent Studio-related applications;
- Music, MakeVideo, Terminal, Testing, Monitor, media, design, and other optional domains.

The generated ownership registry, not this illustrative list, is authoritative as new optional domains are added.

### Default packages

**TARGET (product decision 2026-09-07):** Company, Knowledge, and Pet are
default Package Apps. Default means the Store/bootstrap policy may provision
them for a new profile; it never makes their implementation part of Core. A
user can disable or uninstall each one through the same Store lifecycle as any
other Package App. Core must continue without its route, contribution, bridge,
background work, or data owner after disable/uninstall.

**CURRENT (product decision 2026-09-08):** Browser and IDE are default, always-on base surfaces; they are not Store products and cannot be disabled or uninstalled. Terminal is an IDE capability, not an app. News/Realtime and Testing have no standalone surface. Settings owns Hub OS/Core settings only. Company, Knowledge, and Pet remain Store-managed default packages whose legacy links resolve to Store state.

Studio may group these packages in the Store and preserve old deep links through a compatibility resolver. Installing one package must not install or activate the others unless the user approves an explicit dependency.

## Capability discovery, activation, and interoperability

The capability resolver, not the language model, owns the deterministic search across:

1. capabilities already present in the trusted base;
2. installed and enabled local package contributions;
3. signed remote capabilities that need no local executable;
4. compatible Store entries that can be installed with consent.

Each candidate declares package and publisher identity, version, signature and trust state, capability schema, permissions, secret and egress needs, data location, ordinary Store offer or managed-usage price facts when applicable, latency or service level, health, compatibility, and whether it supports UI, local execution, and offline use. Commercial metadata remains separate from technical trust. A result is explicitly `ready-local`, `ready-remote`, `installable`, or `unavailable`; absence is not guessed from model knowledge.

CURRENT: the shared resolver evaluates candidate identity, capability match, trust, compatibility, health, data location, UI, and offline constraints deterministically; it orders the four states as local-ready, remote-ready, installable, then unavailable. It selects only a ready candidate. An installable candidate can produce review metadata only, including the candidate and explicit consent requirements; this pure contract does not install, activate, purchase, mint a grant, or spend Credit.

PARTIAL: the remote-capability catalog validates signed, expiring, credential-free HTTPS descriptors and invokes them only through a caller-owned transport. It can construct a cloud Hub target whose bounded composition crosses Run Kernel, Trust preflight and final egress, cancellation, evidence, and a terminal receipt without artifact download, package-manager, installation, purchase, or grant operation. The target remains unregistered as a production resolver/IPC source, so remote execution is not release-proven.

The Orchestrator can select only a ready candidate that survives TrustBroker, budget, health, and policy filtering. An installable candidate becomes an activation proposal showing why it is needed, what will download, permissions, price, data boundary, alternatives, and uninstall effect. Neither the Orchestrator nor a package can auto-install a dependency, purchase a Store product, mint any grant, or spend Credit.

A package consumes another package through the contribution registry and capability broker, never through a direct implementation import. Each call binds caller and callee identity, Run lineage, purpose, data classification, narrowed grant, resource budget and Credit budget only when managed usage applies, timeout, cancellation, and evidence. PARTIAL: a main-process-only broker seam proves both endpoint leases, exact identity, a `package.call:<callee>:<capability>` child grant, child Run receipt/evidence, cancellation, and lease release. It awaits ABI/IPC registration and therefore is not yet callable by a production package.

A remote capability can be discovered and invoked without downloading executable code to the desktop. Local installation is required only for UI interaction, local execution, or offline use, and always requires explicit consent. A compatible theme package changes semantic tokens rather than acquiring another package's renderer privilege.

A Super Package is a signed, versioned workflow product that can declare package and capability dependencies, local, remote, AI, or cloud steps, user-input checkpoints, deterministic backend steps, budgets, retry, rollback, recovery, prior failure lessons, acceptance tests, and receipt schema. It replays the verified graph without asking a model to rediscover every deterministic step. It uses the same Run, TrustBroker, package, and billing boundaries when a selected step is billable; it is not an execution or accounting bypass. PARTIAL: an integration fixture composes these seams to prove a paid grant, Trust-gated cloud step, checkpointed failure lesson, and deterministic no-reinvoke replay. The legacy workflow engine is not yet the governed production Super Package runner.

## Extraction procedure

For each optional application:

1. inventory every route, component, service, bridge, preload method, process module, worker, asset, translation namespace, dependency, test, and persisted record;
2. define the core contract and capability syscalls it truly needs;
3. move the implementation and package-owned assets to package source;
4. replace base imports with registry lookups and lazy package activation;
5. make bridge registration conditional on an installed, trusted contribution;
6. split translations and dependencies into the package artifact;
7. build base and package independently;
8. verify install, update, disable, uninstall, rollback, and legacy-link behavior;
9. remove compatibility source after migration evidence passes.

Browser and IDE remain default base surfaces. Each optional owner follows the extraction sequence above; Browser lifecycle extraction is not planned because it is base-owned, while Office and Studio-related surfaces are extracted independently, not as one bundle.

## Base-absence proof

The build generates an ownership registry from package manifests, source ownership, route/bridge declarations, translation namespaces, assets, dependencies, workers, binaries, and persisted-data owners. Every owner marked optional becomes a denylist entry for the base graph and artifact.

A package is extracted only when a clean base artifact proves:

- zero core-to-optional implementation imports in both main and renderer graphs;
- no optional entrypoint, chunk, asset, translation, worker, source map, native binary, or database schema in ASAR or resources;
- no eager optional implementation or package-owned bridge import during base bootstrap;
- base webviewTag is false;
- no Browser route, WebContentsView host, service, bridge, asset, translation, worker, or database exists or starts before Browser install;
- no optional route, process, scheduled job, or database appears before its package is installed;
- installation adds the contribution without rebuilding base;
- uninstall and restart leave no orphan;
- ordinary Hub conversation, context recovery, settings, Store, and update remain functional.

The generated registry is evidence input. Graph, artifact, clean-profile, install, and uninstall checks together form proof.

## MVP acceptance gates

- Every operation used by the signed pilot, extracted IDE, remote, package-call, semantic-theme, and Super Package fixtures is mediated by the versioned ABI; unimplemented file, network, secret, process, AI, resource, cancellation, or evidence syscalls fail closed.
- A tiny signed pilot proves the ABI before large application extraction.
- Community packages cannot run through trusted-react.
- Package calls acquire main-process TrustBroker capability and ResourceCoordinator leases.
- The same query returns stable `ready-local`, `ready-remote`, `installable`, or `unavailable` states with recorded inclusion and exclusion reasons.
- One signed remote capability runs without a local executable; requesting UI, local execution, or offline use produces a consented installation proposal instead of silent installation.
- One package-to-package call proves caller and callee identity, narrowed grant, Run lineage, applicable budget, cancellation, stable error, and evidence without a direct implementation import.
- One private workflow or Super Package replays a verified graph with deterministic backend steps, checkpoints, and prior failure lessons without bypassing Run, Trust, package, or applicable billing policy.
- Paid activation requires an authoritative opaque AcquisitionGrant and the identical signature, compatibility, permission, isolation, update, revocation, and uninstall gates used by free packages; the renderer cannot forge the grant.
- Generated ownership denylist reports zero optional implementation in base, including IDE, Browser, Office, Studio, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and future optional owners.
- Main bootstrap does not eagerly import optional implementation or package-owned bridges.
- Base webviewTag is false and no Browser host, route, service, or database exists before install.
- IDE passes independent signed install, use, update, disable, rollback, revoke, and uninstall on a clean machine. Browser and every remaining optional owner are absent and inactive in the MVP base; their complete package lifecycles are P1, Browser first. Legacy optional source may remain outside base ownership and build graphs with zero base imports until its P1 migration.
- Normal conversation and context restart work with all optional packages absent.
- Package rollback restores a prior signed package, never its implementation to base.
- Install failure and revoked update restore prior state without orphan code or grants.
- Uninstall removes routes, processes, leases, scheduled work, owned secrets, and undeclared data.

## Rollback and kill behavior

Catalog, free installation, paid activation, remote capability, and package contribution switches roll back independently. Rollback preserves readable signed installation state, valid entitlements, user-declared retained data, and receipts; it disables the affected contribution or resolver source and never restores optional implementation to the base, generic IPC access, unsigned content, or a revoked artifact.

An unsigned or rolled-back catalog, forged AcquisitionGrant, payment-derived trust, community trusted-react execution, silent install, direct core/package implementation import, confused-deputy package call, remote executable downloaded without consent, lifecycle residue, or optional artifact in the base keeps the affected gate red. Revoke or uninstall must terminate routes, processes, capabilities, resource leases, scheduled work, owned secrets, and undeclared data before the package can be considered inactive.
