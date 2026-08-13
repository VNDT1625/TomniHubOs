/** Lean trusted-React runtime for the independently downloaded Design Studio. */

import '@/common/adapter/browser';
import { configService } from '@/common/config/configService';
import { ThemeProvider } from '@renderer/hooks/context/ThemeContext';
import '@renderer/services/i18n';
import '@renderer/styles/arco-override.css';
import '@renderer/styles/themes/index.css';
import { ConfigProvider } from '@arco-design/web-react';
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import { resolvePackageArcoLocale } from '../packageLocale';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import 'uno.css';

export type DesignPackageMountOptions = {
  locale: string;
  onBack: () => void;
  openPackageModule: (packageId: string, moduleId: string) => void;
};

type DesignPackageComponent = React.ComponentType<{ options: DesignPackageMountOptions }>;

const DesignPackageProviders: React.FC<React.PropsWithChildren<{ locale: string }>> = ({ children, locale }) => (
  <ConfigProvider locale={resolvePackageArcoLocale(locale)}>
    <ThemeProvider>{children}</ThemeProvider>
  </ConfigProvider>
);

export const createDesignPackageMount =
  (PackageApp: DesignPackageComponent) =>
  (container: HTMLElement, options: DesignPackageMountOptions): { unmount: () => void } => {
    let root: Root | undefined;
    let disposed = false;

    void configService
      .initialize()
      .catch((_error: unknown): undefined => undefined)
      .finally(() => {
        if (disposed) return;
        root = createRoot(container);
        root.render(
          <DesignPackageProviders locale={options.locale}>
            <PackageApp options={options} />
          </DesignPackageProviders>
        );
      });

    return {
      unmount: () => {
        disposed = true;
        root?.unmount();
      },
    };
  };
