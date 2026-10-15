/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'packages/desktop/src/renderer/styles/tomni-ui.css'), 'utf8');
const ruleBody = (selector: string): string => {
  const marker = `\n${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) return '';
  return css.slice(start + marker.length, css.indexOf('}', start));
};

describe('attach menu popup layout (tomni-ui.css)', () => {
  it('clamps the popup to the measured free area and lifts it above the side panel token', () => {
    const menu = ruleBody('.attach-menu');
    expect(menu).toMatch(/max-width:\s*min\(var\(--attach-menu-max-w,\s*640px\),\s*calc\(100vw - 16px\)\)/u);
    expect(ruleBody('.attach-menu')).toMatch(/z-index:\s*var\(--tomni-z-overlay-top\)/u);
    expect(css).toMatch(/\.arco-trigger-popup:has\(\.attach-menu\)\s*\{\s*z-index:\s*var\(--tomni-z-overlay-top\)/u);
  });

  it('gives the sub-list column at least 260px and lets the main column shrink only to 200px', () => {
    expect(ruleBody('.attach-menu__panel')).toMatch(/min-width:\s*260px/u);
    expect(ruleBody('.attach-menu__main')).toMatch(/min-width:\s*200px/u);
  });

  it('keeps names on one line with an ellipsis and the badge from shrinking', () => {
    const label = ruleBody('.attach-menu__label');
    expect(label).toMatch(/white-space:\s*nowrap/u);
    expect(label).toMatch(/text-overflow:\s*ellipsis/u);
    expect(ruleBody('.attach-menu__tag')).toMatch(/flex-shrink:\s*0/u);
    expect(ruleBody('.attach-menu__tag')).toMatch(/white-space:\s*nowrap/u);
  });

  it('stacks the sub-list in place of the main column behind a back button when two columns do not fit', () => {
    const hiddenMain = /\.attach-menu\[data-layout='stacked'\]\.attach-menu--panel-open[^{]*\{\s*display:\s*none/u;
    expect(css).toMatch(hiddenMain);
    const stackedHead = ruleBody(".attach-menu[data-layout='stacked'] .attach-menu__panel-head");
    expect(stackedHead).toMatch(/display:\s*block/u);
    expect(ruleBody('.attach-menu__panel-head')).toMatch(/display:\s*none/u);
  });
});
