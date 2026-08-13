/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, InputNumber, Select, Tooltip } from '@arco-design/web-react';
import {
  AlignTextBoth,
  AlignTextBottom,
  AlignTextCenter,
  AlignTextLeft,
  AlignTextMiddle,
  AlignTextRight,
  AlignTextTop,
  Download,
  FontSize,
  Strikethrough,
  TextUnderline,
} from '@icon-park/react';
import React from 'react';
import type {
  ViuFontStyle,
  ViuTextAlign,
  ViuTextDecoration,
  ViuTextTransform,
  ViuTypographyPatch,
  ViuVerticalAlign,
} from '@/common/viu/authoring';
import type { ViuAuthoringOption, ViuFontCatalogStatus, ViuFontOption, ViuTypographyInspectorLabels } from './types';

type TypographyInspectorProps = {
  labels: ViuTypographyInspectorLabels;
  mixedLabel: string;
  pixelsLabel: string;
  value: ViuTypographyPatch;
  fontOptions: readonly ViuFontOption[];
  fontWeightOptions: readonly ViuAuthoringOption<number>[];
  fontCatalog?: {
    status: ViuFontCatalogStatus;
    systemFontCount: number;
    onLoad: () => void;
  };
  disabled?: boolean;
  onCommit: (patch: ViuTypographyPatch) => void;
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
    <span>{label}</span>
    {children}
  </label>
);

const activeButtonType = (active: boolean): 'primary' | 'secondary' => (active ? 'primary' : 'secondary');

const toggleDecoration = (
  current: ViuTextDecoration | undefined,
  target: 'underline' | 'line-through'
): ViuTextDecoration => {
  const active = new Set((current ?? 'none').split(' ').filter((value) => value !== 'none'));
  if (active.has(target)) active.delete(target);
  else active.add(target);
  if (active.size === 0) return 'none';
  return active.has('underline') && active.has('line-through')
    ? 'underline line-through'
    : active.has('underline')
      ? 'underline'
      : 'line-through';
};

/** Dense, Figma-like typography controls with local-font discovery and CSS-faithful text styling. */
const TypographyInspector: React.FC<TypographyInspectorProps> = ({
  labels,
  mixedLabel,
  pixelsLabel,
  value,
  fontOptions,
  fontWeightOptions,
  fontCatalog,
  disabled = false,
  onCommit,
}) => {
  const textDecoration = value.textDecoration ?? 'none';
  const fontStatusText = fontCatalog
    ? fontCatalog.status === 'ready'
      ? labels.systemFontsCount(fontCatalog.systemFontCount)
      : fontCatalog.status === 'permission-denied' || fontCatalog.status === 'error'
        ? labels.fontAccessDenied
        : fontCatalog.status === 'unsupported'
          ? labels.fontUnsupported
          : labels.systemFontsCount(fontOptions.length)
    : undefined;

  const setFontWeight = (next: string | number): void => {
    const fontWeight = Number(next);
    if (Number.isFinite(fontWeight) && fontWeight >= 1 && fontWeight <= 1_000) {
      onCommit({ fontWeight });
    }
  };

  return (
    <section data-testid='viu-typography-inspector' className='rd-12px border border-b-1 bg-bg-2 overflow-hidden'>
      <div className='h-38px px-11px flex items-center gap-7px border-b border-b-1 bg-fill-1 text-12px font-700 text-t-primary'>
        <span className='text-primary flex items-center'>
          <FontSize size={15} />
        </span>
        <span>{labels.section}</span>
      </div>

      <div className='p-11px flex flex-col gap-11px'>
        <Field label={labels.fontFamily}>
          <div className='flex flex-col gap-6px'>
            <Select
              data-testid='viu-authoring-font-family'
              size='small'
              showSearch
              allowCreate
              allowClear={false}
              disabled={disabled}
              value={value.fontFamily}
              placeholder={mixedLabel}
              renderFormat={(_option, selectedValue) => (
                <span style={{ fontFamily: String(selectedValue) }}>{String(selectedValue)}</span>
              )}
              onVisibleChange={(visible) => {
                if (visible && fontCatalog?.status === 'idle') fontCatalog.onLoad();
              }}
              onChange={(next) => onCommit({ fontFamily: String(next) })}
            >
              {fontOptions.map((option) => (
                <Select.Option key={option.value} value={option.value} disabled={option.disabled}>
                  <span className='w-full flex items-center justify-between gap-12px'>
                    <span className='min-w-0 truncate' style={{ fontFamily: option.value }}>
                      {option.label}
                    </span>
                    {option.styles && option.styles.length > 0 ? (
                      <span className='shrink-0 text-10px tabular-nums text-t-tertiary'>{option.styles.length}</span>
                    ) : null}
                  </span>
                </Select.Option>
              ))}
            </Select>

            {fontCatalog ? (
              <div className='flex items-center justify-between gap-8px'>
                <span className='min-w-0 truncate text-11px text-t-tertiary'>{fontStatusText}</span>
                <Button
                  data-testid='viu-authoring-load-system-fonts'
                  type='text'
                  size='mini'
                  loading={fontCatalog.status === 'loading'}
                  disabled={fontCatalog.status === 'unsupported'}
                  icon={<Download size={13} />}
                  onClick={fontCatalog.onLoad}
                >
                  {fontCatalog.status === 'loading' ? labels.loadingSystemFonts : labels.loadSystemFonts}
                </Button>
              </div>
            ) : null}
          </div>
        </Field>

        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.fontSize}>
            <InputNumber
              data-testid='viu-authoring-font-size'
              size='small'
              min={1}
              max={1_000}
              suffix={pixelsLabel}
              disabled={disabled}
              value={value.fontSize}
              placeholder={mixedLabel}
              onChange={(next) => next !== undefined && onCommit({ fontSize: next })}
            />
          </Field>
          <Field label={labels.fontWeight}>
            <Select
              data-testid='viu-authoring-font-weight'
              size='small'
              showSearch
              allowCreate
              disabled={disabled}
              value={value.fontWeight}
              placeholder={mixedLabel}
              options={fontWeightOptions.map((option) => ({ ...option }))}
              onChange={setFontWeight}
            />
          </Field>
          <Field label={labels.lineHeight}>
            <InputNumber
              data-testid='viu-authoring-line-height'
              size='small'
              min={0.01}
              max={100}
              step={0.01}
              disabled={disabled}
              value={value.lineHeight}
              placeholder={mixedLabel}
              onChange={(next) => next !== undefined && onCommit({ lineHeight: next })}
            />
          </Field>
          <Field label={labels.letterSpacing}>
            <InputNumber
              data-testid='viu-authoring-letter-spacing'
              size='small'
              min={-1_000}
              max={1_000}
              step={0.1}
              suffix={pixelsLabel}
              disabled={disabled}
              value={value.letterSpacing}
              placeholder={mixedLabel}
              onChange={(next) => next !== undefined && onCommit({ letterSpacing: next })}
            />
          </Field>
        </div>

        <Field label={labels.fontStyle}>
          <Select
            data-testid='viu-authoring-font-style'
            size='small'
            disabled={disabled}
            value={value.fontStyle}
            placeholder={mixedLabel}
            options={[
              { value: 'normal', label: labels.styleNormal },
              { value: 'italic', label: labels.styleItalic },
              { value: 'oblique', label: labels.styleOblique },
            ]}
            onChange={(next) => onCommit({ fontStyle: next as ViuFontStyle })}
          />
        </Field>

        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.decoration}>
            <Button.Group className='w-full flex'>
              <Tooltip content={labels.underline}>
                <Button
                  data-testid='viu-authoring-decoration-underline'
                  className='flex-1'
                  size='small'
                  type={activeButtonType(textDecoration.includes('underline'))}
                  disabled={disabled}
                  aria-label={labels.underline}
                  aria-pressed={textDecoration.includes('underline')}
                  icon={<TextUnderline />}
                  onClick={() => onCommit({ textDecoration: toggleDecoration(textDecoration, 'underline') })}
                />
              </Tooltip>
              <Tooltip content={labels.strikethrough}>
                <Button
                  data-testid='viu-authoring-decoration-strikethrough'
                  className='flex-1'
                  size='small'
                  type={activeButtonType(textDecoration.includes('line-through'))}
                  disabled={disabled}
                  aria-label={labels.strikethrough}
                  aria-pressed={textDecoration.includes('line-through')}
                  icon={<Strikethrough />}
                  onClick={() => onCommit({ textDecoration: toggleDecoration(textDecoration, 'line-through') })}
                />
              </Tooltip>
            </Button.Group>
          </Field>
          <Field label={labels.letterCase}>
            <Select
              data-testid='viu-authoring-letter-case'
              size='small'
              disabled={disabled}
              value={value.textTransform}
              placeholder={mixedLabel}
              options={[
                { value: 'none', label: labels.caseOriginal },
                { value: 'uppercase', label: labels.caseUppercase },
                { value: 'lowercase', label: labels.caseLowercase },
                { value: 'capitalize', label: labels.caseCapitalize },
              ]}
              onChange={(next) => onCommit({ textTransform: next as ViuTextTransform })}
            />
          </Field>
        </div>

        <Field label={labels.horizontalAlignment}>
          <Button.Group className='w-full flex'>
            {(
              [
                ['left', labels.alignLeft, <AlignTextLeft key='icon' />],
                ['center', labels.alignCenter, <AlignTextCenter key='icon' />],
                ['right', labels.alignRight, <AlignTextRight key='icon' />],
                ['justify', labels.alignJustify, <AlignTextBoth key='icon' />],
              ] as const
            ).map(([next, label, icon]) => (
              <Tooltip key={next} content={label}>
                <Button
                  data-testid={`viu-authoring-text-align-${next}`}
                  className='flex-1'
                  size='small'
                  type={activeButtonType(value.textAlign === next)}
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={value.textAlign === next}
                  icon={icon}
                  onClick={() => onCommit({ textAlign: next as ViuTextAlign })}
                />
              </Tooltip>
            ))}
          </Button.Group>
        </Field>

        <Field label={labels.verticalAlignment}>
          <Button.Group className='w-full flex'>
            {(
              [
                ['top', labels.alignTop, <AlignTextTop key='icon' />],
                ['middle', labels.alignMiddle, <AlignTextMiddle key='icon' />],
                ['bottom', labels.alignBottom, <AlignTextBottom key='icon' />],
              ] as const
            ).map(([next, label, icon]) => (
              <Tooltip key={next} content={label}>
                <Button
                  data-testid={`viu-authoring-vertical-align-${next}`}
                  className='flex-1'
                  size='small'
                  type={activeButtonType(value.verticalAlign === next)}
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={value.verticalAlign === next}
                  icon={icon}
                  onClick={() => onCommit({ verticalAlign: next as ViuVerticalAlign })}
                />
              </Tooltip>
            ))}
          </Button.Group>
        </Field>
      </div>
    </section>
  );
};

export default TypographyInspector;
