/**
 * Placeholder expansion and permission-mode mapping for hook commands (design section 11.2 and 11.4).
 */

/** Values substituted into hook command strings. Missing values leave the placeholder untouched. */
export type PlaceholderContext = {
  pluginRoot?: string;
  pluginData?: string;
  projectDir?: string;
};

/** Permission modes sent to hooks, using Claude Code's vocabulary. */
export type HookPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/**
 * Tomny-side permission mode names accepted by {@link mapPermissionMode}.
 * Declared locally because common/ must not import from process/. Keep in sync with
 * `ExperimentalPermissionMode` (process/experimentalCore/experimentalCoreProtocol.ts) and
 * the agent mode names in common/types/agent/agentModes.ts.
 */
export type TomnyPermissionMode =
  | 'read-only'
  | 'workspace-write'
  | 'full-access'
  | 'default'
  | 'autoEdit'
  | 'yolo'
  | 'plan'
  | 'acceptEdits'
  | 'bypassPermissions';

const PLACEHOLDER_PATTERN = /\$\{(?:CLAUDE|TOMNY)_(PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR)\}/g;

/** Backslashes become `/` and trailing separators are dropped (drive roots such as `C:/` and `/` are kept). */
const normalizePathValue = (value: string): string => {
  const slashed = value.replace(/\\/g, '/');
  if (slashed.length > 1 && slashed.endsWith('/') && !/^[A-Za-z]:\/$/.test(slashed)) {
    return slashed.replace(/\/+$/, '') || '/';
  }
  return slashed;
};

/**
 * Replaces `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` and their `TOMNY_*`
 * twins in one pass. Substituted values are normalized to forward slashes and are never rescanned,
 * so a value containing `${...}` cannot expand further. Unknown variables and variables without a
 * value are left as written.
 */
export const expandPlaceholders = (text: string, context: PlaceholderContext): string =>
  text.replace(PLACEHOLDER_PATTERN, (whole: string, name: string) => {
    const raw =
      name === 'PLUGIN_ROOT' ? context.pluginRoot : name === 'PLUGIN_DATA' ? context.pluginData : context.projectDir;
    return raw === undefined || raw === '' ? whole : normalizePathValue(raw);
  });

/** Expands every element of an args list. */
export const expandPlaceholdersInArgs = (args: readonly string[], context: PlaceholderContext): string[] =>
  args.map((arg) => expandPlaceholders(arg, context));

/**
 * Maps a Tomny permission mode to the nearest Claude Code `permission_mode`.
 * read-only becomes `plan` (no writes), workspace-write becomes `acceptEdits`, full-access and yolo become
 * `bypassPermissions`. Unknown or missing input becomes `default`.
 */
export const mapPermissionMode = (mode: TomnyPermissionMode | string | undefined): HookPermissionMode => {
  switch (mode) {
    case 'plan':
    case 'read-only':
      return 'plan';
    case 'acceptEdits':
    case 'autoEdit':
    case 'workspace-write':
      return 'acceptEdits';
    case 'bypassPermissions':
    case 'yolo':
    case 'full-access':
      return 'bypassPermissions';
    default:
      return 'default';
  }
};
