/** Downloadable Browser app Surface. Native browser capabilities remain brokered by Main. */
import React from 'react';
import BrowserPage from '@package-apps/browser/renderer/browser/BrowserPage';
import { createPackageMount, type PackageAppMountOptions } from '@package-apps/shared/runtime';

const BrowserPackageApp: React.FC<{ options: PackageAppMountOptions }> = () => (
  <div className='size-full min-h-0 overflow-hidden bg-bg-1 text-t-1'>
    <BrowserPage />
  </div>
);

export const mount = createPackageMount(BrowserPackageApp);
