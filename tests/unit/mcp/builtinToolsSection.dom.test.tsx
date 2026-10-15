/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer } from '@/common/config/storage';
import {
  HubServerRow,
  matchesHubFilter,
  matchesHubQuery,
} from '@/renderer/pages/settings/ToolsSettings/CapabilityKindUi';

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: { list: vi.fn(async () => []) },
}));

const serverNamed = (name: string, enabled: boolean, builtin: boolean): IMcpServer => ({
  id: `id-${name}`,
  name,
  description: `${name} description`,
  enabled,
  builtin,
  transport: { type: 'stdio', command: 'node', args: [] },
  original_json: '{}',
  created_at: 1,
  updated_at: 1,
});

const cron = serverNamed('tomny-cron', true, true);
const imageGen = serverNamed(BUILTIN_IMAGE_GEN_NAME, false, true);
const own = serverNamed('my-own-server', true, false);

afterEach(() => {
  cleanup();
});

describe('HubServerRow', () => {
  it('gives a built-in row a switch and reports the server whose switch was flipped', () => {
    const onToggle = vi.fn();
    render(
      <ul>
        <HubServerRow server={cron} testPrefix='builtin' pending={false} onToggle={onToggle} />
      </ul>
    );

    fireEvent.click(screen.getByTestId('builtin-switch-tomny-cron'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'id-tomny-cron', name: 'tomny-cron' }));
  });

  it('leaves image generation without a switch, because its provider decides', () => {
    render(
      <ul>
        <HubServerRow server={imageGen} testPrefix='builtin' pending={false} onToggle={vi.fn()} />
      </ul>
    );

    expect(screen.getByTestId(`builtin-mcp-${BUILTIN_IMAGE_GEN_NAME}`).textContent).toContain(
      'settings.capabilitiesTab.builtinImageGenHint'
    );
    expect(screen.queryByTestId(`builtin-switch-${BUILTIN_IMAGE_GEN_NAME}`)).toBeNull();
  });

  it('uses the custom prefix for the user own servers, so they are not mistaken for built-in rows', () => {
    render(
      <ul>
        <HubServerRow server={own} testPrefix='custom' pending={false} onToggle={vi.fn()} />
      </ul>
    );

    expect(screen.getByTestId('custom-mcp-my-own-server')).toBeTruthy();
    expect(screen.getByTestId('custom-switch-my-own-server')).toBeTruthy();
    expect(screen.queryByTestId('builtin-mcp-my-own-server')).toBeNull();
  });
});

describe('hub search and on/off filter', () => {
  it('matches an empty query to everything and otherwise matches name or description, ignoring case', () => {
    expect(matchesHubQuery('', [undefined])).toBe(true);
    expect(matchesHubQuery('   ', ['x'])).toBe(true);
    expect(matchesHubQuery('CRON', ['tomny-cron', undefined])).toBe(true);
    expect(matchesHubQuery('browser', ['tomny-cron', 'Opens a Browser'])).toBe(true);
    expect(matchesHubQuery('nothing', ['tomny-cron', undefined])).toBe(false);
  });

  it('passes all items under all, only enabled items under on, and only disabled items under off', () => {
    expect(matchesHubFilter(true, 'all')).toBe(true);
    expect(matchesHubFilter(false, 'all')).toBe(true);
    expect(matchesHubFilter(true, 'on')).toBe(true);
    expect(matchesHubFilter(false, 'on')).toBe(false);
    expect(matchesHubFilter(false, 'off')).toBe(true);
    expect(matchesHubFilter(true, 'off')).toBe(false);
  });
});
