export type PreferenceItem = {
  key: string;
  value: string;
  scope: string; // e.g. 'global' | 'workspace:id'
  userLocked: boolean;
  disabled: boolean;
  lastConfirmedAt: number;
  provenance: string;
};

export class PreferenceManager {
  private preferences = new Map<string, PreferenceItem>();

  private makeKey(key: string, scope: string): string {
    return `${scope}::${key}`;
  }

  public confirmPreference(
    key: string,
    value: string,
    scope = 'global',
    userLocked = true,
  ): PreferenceItem {
    const fullKey = this.makeKey(key, scope);
    const existing = this.preferences.get(fullKey);

    if (existing?.userLocked && !userLocked) {
      throw new Error(`Cannot override user-locked preference for key: ${key}`);
    }

    const item: PreferenceItem = {
      key,
      value,
      scope,
      userLocked,
      disabled: false,
      lastConfirmedAt: Date.now(),
      provenance: 'user_confirmed',
    };

    this.preferences.set(fullKey, item);
    return item;
  }

  public getPreference(key: string, scope = 'global'): PreferenceItem | null {
    const item = this.preferences.get(this.makeKey(key, scope));
    if (!item || item.disabled) return null;
    return item;
  }

  public listPreferences(scope?: string): readonly PreferenceItem[] {
    const all = Array.from(this.preferences.values()).filter((item) => !item.disabled);
    if (!scope) return all;
    return all.filter((item) => item.scope === scope || item.scope === 'global');
  }

  public deletePreference(key: string, scope = 'global'): boolean {
    return this.preferences.delete(this.makeKey(key, scope));
  }

  public disablePreference(key: string, scope = 'global'): boolean {
    const item = this.preferences.get(this.makeKey(key, scope));
    if (!item) return false;
    item.disabled = true;
    return true;
  }

  public lookupForWork(workScope: string): Record<string, string> {
    const prefs = this.listPreferences(workScope);
    const result: Record<string, string> = {};
    for (const p of prefs) {
      result[p.key] = p.value;
    }
    return result;
  }
}
