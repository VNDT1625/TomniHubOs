/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import '@/common/adapter/browser';
import { configService } from '@/common/config/configService';
import { ThemeProvider } from '@renderer/hooks/context/ThemeContext';
import { PreviewProvider } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import '@renderer/services/i18n';
import '@renderer/styles/arco-override.css';
import '@renderer/styles/themes/index.css';
import { ConfigProvider } from '@arco-design/web-react';
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import enUS from '@arco-design/web-react/es/locale/en-US';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import 'uno.css';

export type PackageAppMountOptions = {
  onBack: () => void;
  openPackageModule: (packageId: string, moduleId: string) => void;
};

type PackageAppComponent = React.ComponentType<{ options: PackageAppMountOptions }>;

const PackageProviders: React.FC<React.PropsWithChildren> = ({ children }) => (
  <ConfigProvider locale={enUS}>
    <ThemeProvider>
      <PreviewProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </PreviewProvider>
    </ThemeProvider>
  </ConfigProvider>
);

export const createPackageMount =
  (PackageApp: PackageAppComponent) =>
  (container: HTMLElement, options: PackageAppMountOptions): { unmount: () => void } => {
    let root: Root | undefined;
    let disposed = false;

    void configService
      .initialize()
      .catch((_error: unknown): undefined => undefined)
      .finally(() => {
        if (disposed) return;
        root = createRoot(container);
        root.render(
          <PackageProviders>
            <PackageApp options={options} />
          </PackageProviders>
        );
      });

    return {
      unmount: () => {
        disposed = true;
        root?.unmount();
      },
    };
  };
