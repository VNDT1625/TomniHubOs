/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types and limits of the userscript converter (docs/platform/repotopackage-design.md section 12.4, task
 * T4.4). A userscript becomes a generated Manifest V3 extension: the converter only reads text and returns text. It
 * never runs the script, never touches the network and never reads a file; every size below is a hard cap because
 * the input is untrusted.
 */

export const USERSCRIPT_LIMITS = {
  /** The whole `.user.js`, in characters. */
  MAX_SOURCE_CHARS: 1_048_576,
  /** The header must start and end within this many characters of the file. */
  HEADER_SCAN_CHARS: 65_536,
  MAX_HEADER_LINES: 500,
  /** One header line; a longer line is refused (never truncated: a cut pattern would change what it matches). */
  MAX_LINE_CHARS: 2_000,
  MAX_MATCHES: 100,
  MAX_EXCLUDES: 100,
  MAX_GRANTS: 50,
  MAX_CONNECTS: 50,
  MAX_REQUIRES: 20,
  MAX_RESOURCES: 50,
  /** All local `@require` files together, in characters. */
  MAX_REQUIRE_CHARS: 4_194_304,
  /** Everything the converter returns, in characters. */
  MAX_OUTPUT_CHARS: 8_388_608,
} as const;

export type UserscriptFailureCode =
  | 'too-large'
  | 'no-header'
  | 'bad-header'
  | 'too-many'
  | 'no-match'
  | 'unsupported-exclude'
  /** `@require` or `@resource` points at the network; v1 never downloads it. */
  | 'network-require'
  | 'bad-require'
  | 'missing-require'
  | 'invalid-manifest';

/** The script cannot become an extension. `reason` is written for the person who reads the approval. */
export type UserscriptFailure = Readonly<{
  ok: false;
  code: UserscriptFailureCode;
  reason: string;
  /** The header key at fault, for example `@require`. */
  directive?: string;
  /** The offending value, cut to 200 characters for display only. */
  value?: string;
}>;

export type UserscriptNoteCode =
  | 'grant-unsupported'
  | 'match-dropped'
  | 'run-at-unsupported'
  | 'connect-unsupported'
  | 'xhr-needs-connect'
  | 'resource-ignored'
  | 'icon-ignored'
  | 'broad-match';

/** Something the converter could not carry over (or that deserves attention) without refusing the script. */
export type UserscriptNote = Readonly<{ code: UserscriptNoteCode; message: string }>;

export type GeneratedFile = Readonly<{
  /** Relative, `/`-separated path inside the extension folder. */
  path: string;
  content: string;
}>;

export const failure = (
  code: UserscriptFailureCode,
  reason: string,
  extra?: Readonly<{ directive?: string; value?: string }>
): UserscriptFailure => ({
  ok: false,
  code,
  reason,
  ...(extra?.directive === undefined ? {} : { directive: extra.directive }),
  ...(extra?.value === undefined ? {} : { value: extra.value.slice(0, 200) }),
});
