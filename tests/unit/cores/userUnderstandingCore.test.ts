import { describe, expect, it } from 'vitest';
import { PreferenceManager } from '../../../packages/desktop/src/process/userUnderstanding/preferenceManager';

describe('User Understanding Core Logic', () => {
  it('should confirm, retrieve, and delete preferences', () => {
    const manager = new PreferenceManager();
    const item = manager.confirmPreference('language', 'vi-VN', 'global');

    expect(item.key).toBe('language');
    expect(item.value).toBe('vi-VN');

    const fetched = manager.getPreference('language', 'global');
    expect(fetched?.value).toBe('vi-VN');

    const deleted = manager.deletePreference('language', 'global');
    expect(deleted).toBe(true);
    expect(manager.getPreference('language', 'global')).toBeNull();
  });

  it('should protect user-locked preferences from unauthorized override', () => {
    const manager = new PreferenceManager();
    manager.confirmPreference('theme', 'dark', 'global', true);

    expect(() => {
      manager.confirmPreference('theme', 'light', 'global', false);
    }).toThrow('Cannot override user-locked preference');
  });

  it('should lookup scoped preferences for work tasks', () => {
    const manager = new PreferenceManager();
    manager.confirmPreference('editor', 'vscode', 'global');
    manager.confirmPreference('build_target', 'win32', 'workspace_1');

    const workPrefs = manager.lookupForWork('workspace_1');
    expect(workPrefs.editor).toBe('vscode');
    expect(workPrefs.build_target).toBe('win32');
  });
});
