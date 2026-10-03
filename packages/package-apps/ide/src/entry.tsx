/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import IdeWorkspace from '@package-apps/ide/renderer/IdeWorkspace';

import { createPackageMount, type PackageAppMountOptions } from '@package-apps/shared/runtime';
import { createIdeEditorAdapterResolver } from './editorAdapterResolver';

const ideAdapterResolver = createIdeEditorAdapterResolver({
  'text-code': React.lazy(() => import('./TextCodeAdapter')),
});

const IdePackageApp: React.FC<{ options: PackageAppMountOptions }> = ({ options }) => (
  <div className='size-full min-h-0 overflow-hidden bg-bg-1 text-t-1'>
    <IdeWorkspace
      onBack={options.onBack}
      adapterResolver={ideAdapterResolver}
      onOpenDesign={() => options.openPackageModule('com.tomni.design-studio', 'design')}
    />
  </div>
);

export const mount = createPackageMount(IdePackageApp);
