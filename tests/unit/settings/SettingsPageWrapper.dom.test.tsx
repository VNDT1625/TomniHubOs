/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getBuiltinSettingsNavItems } from '@/renderer/pages/settings/components/SettingsPageWrapper';
import { BUILTIN_TAB_IDS } from '@/renderer/pages/settings/components/SettingsSider';

describe('getBuiltinSettingsNavItems', () => {
  it('resolves every builtin settings tab to a navigation item', () => {
    const items = getBuiltinSettingsNavItems(true, (key) => key);

    expect(items.map((item) => item.id)).toEqual(BUILTIN_TAB_IDS);
  });

  it('keeps optional application settings out of the base navigation', () => {
    const ids = getBuiltinSettingsNavItems(true, (key) => key).map((item) => item.id);

    expect(ids).not.toEqual(
      expect.arrayContaining(['browser', 'company', 'knowledge', 'pet', 'testing', 'monitor', 'terminal'])
    );
  });
});
