/** @vitest-environment jsdom */

import { act, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({
  get: vi.fn<(key: string) => unknown>(() => undefined),
  initialize: vi.fn<() => Promise<void>>(),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>().mockResolvedValue(undefined),
  whenReady: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('@/common/config/configService', () => ({ configService: configMock }));

import {
  createAutomationPackageMount,
  type AutomationPackageMountOptions,
} from '@renderer/package-apps/automation/runtime';

let mountedOptions: AutomationPackageMountOptions | undefined;
const TestAutomationPackage = ({ options }: { options: AutomationPackageMountOptions }) => {
  mountedOptions = options;
  return <span>automation-studio-{options.locale}</span>;
};
const mount = createAutomationPackageMount(TestAutomationPackage);

describe('Automation Studio package runtime boundary', () => {
  beforeEach(() => {
    configMock.initialize.mockReset();
    configMock.initialize.mockResolvedValue(undefined);
    mountedOptions = undefined;
  });

  it('mounts with host options and unmounts cleanly', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onBack = vi.fn();
    let mounted: ReturnType<typeof mount> | undefined;

    await act(async () => {
      mounted = mount(container, { locale: 'vi-VN', onBack, openPackageModule: vi.fn(), openDefaultSurface: vi.fn() });
    });

    await waitFor(() => expect(container).toHaveTextContent('automation-studio-vi-VN'));
    expect(mountedOptions?.onBack).toBe(onBack);

    act(() => mounted?.unmount());
    expect(container).toBeEmptyDOMElement();
    container.remove();
  });

  it('does not render after the host unmounts while configuration is still loading', async () => {
    let releaseInitialization: (() => void) | undefined;
    configMock.initialize.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseInitialization = resolve;
      })
    );
    const container = document.createElement('div');
    document.body.append(container);

    const mounted = mount(container, {
      locale: 'en-US',
      onBack: vi.fn(),
      openPackageModule: vi.fn(),
      openDefaultSurface: vi.fn(),
    });
    mounted.unmount();
    releaseInitialization?.();
    await act(async () => Promise.resolve());

    expect(container).toBeEmptyDOMElement();
    expect(mountedOptions).toBeUndefined();
    container.remove();
  });
});
