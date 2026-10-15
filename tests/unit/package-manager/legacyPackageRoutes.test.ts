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
  '/knowledge': 'com.tomni.knowledge',
  '/settings/company': 'com.tomni.company',
  '/settings/knowledge': 'com.tomni.knowledge',
  '/settings/pet': 'com.tomni.pet',
} as const;

describe('legacy optional-package routes', () => {
    it('does not bundle the Browser or IDE implementation in the base router', () => {
    expect(routerSource).toContain("<DefaultPackageRoute app='browser' />");
    expect(routerSource).toContain("<DefaultPackageRoute app='ide' />");
    expect(routerSource).not.toContain("import('@package-apps/browser/renderer/browser/BrowserPage')");
    expect(routerSource).not.toContain("import('@package-apps/ide/renderer/IdeWorkspace')");
    expect(routerSource).not.toContain("path='/apps/com.tomni.ide/ide' element={<Navigate to='/ide'");
  });
  it('opens the default IDE route without assigning Store package identity', () => {
    expect(documentStudioSource).toContain("options.openDefaultSurface('ide')");
    expect(studioPackageSource).toContain("options.openDefaultSurface('ide')");
    expect(documentStudioSource).not.toContain("openPackageModule('com.tomni.ide'");
    expect(studioPackageSource).not.toContain("openPackageModule('com.tomni.ide'");
  });

    it('does not expose Testing, News or Terminal as standalone routes', () => {
        for (const path of ['/testing', '/news', '/terminal']) {
      // An old link may only redirect elsewhere; it must never render its own page.
      const routes = routerSource.split('<Route ').filter((route) => route.startsWith(`path='${path}'`));
      for (const route of routes) expect(route).toMatch(/element=\{<Navigate to='[^']+' replace \/>\}/);
    }
  });

  it('renders Company in the Hub shell centre instead of a standalone page', () => {
    expect(routerSource).toContain("<Route path='/company' element={withRouteFallback(CompanyRoute)} />");
  });

  it('open the relevant Store product state instead of loading an app from Settings or Core', () => {
    for (const [route, packageId] of Object.entries(legacyPackageRoutes)) {
      expect(routerSource).toContain(
        `<Route path='${route}' element={<Navigate to='/store/package/${packageId}' replace />} />`
      );
    }
  });
});
