/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ WebContentsView: class {}, app: {}, session: {} }));

import { BROWSER_PARTITION_FORBIDDEN, toRendererTabOptions } from '@process/browser/browserBridge';

describe('renderer openTab partition (G8)', () => {
  it('rejects any renderer-supplied partition with a stable code', () => {
    expect(() => toRendererTabOptions({ partition: 'persist:evil' })).toThrow(BROWSER_PARTITION_FORBIDDEN);
    expect(() => toRendererTabOptions({ partition: 'persist:tomny-app-x' })).toThrow(BROWSER_PARTITION_FORBIDDEN);
  });

  it('passes other options through unchanged', () => {
    expect(toRendererTabOptions({ url: 'https://a.com', visible: true })).toEqual({
      url: 'https://a.com',
      visible: true,
    });
    expect(toRendererTabOptions(undefined)).toEqual({});
  });
});
