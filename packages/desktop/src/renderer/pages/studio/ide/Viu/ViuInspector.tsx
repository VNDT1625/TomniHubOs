/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Empty, Input, InputNumber, Select, Slider, Switch, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ViuNode } from './viuClient';

const { TextArea } = Input;

type ViuInspectorProps = {
  node: ViuNode | null;
  onChange: (patch: Partial<ViuNode>) => void;
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className='flex flex-col gap-6px text-11px font-600 text-t-secondary'>
    <span>{label}</span>
    {children}
  </label>
);

const ViuInspector: React.FC<ViuInspectorProps> = ({ node, onChange }) => {
  const { t } = useTranslation();
  if (!node) return <Empty description={t('ide.viu.inspector.empty')} className='mt-48px' />;

  const updateRect = (key: keyof ViuNode['rect'], value: number | undefined): void => {
    if (value === undefined) return;
    onChange({ rect: { ...node.rect, [key]: Math.max(key === 'width' || key === 'height' ? 1 : 0, value) } });
  };

  return (
    <div className='flex flex-col gap-14px p-14px overflow-auto'>
      <div className='flex items-center justify-between gap-8px'>
        <span className='text-13px font-700 text-t-primary truncate'>{node.name}</span>
        <Tag size='small'>{node.kind}</Tag>
      </div>
      <div className='grid grid-cols-2 gap-8px'>
        <Field label='X'>
          <InputNumber
            size='small'
            value={Math.round(node.rect.x)}
            min={0}
            onChange={(value) => updateRect('x', value)}
          />
        </Field>
        <Field label='Y'>
          <InputNumber
            size='small'
            value={Math.round(node.rect.y)}
            min={0}
            onChange={(value) => updateRect('y', value)}
          />
        </Field>
        <Field label={t('ide.viu.inspector.width')}>
          <InputNumber
            size='small'
            value={Math.round(node.rect.width)}
            min={1}
            onChange={(value) => updateRect('width', value)}
          />
        </Field>
        <Field label={t('ide.viu.inspector.height')}>
          <InputNumber
            size='small'
            value={Math.round(node.rect.height)}
            min={1}
            onChange={(value) => updateRect('height', value)}
          />
        </Field>
      </div>
      <Field label={t('ide.viu.inspector.layer')}>
        <InputNumber
          size='small'
          value={node.zIndex}
          min={-128}
          max={100000}
          onChange={(value) => value !== undefined && onChange({ zIndex: value })}
        />
      </Field>
      <Field label={t('ide.viu.inspector.kind')}>
        <Select
          size='small'
          value={node.kind}
          onChange={(value) => onChange({ kind: value as ViuNode['kind'] })}
          options={['frame', 'text', 'image', 'button', 'shape', 'runtime'].map((value) => ({ value, label: value }))}
        />
      </Field>
      <Field label={t('ide.viu.inspector.content')}>
        <TextArea
          value={node.content}
          autoSize={{ minRows: 2, maxRows: 5 }}
          onChange={(content) => onChange({ content })}
        />
      </Field>
      <Field label={t('ide.viu.inspector.fill')}>
        <Input
          size='small'
          value={node.style.fill ?? ''}
          placeholder='transparent'
          onChange={(fill) => onChange({ style: { ...node.style, fill } })}
        />
      </Field>
      <Field label={t('ide.viu.inspector.textColor')}>
        <Input
          size='small'
          value={node.style.color ?? ''}
          placeholder='inherit'
          onChange={(color) => onChange({ style: { ...node.style, color } })}
        />
      </Field>
      <Field label={t('ide.viu.inspector.opacity')}>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={node.style.opacity ?? 1}
          onChange={(opacity) => onChange({ style: { ...node.style, opacity: Number(opacity) } })}
        />
      </Field>
      <div className='flex items-center justify-between text-12px text-t-secondary'>
        <span>{t('ide.viu.inspector.locked')}</span>
        <Switch size='small' checked={node.locked} onChange={(locked) => onChange({ locked })} />
      </div>
      <div className='rounded-10px border border-b-1 bg-fill-1 p-10px flex flex-col gap-5px'>
        <span className='text-11px font-700 text-t-primary'>{t('ide.viu.inspector.fidelity')}</span>
        <span className='text-11px text-t-secondary'>
          {node.fidelity.strategy} · {Math.round(node.fidelity.confidence * 100)}%
        </span>
        {node.fidelity.notes.slice(0, 2).map((note) => (
          <span key={note} className='text-10px leading-relaxed text-t-tertiary'>
            {note}
          </span>
        ))}
      </div>
    </div>
  );
};

export default ViuInspector;
