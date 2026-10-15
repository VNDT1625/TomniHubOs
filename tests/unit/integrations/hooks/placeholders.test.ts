import { describe, expect, it } from 'vitest';
import { expandPlaceholders, expandPlaceholdersInArgs, mapPermissionMode } from '@/common/integrations/hooks';

const ctx = {
  pluginRoot: 'C:\\Users\\MyPC\\AppData\\Tomny\\packages\\fmt\\source\\plugins\\claude\\formatter',
  pluginData: 'C:\\Users\\MyPC\\AppData\\Tomny\\data\\fmt\\',
  projectDir: 'D:\\work\\my project',
};

describe('expandPlaceholders', () => {
  it('expands Claude and Tomny variants with forward slashes on Windows paths', () => {
    expect(expandPlaceholders('${CLAUDE_PLUGIN_ROOT}/scripts/format.sh', ctx)).toBe(
      'C:/Users/MyPC/AppData/Tomny/packages/fmt/source/plugins/claude/formatter/scripts/format.sh'
    );
    expect(expandPlaceholders('${TOMNY_PLUGIN_ROOT}/a', ctx)).toBe(expandPlaceholders('${CLAUDE_PLUGIN_ROOT}/a', ctx));
    expect(expandPlaceholders('${CLAUDE_PROJECT_DIR}/x', ctx)).toBe('D:/work/my project/x');
    expect(expandPlaceholders('${TOMNY_PROJECT_DIR}', ctx)).toBe('D:/work/my project');
  });

  it('drops a trailing separator but keeps drive and filesystem roots', () => {
    expect(expandPlaceholders('${CLAUDE_PLUGIN_DATA}/state.json', ctx)).toBe(
      'C:/Users/MyPC/AppData/Tomny/data/fmt/state.json'
    );
    expect(expandPlaceholders('${CLAUDE_PROJECT_DIR}', { projectDir: 'C:\\' })).toBe('C:/');
    expect(expandPlaceholders('${CLAUDE_PROJECT_DIR}', { projectDir: '/' })).toBe('/');
  });

  it('replaces every occurrence and leaves other text, including backslashes, alone', () => {
    expect(expandPlaceholders('a ${CLAUDE_PLUGIN_ROOT} b ${CLAUDE_PLUGIN_ROOT} \\n', { pluginRoot: 'R' })).toBe(
      'a R b R \\n'
    );
  });

  it('keeps unknown variables and variables without a value', () => {
    expect(expandPlaceholders('${HOME} ${CLAUDE_FOO} $CLAUDE_PLUGIN_ROOT', ctx)).toBe(
      '${HOME} ${CLAUDE_FOO} $CLAUDE_PLUGIN_ROOT'
    );
    expect(expandPlaceholders('${CLAUDE_PLUGIN_DATA}', { pluginRoot: 'x' })).toBe('${CLAUDE_PLUGIN_DATA}');
    expect(expandPlaceholders('${CLAUDE_PLUGIN_DATA}', { pluginData: '' })).toBe('${CLAUDE_PLUGIN_DATA}');
  });

  it('is not recursive', () => {
    const out = expandPlaceholders('${CLAUDE_PLUGIN_ROOT}', {
      pluginRoot: '${CLAUDE_PROJECT_DIR}',
      projectDir: '/secret',
    });
    expect(out).toBe('${CLAUDE_PROJECT_DIR}');
  });

  it('treats $ sequences in values literally', () => {
    expect(expandPlaceholders('${CLAUDE_PLUGIN_ROOT}', { pluginRoot: 'a$&b$1' })).toBe('a$&b$1');
  });

  it('expands argument lists elementwise', () => {
    expect(expandPlaceholdersInArgs(['${CLAUDE_PLUGIN_ROOT}/x.js', '--flag'], { pluginRoot: 'C:\\p' })).toEqual([
      'C:/p/x.js',
      '--flag',
    ]);
  });
});

describe('mapPermissionMode', () => {
  it.each([
    ['read-only', 'plan'],
    ['workspace-write', 'acceptEdits'],
    ['full-access', 'bypassPermissions'],
    ['plan', 'plan'],
    ['autoEdit', 'acceptEdits'],
    ['acceptEdits', 'acceptEdits'],
    ['yolo', 'bypassPermissions'],
    ['bypassPermissions', 'bypassPermissions'],
    ['default', 'default'],
    ['something-new', 'default'],
    ['', 'default'],
    [undefined, 'default'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(mapPermissionMode(input)).toBe(expected);
  });
});
