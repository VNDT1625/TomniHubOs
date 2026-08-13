# @tomni/account-kit

Standalone product-account implementation for Tomny. This package is intentionally **not integrated**
with the desktop app, renderer router, main process, backend, database, WebUI authentication, billing,
or production cloud services.

## What is implemented

- Registration, email verification, sign-in, sign-out, lockout, password reset, and password change.
- Profile editing, sessions, devices, security activity, organization membership, plans, credits,
  sync preferences, data export, and account deletion.
- Vietnamese and English dictionaries through a package-local i18n provider.
- A browser-only mock account client with isolated `localStorage` persistence.
- A standalone Vite playground and unit tests.

## Isolation guarantees

The package has no import from `packages/desktop`, adds no desktop route or menu entry, does not touch
the Tomny database, and sends no network request. Its storage namespace is
`tomni-account-kit.prototype.v1`.

## Run the isolated playground

```bash
bun --cwd packages/tomni-account-kit dev
```

Open `http://localhost:4318`.

## Verify

```bash
bun --cwd packages/tomni-account-kit typecheck
bun --cwd packages/tomni-account-kit test
bun --cwd packages/tomni-account-kit build
```

## Future integration seam

Create a production implementation of `AccountClientContract`, then mount `AccountPrototypeApp`
inside the intended Tomny route. Do not reuse the mock password hashing or mock verification codes in
production.
