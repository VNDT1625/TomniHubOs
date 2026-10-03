/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import StudioPage from '@package-apps/document-studio/renderer/studio/StudioPage';
import React from 'react';
import { createPackageMount, type PackageAppMountOptions } from '@package-apps/shared/runtime';

const StudioPackageApp: React.FC<{ options: PackageAppMountOptions }> = ({ options }) => (
  <div className='size-full min-h-0 overflow-hidden bg-bg-1 text-t-1'>
    <StudioPage onOpenIde={() => options.openDefaultSurface('ide')} />
  </div>
);

export const mount = createPackageMount(StudioPackageApp);
