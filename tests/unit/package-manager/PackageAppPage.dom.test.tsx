/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  PackageAppHost: ({
    packageId,
    moduleId,
    onBack,
    allowSandboxedWeb,
  }: {
    packageId: string;
    moduleId: string;
    onBack: () => void;
    allowSandboxedWeb: boolean;
  }) => (
    <section data-testid='package-app-host'>
      {`${packageId}:${moduleId}:${String(allowSandboxedWeb)}`}
      <button type='button' onClick={onBack}>
        Back
      </button>
    </section>
  ),
}));

import PackageAppPage from '@/renderer/pages/hub/PackageAppPage';

const LocationProbe: React.FC = () => <output data-testid='location'>{useLocation().pathname}</output>;

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path='/apps/:packageId/:moduleId' element={<PackageAppPage />} />
        <Route path='*' element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

describe('PackageAppPage', () => {
  it('hosts an installed package directly in the shell centre', () => {
    renderAt('/apps/com.tomni.calculator/calculator');

    expect(screen.getByTestId('package-app-host')).toHaveTextContent('com.tomni.calculator:calculator:true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/guid');
  });

  it('sends oversized route parameters back to the Store', () => {
    renderAt(`/apps/${'a'.repeat(257)}/calculator`);

    expect(screen.queryByTestId('package-app-host')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/store');
  });
});
