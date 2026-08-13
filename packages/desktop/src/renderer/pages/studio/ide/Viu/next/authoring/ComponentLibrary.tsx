/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Empty, Input, Select, Tag } from '@arco-design/web-react';
import { Add, Branch, Components } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import type { ViuComponentDefinition, ViuComponentSet, ViuProjectState } from '@/common/viu';

import type { ViuNextLabels } from '../types';

export type ViuComponentLibraryProps = {
  project: ViuProjectState;
  labels: ViuNextLabels['componentLibrary'];
  targetScreenName?: string;
  disabled?: boolean;
  onInsertComponent: (componentId: string) => boolean;
};

type ComponentLibraryEntry =
  | { id: string; kind: 'component'; component: ViuComponentDefinition; searchText: string }
  | {
      id: string;
      kind: 'set';
      set: ViuComponentSet;
      components: ViuComponentDefinition[];
      searchText: string;
    };

const normalizeSearch = (value: string): string => value.trim().toLocaleLowerCase('en-US');

const propertyNames = (component: ViuComponentDefinition | undefined): string[] =>
  component
    ? Object.values(component.propertyDefinitions)
        .map((property) => property.name)
        .toSorted((left, right) => left.localeCompare(right))
    : [];

const matchesVariantSelection = (
  component: ViuComponentDefinition,
  selection: Readonly<Record<string, string>>
): boolean =>
  Object.entries(selection).every(([axisId, value]) => component.variantProperties[axisId] === value) &&
  Object.keys(component.variantProperties).length === Object.keys(selection).length;

/** Searchable project-local component shelf with set-aware variant insertion. */
const ComponentLibrary: React.FC<ViuComponentLibraryProps> = ({
  project,
  labels,
  targetScreenName,
  disabled = false,
  onInsertComponent,
}) => {
  const [query, setQuery] = useState('');
  const [selectionBySet, setSelectionBySet] = useState<Record<string, Record<string, string>>>({});
  const [insertFailed, setInsertFailed] = useState(false);

  const entries = useMemo<ComponentLibraryEntry[]>(() => {
    const componentsInSets = new Set<string>();
    const setEntries = Object.values(project.componentSets).map((set) => {
      const components = set.componentIds
        .map((componentId) => project.components[componentId])
        .filter((component): component is ViuComponentDefinition => Boolean(component));
      set.componentIds.forEach((componentId) => componentsInSets.add(componentId));
      const searchTokens = [set.name];
      for (const component of components) {
        searchTokens.push(component.name, ...Object.values(component.variantProperties), ...propertyNames(component));
      }
      searchTokens.push(...Object.keys(set.variantAxes), ...Object.values(set.variantAxes).flat());
      return {
        id: set.id,
        kind: 'set' as const,
        set,
        components,
        searchText: normalizeSearch(searchTokens.join(' ')),
      };
    });
    const componentEntries = Object.values(project.components)
      .filter((component) => !componentsInSets.has(component.id))
      .map((component) => ({
        id: component.id,
        kind: 'component' as const,
        component,
        searchText: normalizeSearch([component.name, ...propertyNames(component)].join(' ')),
      }));
    return [...setEntries, ...componentEntries].toSorted((left, right) => {
      const leftName = left.kind === 'set' ? left.set.name : left.component.name;
      const rightName = right.kind === 'set' ? right.set.name : right.component.name;
      return leftName.localeCompare(rightName);
    });
  }, [project.componentSets, project.components]);

  const normalizedQuery = normalizeSearch(query);
  const visibleEntries = normalizedQuery
    ? entries.filter((entry) => entry.searchText.includes(normalizedQuery))
    : entries;
  const insertionDisabled = disabled || !targetScreenName;

  const insert = (componentId: string): void => {
    setInsertFailed(false);
    try {
      if (!onInsertComponent(componentId)) setInsertFailed(true);
    } catch {
      setInsertFailed(true);
    }
  };

  return (
    <section className='h-full flex flex-col bg-bg-1' data-testid='viu-component-library'>
      <div className='sticky top-0 z-1 flex flex-col gap-8px border-b border-b-1 bg-bg-1 p-10px'>
        <div className='flex items-center gap-8px'>
          <span className='flex items-center text-primary'>
            <Components size={16} />
          </span>
          <span className='min-w-0 flex-1 truncate text-12px font-750 text-t-primary'>{labels.title}</span>
          <Tag size='small'>{entries.length}</Tag>
        </div>
        <Input.Search
          allowClear
          size='small'
          value={query}
          placeholder={labels.searchPlaceholder}
          data-testid='viu-component-library-search'
          onChange={setQuery}
        />
        <div className='truncate text-11px text-t-tertiary'>
          {targetScreenName ? labels.targetScreen(targetScreenName) : labels.targetUnavailable}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto p-10px'>
        {insertFailed ? (
          <Alert
            className='!mb-8px'
            type='error'
            content={labels.insertError}
            data-testid='viu-component-library-error'
          />
        ) : null}

        {entries.length === 0 ? (
          <Empty className='py-24px' description={labels.empty} data-testid='viu-component-library-empty' />
        ) : visibleEntries.length === 0 ? (
          <Empty className='py-24px' description={labels.noResults} data-testid='viu-component-library-no-results' />
        ) : (
          <div className='flex flex-col gap-8px'>
            {visibleEntries.map((entry) => {
              if (entry.kind === 'component') {
                const properties = propertyNames(entry.component);
                return (
                  <article
                    key={entry.id}
                    className='rd-12px border border-b-1 bg-bg-2 p-10px transition-colors hover:bg-fill-1'
                    data-testid={`viu-component-library-item-${entry.id}`}
                  >
                    <div className='mb-8px flex items-start gap-8px'>
                      <span className='mt-1px flex items-center text-primary'>
                        <Components size={15} />
                      </span>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-12px font-700 text-t-primary'>{entry.component.name}</div>
                        <div className='mt-2px text-10px uppercase tracking-0.06em text-t-tertiary'>
                          {labels.component}
                        </div>
                      </div>
                    </div>
                    <div className='mb-8px flex flex-wrap gap-4px'>
                      <Tag size='small'>{labels.properties(properties.length)}</Tag>
                      {properties.slice(0, 3).map((name) => (
                        <Tag key={name} size='small'>
                          {name}
                        </Tag>
                      ))}
                    </div>
                    <Button
                      long
                      size='small'
                      type='outline'
                      icon={<Add size={13} />}
                      disabled={insertionDisabled}
                      data-testid={`viu-component-library-insert-${entry.id}`}
                      onClick={() => insert(entry.component.id)}
                    >
                      {labels.insert}
                    </Button>
                  </article>
                );
              }

              const axisEntries = Object.entries(entry.set.variantAxes);
              const defaultSelection = Object.fromEntries(
                axisEntries.map(([axisId, values]) => [axisId, values[0] ?? ''])
              );
              const variantSelection = { ...defaultSelection, ...selectionBySet[entry.set.id] };
              const selectedComponent = entry.components.find((component) =>
                matchesVariantSelection(component, variantSelection)
              );
              const properties = propertyNames(selectedComponent);

              return (
                <article
                  key={entry.id}
                  className='rd-12px border border-b-1 bg-bg-2 p-10px transition-colors hover:bg-fill-1'
                  data-testid={`viu-component-library-item-${entry.id}`}
                >
                  <div className='mb-8px flex items-start gap-8px'>
                    <span className='mt-1px flex items-center text-primary'>
                      <Branch size={15} />
                    </span>
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-12px font-700 text-t-primary'>{entry.set.name}</div>
                      <div className='mt-2px text-10px uppercase tracking-0.06em text-t-tertiary'>
                        {labels.componentSet}
                      </div>
                    </div>
                    <Tag size='small'>{labels.variants(entry.components.length)}</Tag>
                  </div>

                  {axisEntries.length > 0 ? (
                    <div className='mb-8px grid gap-6px'>
                      {axisEntries.map(([axisId, values]) => (
                        <label key={axisId} className='grid grid-cols-[72px_minmax(0,1fr)] items-center gap-6px'>
                          <span className='truncate text-11px font-600 text-t-secondary'>{axisId}</span>
                          <Select
                            size='small'
                            value={variantSelection[axisId]}
                            options={values.map((value) => ({ value, label: value }))}
                            data-testid={`viu-component-library-variant-${entry.set.id}-${axisId}`}
                            onChange={(value) =>
                              setSelectionBySet((current) => ({
                                ...current,
                                [entry.set.id]: {
                                  ...variantSelection,
                                  [axisId]: String(value),
                                },
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}

                  <div className='mb-8px flex flex-wrap gap-4px'>
                    <Tag size='small'>{labels.properties(properties.length)}</Tag>
                    {selectedComponent ? (
                      <Tag size='small'>{selectedComponent.name}</Tag>
                    ) : (
                      <Tag size='small'>{labels.missingVariant}</Tag>
                    )}
                    {properties.slice(0, 2).map((name) => (
                      <Tag key={name} size='small'>
                        {name}
                      </Tag>
                    ))}
                  </div>

                  <Button
                    long
                    size='small'
                    type='outline'
                    icon={<Add size={13} />}
                    disabled={insertionDisabled || !selectedComponent}
                    data-testid={`viu-component-library-insert-${entry.id}`}
                    onClick={() => selectedComponent && insert(selectedComponent.id)}
                  >
                    {labels.insert}
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default ComponentLibrary;
