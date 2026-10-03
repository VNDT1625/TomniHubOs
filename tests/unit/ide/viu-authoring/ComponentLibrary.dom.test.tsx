/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject, type ViuProjectState } from '@/common/viu';
import ComponentLibrary from '@package-apps/design/renderer/viu/next/authoring/ComponentLibrary';
import type { ViuNextLabels } from '@package-apps/design/renderer/viu/next/types';

const labels: ViuNextLabels['componentLibrary'] = {
  title: 'Component library',
  searchPlaceholder: 'Search components and variants',
  empty: 'Create a component first',
  noResults: 'No matching components',
  component: 'Component',
  componentSet: 'Component set',
  variants: (count) => `${count} variants`,
  properties: (count) => `${count} properties`,
  insert: 'Insert instance',
  targetScreen: (name) => `Insert into ${name}`,
  targetUnavailable: 'Choose a screen',
  missingVariant: 'Variant unavailable',
  insertError: 'Could not insert instance',
};

const createLibraryProject = (): ViuProjectState => {
  const project = createPremiumStarterProject();
  project.components['component-title'] = {
    id: 'component-title',
    version: 1,
    name: 'Hero title',
    rootNodeId: 'node-home-title',
    variantProperties: {},
    propertyDefinitions: {
      title: {
        id: 'title',
        name: 'Title',
        type: 'text',
        targetNodeId: 'node-home-title',
        targetProperty: 'content.text',
        defaultValue: 'Matter, made impossible.',
      },
    },
  };
  project.components['component-action-default'] = {
    id: 'component-action-default',
    version: 1,
    name: 'Primary action',
    rootNodeId: 'node-home-cta',
    componentSetId: 'set-actions',
    variantProperties: { State: 'Default' },
    propertyDefinitions: {
      label: {
        id: 'label',
        name: 'Label',
        type: 'text',
        targetNodeId: 'node-home-cta',
        targetProperty: 'content.text',
        defaultValue: 'Explore',
      },
    },
  };
  project.components['component-action-back'] = {
    id: 'component-action-back',
    version: 1,
    name: 'Back action',
    rootNodeId: 'node-showcase-back',
    componentSetId: 'set-actions',
    variantProperties: { State: 'Back' },
    propertyDefinitions: {},
  };
  project.componentSets['set-actions'] = {
    id: 'set-actions',
    version: 1,
    name: 'Action button',
    componentIds: ['component-action-default', 'component-action-back'],
    variantAxes: { State: ['Default', 'Back'] },
  };
  return project;
};

const renderLibrary = (project: ViuProjectState, onInsertComponent = vi.fn(() => true)) => {
  const result = render(
    <ConfigProvider>
      <ComponentLibrary
        project={project}
        labels={labels}
        targetScreenName='Collection'
        onInsertComponent={onInsertComponent}
      />
    </ConfigProvider>
  );
  return { ...result, onInsertComponent };
};

const innerInput = (testId: string): HTMLInputElement => {
  const element = screen.getByTestId(testId);
  const input = element instanceof HTMLInputElement ? element : element.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input found for ${testId}`);
  return input;
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('VIU ComponentLibrary', () => {
  it('searches component names, variant values, and property names without losing the target screen', () => {
    renderLibrary(createLibraryProject());

    expect(screen.getByText('Insert into Collection')).toBeInTheDocument();
    expect(screen.getByTestId('viu-component-library-item-component-title')).toBeInTheDocument();
    expect(screen.getByTestId('viu-component-library-item-set-actions')).toBeInTheDocument();

    fireEvent.change(innerInput('viu-component-library-search'), { target: { value: 'Hero' } });
    expect(screen.getByTestId('viu-component-library-item-component-title')).toBeInTheDocument();
    expect(screen.queryByTestId('viu-component-library-item-set-actions')).not.toBeInTheDocument();

    fireEvent.change(innerInput('viu-component-library-search'), { target: { value: 'unavailable result' } });
    expect(screen.getByTestId('viu-component-library-no-results')).toBeInTheDocument();
  });

  it('selects a component-set variant before inserting its matching main component', async () => {
    const { onInsertComponent } = renderLibrary(createLibraryProject());
    const variantSelect = screen.getByTestId('viu-component-library-variant-set-actions-State');

    fireEvent.click(variantSelect);
    const optionLabel = await screen.findByText('Back');
    fireEvent.click(optionLabel.closest('.arco-select-option') ?? optionLabel);
    fireEvent.click(screen.getByTestId('viu-component-library-insert-set-actions'));

    expect(onInsertComponent).toHaveBeenCalledWith('component-action-back');
  });

  it('shows empty and insertion error states instead of silently failing', () => {
    const project = createPremiumStarterProject();
    const { rerender } = renderLibrary(project);
    expect(screen.getByTestId('viu-component-library-empty')).toBeInTheDocument();

    const onInsertComponent = vi.fn(() => false);
    rerender(
      <ConfigProvider>
        <ComponentLibrary
          project={createLibraryProject()}
          labels={labels}
          targetScreenName='Collection'
          onInsertComponent={onInsertComponent}
        />
      </ConfigProvider>
    );
    fireEvent.click(screen.getByTestId('viu-component-library-insert-component-title'));
    expect(screen.getByTestId('viu-component-library-error')).toHaveTextContent('Could not insert instance');
  });
});
