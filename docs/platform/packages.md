# Store, package ABI, and optional application extraction

**Status:** CURRENT manifest and installer foundations; TARGET capability ABI and physical base separation.

The package platform is how TomniHubOS grows without turning the trusted base into a permanently installed suite. Installation is not merely a navigation toggle. Package code, routes, assets, translations, bridges, binaries, and data ownership must be physically separate from the base artifact.

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

## Current blockers

**BLOCKED:** Main bootstrap and bridge registration eagerly import optional package implementations or package-owned bridges. The package manager itself is a valid base service, but it must discover and activate optional contributions lazily.

**BLOCKED:** Core renderer routes and services still statically import IDE and Browser implementation. A catalog entry or hidden route does not establish extraction.

**BLOCKED:** Some package entrypoints reference source still compiled with the base, so a separate package artifact can remain coupled to base output.

**PARTIAL:** Version 1 exposes the narrow `host.runtime.info` syscall through a main-process lease, invocation receipt, and cancellation path. A tiny sandboxed pilot can be built as a signed `.tomny` artifact and has a developer-signed install, update, restart, disable, enable, rollback, and uninstall test. Broader native capabilities and production release signing remain incomplete.

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

## Target Package ABI

The ABI has two planes.

### Declarative contribution plane

A manifest can contribute:

- application route and navigation metadata;
- commands and settings schemas;
- agents, skills, workflows, prompts, and tool descriptions;
- provider or model adapter descriptors;
- MCP servers and tools;
- file viewers, editors, importers, exporters, or preview handlers;
- background jobs and activation triggers;
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

Updates stage beside the active version and switch only after verification and health checks. Rollback retains the last known-good version within a declared storage budget.

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

- com.tomni.ide;
- com.tomni.browser;
- independent document, spreadsheet, slide, PDF, email, and other Office-like packages;
- independent Studio-related applications;
- Music, MakeVideo, Terminal, Testing, Monitor, media, design, and other optional domains.

The generated ownership registry, not this illustrative list, is authoritative as new optional domains are added.

Studio may group these packages in the Store and preserve old deep links through a compatibility resolver. Installing one package must not install or activate the others unless the user approves an explicit dependency.

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

IDE is the first extraction proof because it is large and currently entangled with context and recovery. Browser follows because it owns native views and main-process services. Office and Studio-related surfaces are then extracted independently, not as one bundle.

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

- A versioned native capability ABI mediates file, network, secret, process, AI, resource, cancellation, and evidence operations.
- A tiny signed pilot proves the ABI before large application extraction.
- Community packages cannot run through trusted-react.
- Package calls acquire main-process TrustBroker capability and ResourceCoordinator leases.
- Generated ownership denylist reports zero optional implementation in base, including IDE, Browser, Office, Studio, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and future optional owners.
- Main bootstrap does not eagerly import optional implementation or package-owned bridges.
- Base webviewTag is false and no Browser host, route, service, or database exists before install.
- IDE passes independent signed install, use, update, disable, uninstall, and rollback on a clean machine. Browser and every remaining optional owner are absent and inactive in the MVP base; their complete package lifecycles are P1, Browser first. Legacy optional source may remain outside base ownership and build graphs with zero base imports until its P1 migration.
- Normal conversation and context restart work with all optional packages absent.
- Package rollback restores a prior signed package, never its implementation to base.
- Install failure and revoked update restore prior state without orphan code or grants.
- Uninstall removes routes, processes, leases, scheduled work, owned secrets, and undeclared data.
