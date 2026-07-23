/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Input, Select, Switch, Tag } from '@arco-design/web-react';
import { Branch, Components, Refresh } from '@icon-park/react';
import React from 'react';
import type { ViuComponentInspectorProps, ViuComponentPropertyControl } from './types';

const PropertyControl: React.FC<{
  control: ViuComponentPropertyControl;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}> = ({ control, disabled, onChange }) => {
  if (control.type === 'boolean') {
    return (
      <div className='h-28px flex items-center justify-between gap-10px'>
        <span className='min-w-0 truncate text-12px font-600 text-t-secondary'>{control.label}</span>
        <Switch
          data-testid={`viu-component-property-${control.id}`}
          size='small'
          checked={control.value}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    );
  }

  if (control.type === 'instance-swap') {
    return (
      <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
        <span>{control.label}</span>
        <Select
          size='small'
          value={control.value}
          disabled={disabled}
          options={control.options.map((option) => ({ value: option.id, label: option.name }))}
          onChange={(value) => onChange(String(value))}
        />
      </label>
    );
  }

  return (
    <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
      <span>{control.label}</span>
      <Input size='small' value={control.value} disabled={disabled} onChange={onChange} />
    </label>
  );
};

/** Component, instance, variant, property, and override controls above ordinary styling. */
const ComponentInspector: React.FC<ViuComponentInspectorProps> = ({
  labels,
  model,
  disabled = false,
  onCreateComponent,
  onCreateInstance,
  onCreateComponentSet,
  onDetachInstance,
  onRenameComponent,
  onSwapComponent,
  onChangeVariant,
  onChangeProperty,
  onResetOverrides,
}) => {
  const isInstance = Boolean(model.instance);
  const isDefinition = Boolean(model.definition);

  return (
    <section
      className='rd-12px border border-b-1 bg-bg-2 overflow-hidden'
      data-testid='viu-component-inspector'
      data-kind={isInstance ? 'instance' : isDefinition ? 'definition' : 'selection'}
    >
      <div className='h-40px px-11px flex items-center gap-8px border-b border-b-1 bg-fill-1'>
        <span className='text-primary flex items-center'>
          <Components size={16} />
        </span>
        <span className='min-w-0 flex-1 truncate text-12px font-750 text-t-primary'>{labels.section}</span>
        {isInstance ? <Tag size='small'>{labels.instance}</Tag> : null}
        {isDefinition ? <Tag size='small'>{labels.mainComponent}</Tag> : null}
      </div>

      <div className='p-11px flex flex-col gap-12px'>
        {!model.selected ? <Empty description={labels.emptyProperties} className='py-8px' /> : null}

        {model.selected && !isInstance && !isDefinition ? (
          <Button
            long
            type='outline'
            icon={<Components size={14} />}
            disabled={disabled || !model.canCreateComponent}
            data-testid='viu-create-component'
            onClick={onCreateComponent}
          >
            {labels.createComponent}
          </Button>
        ) : null}

        {model.canCreateComponentSet ? (
          <Button
            long
            type='secondary'
            icon={<Branch size={14} />}
            disabled={disabled}
            data-testid='viu-create-component-set'
            onClick={onCreateComponentSet}
          >
            {labels.combineVariants}
          </Button>
        ) : null}

        {model.definition ? (
          <>
            <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
              <span>{labels.mainComponent}</span>
              <Input
                key={model.definition.id}
                size='small'
                defaultValue={model.definition.name}
                disabled={disabled}
                data-testid='viu-component-name'
                onPressEnter={(event) => event.currentTarget.blur()}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== model.definition?.name) onRenameComponent(name);
                }}
              />
            </label>
            <Button
              long
              type='outline'
              icon={<Components size={14} />}
              disabled={disabled}
              data-testid='viu-create-component-instance'
              onClick={onCreateInstance}
            >
              {labels.createInstance}
            </Button>
          </>
        ) : null}

        {model.instance ? (
          <>
            <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
              <span>{labels.mainComponent}</span>
              <Select
                size='small'
                value={model.instance.componentId}
                disabled={disabled}
                data-testid='viu-instance-component'
                options={model.components.map((component) => ({ value: component.id, label: component.name }))}
                onChange={(value) => onSwapComponent(String(value))}
              />
            </label>

            <div className='flex flex-col gap-8px'>
              <div className='flex items-center gap-6px text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>
                <Branch size={13} />
                <span>{labels.variant}</span>
              </div>
              {model.variantAxes.length === 0 ? (
                <span className='text-11px text-t-tertiary'>{labels.defaultVariant}</span>
              ) : (
                model.variantAxes.map((axis) => (
                  <label key={axis.id} className='grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-8px'>
                    <span className='truncate text-12px font-600 text-t-secondary'>{axis.label}</span>
                    <Select
                      size='small'
                      value={axis.value}
                      disabled={disabled}
                      data-testid={`viu-variant-${axis.id}`}
                      options={axis.options.map((value) => ({ value, label: value }))}
                      onChange={(value) => onChangeVariant(axis.id, String(value))}
                    />
                  </label>
                ))
              )}
            </div>

            <div className='flex flex-col gap-8px'>
              <div className='text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>{labels.properties}</div>
              {model.properties.length === 0 ? (
                <span className='text-11px text-t-tertiary'>{labels.emptyProperties}</span>
              ) : (
                model.properties.map((property) => (
                  <PropertyControl
                    key={property.id}
                    control={property}
                    disabled={disabled}
                    onChange={(value) => onChangeProperty(property.id, value)}
                  />
                ))
              )}
            </div>

            <div className='rd-8px bg-fill-1 p-8px flex items-center gap-8px'>
              <div className='min-w-0 flex-1'>
                <div className='text-12px font-650 text-t-primary'>{labels.resetOverrides}</div>
                <div className='text-11px text-t-tertiary'>{model.instance.overrideCount}</div>
              </div>
              <Button
                type='text'
                size='mini'
                icon={<Refresh size={13} />}
                disabled={disabled || model.instance.overrideCount === 0}
                data-testid='viu-reset-instance-overrides'
                onClick={onResetOverrides}
              >
                {labels.resetOverrides}
              </Button>
            </div>
            <Button
              long
              type='text'
              disabled={disabled}
              data-testid='viu-detach-component-instance'
              onClick={onDetachInstance}
            >
              {labels.detachInstance}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
};

export default ComponentInspector;
