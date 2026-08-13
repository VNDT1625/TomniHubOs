/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import StudioPage from '@renderer/pages/studio/StudioPage';
import React from 'react';
import { createPackageMount, type PackageAppMountOptions } from './runtime';

const StudioPackageApp: React.FC<{ options: PackageAppMountOptions }> = ({ options }) => (
  <div className='size-full min-h-0 overflow-hidden bg-bg-1 text-t-1'>
    <StudioPage onOpenIde={() => options.openPackageModule('com.tomni.ide', 'ide')} />
  </div>
);

export const mount = createPackageMount(StudioPackageApp);
