/** Downloaded entrypoint for the independently installable Automation Studio app. */

import AutomationView from '@renderer/pages/studio/automation/AutomationView';
import React from 'react';

import 'uno.css';
import { createAutomationPackageMount, type AutomationPackageMountOptions } from './runtime';

const AutomationStudioPackageApp: React.FC<{ options: AutomationPackageMountOptions }> = ({ options }) => (
  <div className='size-full min-h-0 overflow-hidden bg-bg-1 text-t-1'>
    <AutomationView onBack={options.onBack} />
  </div>
);

export const mount = createAutomationPackageMount(AutomationStudioPackageApp);
