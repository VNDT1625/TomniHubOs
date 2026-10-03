/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/pages/hub/HubWorkspacePage', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ kind, packageId, moduleId }: { kind: string; packageId?: string; moduleId?: string }) =>
      ReactModule.createElement(
        'output',
        { 'data-testid': 'hub-workspace' },
        `${kind}:${packageId ?? ''}:${moduleId ?? ''}`
      ),
  };
});
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: { list: vi.fn() } }));
vi.mock('@/common/packages/studioCompatibility', () => ({
  createStudioPackageGateNavigationState: vi.fn(),
  isStudioCompatibilityLegacyFallback: () => false,
  isStudioSplitRouteRedirectBootstrapEnabled: () => false,
  LEGACY_STUDIO_MODULE_ID: 'studio',
  LEGACY_STUDIO_PACKAGE_ID: 'com.tomni.studio',
  resolveStudioCompatibilityNavigation: vi.fn(),
}));

import StorePage from '@/renderer/pages/hub/StorePage';

const Location: React.FC = () => {
  const location = useLocation();
  return <output data-testid='location'>{`${location.pathname}${location.search}`}</output>;
};

describe('Store package routes', () => {
  it('redirects legacy runtime URLs to the package workspace', () => {
    render(
      <MemoryRouter initialEntries={['/store/app/com.tomni.calculator/calculator']}>
        <Routes>
          <Route path='/store/app/:packageId/:moduleId' element={<StorePage />} />
          <Route path='/apps/:packageId/:moduleId' element={<Location />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/apps/com.tomni.calculator/calculator');
  });

  it('keeps Store product routes in the Store workspace', () => {
    render(
      <MemoryRouter initialEntries={['/store/package/com.tomni.calculator']}>
        <Routes>
          <Route path='/store/package/:packageId' element={<StorePage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('hub-workspace')).toHaveTextContent('store:com.tomni.calculator:');
  });
});
