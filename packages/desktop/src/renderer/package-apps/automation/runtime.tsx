/** Lean trusted-React runtime for the independently downloaded Automation Studio. */

import '@/common/adapter/browser';
import { configService } from '@/common/config/configService';
import { ThemeProvider } from '@renderer/hooks/context/ThemeContext';
import '@renderer/services/i18n';
import '@renderer/styles/arco-override.css';
import '@renderer/styles/themes/index.css';
import { ConfigProvider } from '@arco-design/web-react';
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolvePackageArcoLocale } from '../packageLocale';

export type AutomationPackageMountOptions = {
  locale: string;
  onBack: () => void;
  openPackageModule: (packageId: string, moduleId: string) => void;
};

type AutomationPackageComponent = React.ComponentType<{ options: AutomationPackageMountOptions }>;

const AutomationPackageProviders: React.FC<React.PropsWithChildren<{ locale: string }>> = ({ children, locale }) => (
  <ConfigProvider locale={resolvePackageArcoLocale(locale)}>
    <ThemeProvider>{children}</ThemeProvider>
  </ConfigProvider>
);

export const createAutomationPackageMount =
  (PackageApp: AutomationPackageComponent) =>
  (container: HTMLElement, options: AutomationPackageMountOptions): { unmount: () => void } => {
    let root: Root | undefined;
    let disposed = false;

    void configService
      .initialize()
      .catch((_error: unknown): undefined => undefined)
      .finally(() => {
        if (disposed) return;
        root = createRoot(container);
        root.render(
          <AutomationPackageProviders locale={options.locale}>
            <PackageApp options={options} />
          </AutomationPackageProviders>
        );
      });

    return {
      unmount: () => {
        disposed = true;
        root?.unmount();
      },
    };
  };
