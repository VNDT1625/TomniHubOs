/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import IdeWorkspace from '@renderer/pages/studio/ide/IdeWorkspace';
import React from 'react';
import { createPackageMount, type PackageAppMountOptions } from './runtime';

const IdePackageApp: React.FC<{ options: PackageAppMountOptions }> = ({ options }) => (
  <div className='size-full min-h-0 overflow-hidden bg-bg-1 text-t-1'>
    <IdeWorkspace onBack={options.onBack} />
  </div>
);

export const mount = createPackageMount(IdePackageApp);
