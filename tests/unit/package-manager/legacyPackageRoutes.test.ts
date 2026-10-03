import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const routerSource = readFileSync(
  resolve(process.cwd(), 'packages/desktop/src/renderer/components/layout/Router.tsx'),
  'utf8'
);

const documentStudioSource = readFileSync(
  resolve(process.cwd(), 'packages/package-apps/document-studio/src/renderer/DocumentStudioPage.tsx'),
  'utf8'
);
const studioPackageSource = readFileSync(
  resolve(process.cwd(), 'packages/desktop/src/renderer/package-apps/studio.tsx'),
  'utf8'
);

const legacyPackageRoutes = {
  '/company': 'com.tomni.company',
  '/knowledge': 'com.tomni.knowledge',
  '/settings/company': 'com.tomni.company',
  '/settings/knowledge': 'com.tomni.knowledge',
  '/settings/pet': 'com.tomni.pet',
} as const;

describe('legacy optional-package routes', () => {
  it('keeps Browser and IDE in the base router without Store redirects', () => {
    expect(routerSource).toContain("<Route path='/browser' element={withRouteFallback(Browser)} />");
    expect(routerSource).toContain("<Route path='/ide' element={withRouteFallback(Ide)} />");
    expect(routerSource).not.toContain('/store/package/com.tomni.browser');
  });
  it('opens the default IDE route without assigning Store package identity', () => {
    expect(documentStudioSource).toContain("options.openDefaultSurface('ide')");
    expect(studioPackageSource).toContain("options.openDefaultSurface('ide')");
    expect(documentStudioSource).not.toContain("openPackageModule('com.tomni.ide'");
    expect(studioPackageSource).not.toContain("openPackageModule('com.tomni.ide'");
  });

  it('does not expose Testing, News, Realtime, or Terminal as standalone routes', () => {
    for (const path of ['/testing', '/news', '/realtime', '/terminal']) {
      expect(routerSource).not.toContain(`path='${path}'`);
    }
  });

  it('open the relevant Store product state instead of loading an app from Settings or Core', () => {
    for (const [route, packageId] of Object.entries(legacyPackageRoutes)) {
      expect(routerSource).toContain(
        `<Route path='${route}' element={<Navigate to='/store/package/${packageId}' replace />} />`
      );
    }
  });
});
