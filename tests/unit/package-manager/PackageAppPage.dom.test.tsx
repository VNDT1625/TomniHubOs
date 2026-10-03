/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/pages/hub/HubWorkspacePage', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ kind, packageId, moduleId }: { kind: string; packageId?: string; moduleId?: string }) =>
      ReactModule.createElement(
        'output',
        { 'data-testid': 'package-app-workspace' },
        `${kind}:${packageId}:${moduleId}`
      ),
  };
});

import PackageAppPage from '@/renderer/pages/hub/PackageAppPage';

describe('PackageAppPage', () => {
  it('opens an installed package in the Hub package workspace', () => {
    render(
      <MemoryRouter initialEntries={['/apps/com.tomni.calculator/calculator']}>
        <Routes>
          <Route path='/apps/:packageId/:moduleId' element={<PackageAppPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('package-app-workspace')).toHaveTextContent(
      'package-app:com.tomni.calculator:calculator'
    );
  });
});
