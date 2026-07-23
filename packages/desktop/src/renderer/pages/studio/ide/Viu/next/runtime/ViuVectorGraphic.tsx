/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ViuFill, ViuNodeStyle } from '@/common/viu';
import {
  createViuCompoundPathData,
  getViuVectorContours,
  type ViuVectorBooleanOperand,
  type ViuVectorGeometry,
  type ViuVectorMaskOperation,
} from '@/common/viu/graphics/vector';

export type ViuVectorGraphicProps = {
  geometry: ViuVectorGeometry;
  nodeStyle: ViuNodeStyle;
  width: number;
  height: number;
  className?: string;
};

const svgPaint = (value: string | undefined, fallback: string): string =>
  value && !value.toLowerCase().includes('gradient(') ? value : fallback;

const strokeDasharray = (style: ViuNodeStyle['borderStyle'], width: number): string | undefined => {
  if (style === 'dashed') return `${Math.max(1, width * 3)} ${Math.max(1, width * 2)}`;
  if (style === 'dotted') return `0 ${Math.max(1, width * 2)}`;
  return undefined;
};

type ViuStructuredFillProps = { fill: ViuFill; paintId: string };

const ViuStructuredFill: React.FC<ViuStructuredFillProps> = ({ fill, paintId }) => {
  if (fill.type === 'solid') return null;
  if (fill.type === 'linear') {
    return (
      <linearGradient
        id={paintId}
        x1='50%'
        y1='100%'
        x2='50%'
        y2='0%'
        gradientTransform={`rotate(${fill.angle} 0.5 0.5)`}
      >
        {fill.stops.map((stop, index) => (
          <stop
            key={`${paintId}-${index}`}
            offset={`${stop.position * 100}%`}
            stopColor={stop.color}
            stopOpacity={fill.opacity}
          />
        ))}
      </linearGradient>
    );
  }
  return (
    <radialGradient id={paintId} cx={`${fill.centerX}%`} cy={`${fill.centerY}%`} r={`${fill.radius}%`}>
      {fill.stops.map((stop, index) => (
        <stop
          key={`${paintId}-${index}`}
          offset={`${stop.position * 100}%`}
          stopColor={stop.color}
          stopOpacity={fill.opacity}
        />
      ))}
    </radialGradient>
  );
};

const structuredFillPaint = (fill: ViuFill, paintId: string): string =>
  fill.type === 'solid' ? fill.color : `url(#${paintId})`;

const operandPathData = (
  geometry: ViuVectorGeometry,
  operation: { operands: ViuVectorBooleanOperand[] },
  operandIndex: number
): string => {
  const operand = operation.operands[operandIndex];
  if (!operand) return '';
  const contourIds = new Set(operand.contourIds);
  return createViuCompoundPathData(getViuVectorContours(geometry).filter((contour) => contourIds.has(contour.id)));
};

type ViuBooleanDefinitionsProps = {
  geometry: ViuVectorGeometry;
  maskId: string;
  clipPrefix: string;
  width: number;
  height: number;
};

const ViuBooleanDefinitions: React.FC<ViuBooleanDefinitionsProps> = ({
  geometry,
  maskId,
  clipPrefix,
  width,
  height,
}) => {
  const operation = geometry.booleanOperation;
  if (!operation) return null;
  const operandPaths = operation.operands.map((_, index) => operandPathData(geometry, operation, index));
  const intersectionClipIds = operandPaths.slice(1).map((_, index) => `${clipPrefix}-${index}`);
  const intersectShape = intersectionClipIds.reduceRight<React.ReactNode>(
    (child, clipId) => <g clipPath={`url(#${clipId})`}>{child}</g>,
    <path d={operandPaths[0]} fill='white' fillRule='evenodd' />
  );

  return (
    <>
      {operation.kind === 'intersect'
        ? operandPaths.slice(1).map((pathData, index) => (
            <clipPath key={intersectionClipIds[index]} id={intersectionClipIds[index]}>
              <path d={pathData} fillRule='evenodd' />
            </clipPath>
          ))
        : null}
      <mask id={maskId} maskUnits='userSpaceOnUse' x={0} y={0} width={width} height={height}>
        <rect x={0} y={0} width={width} height={height} fill='black' />
        {operation.kind === 'union'
          ? operandPaths.map((pathData, index) => (
              <path key={operation.operands[index]!.id} d={pathData} fill='white' fillRule='evenodd' />
            ))
          : null}
        {operation.kind === 'subtract' ? (
          <>
            <path d={operandPaths[0]} fill='white' fillRule='evenodd' />
            {operandPaths.slice(1).map((pathData, index) => (
              <path key={operation.operands[index + 1]!.id} d={pathData} fill='black' fillRule='evenodd' />
            ))}
          </>
        ) : null}
        {operation.kind === 'exclude' ? <path d={operandPaths.join(' ')} fill='white' fillRule='evenodd' /> : null}
        {operation.kind === 'intersect' ? intersectShape : null}
      </mask>
    </>
  );
};

type ViuMaskDefinitionsProps = {
  geometry: ViuVectorGeometry;
  operation: ViuVectorMaskOperation;
  definitionId: string;
};

const ViuMaskDefinitions: React.FC<ViuMaskDefinitionsProps> = ({ geometry, operation, definitionId }) => {
  const maskIndex = operation.operands.findIndex((operand) => operand.id === operation.maskOperandId);
  const maskPath = operandPathData(geometry, operation, maskIndex);
  return operation.kind === 'clip' ? (
    <clipPath id={definitionId}>
      <path d={maskPath} fillRule='evenodd' />
    </clipPath>
  ) : (
    <mask id={definitionId} maskUnits='userSpaceOnUse'>
      <path d={maskPath} fill='white' fillRule='evenodd' />
    </mask>
  );
};

/** Shared vector renderer used by both authoring Canvas and the Present runtime. */
const ViuVectorGraphic: React.FC<ViuVectorGraphicProps> = ({ geometry, nodeStyle, width, height, className }) => {
  const paintPrefix = React.useId().replaceAll(':', '');
  const maskId = `viu-${paintPrefix}-boolean-mask`;
  const strokeWidth = nodeStyle.borderStyle === 'none' ? 0 : (nodeStyle.borderWidth ?? 0);
  const fill = geometry.closed ? svgPaint(nodeStyle.background, 'var(--color-primary-light-3)') : 'transparent';
  const stroke = strokeWidth > 0 ? svgPaint(nodeStyle.borderColor, 'var(--color-primary-6)') : 'transparent';
  const structuredFills = geometry.closed
    ? nodeStyle.fills
        ?.filter((candidate) => candidate.visible)
        .map((candidate, index) => ({ fill: candidate, paintId: `viu-${paintPrefix}-${index}` }))
        .toReversed()
    : undefined;
  const booleanOperation = geometry.booleanOperation;
  const maskOperation = geometry.maskOperation;
  const maskDefinitionId = `viu-${paintPrefix}-user-mask`;
  const maskContourIds = new Set(
    maskOperation?.operands.find((operand) => operand.id === maskOperation.maskOperandId)?.contourIds ?? []
  );
  const maskContentPath = maskOperation
    ? createViuCompoundPathData(getViuVectorContours(geometry).filter((contour) => !maskContourIds.has(contour.id)))
    : '';

  return (
    <svg
      aria-hidden='true'
      className={className}
      data-viu-vector-graphic='true'
      data-viu-vector-boolean={booleanOperation?.kind}
      data-viu-vector-mask={maskOperation?.kind}
      focusable='false'
      height='100%'
      preserveAspectRatio='none'
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      width='100%'
    >
      <defs>
        {structuredFills?.map(({ fill: candidate, paintId }) => (
          <ViuStructuredFill key={paintId} fill={candidate} paintId={paintId} />
        ))}
        {booleanOperation ? (
          <ViuBooleanDefinitions
            geometry={geometry}
            maskId={maskId}
            clipPrefix={`viu-${paintPrefix}-clip`}
            width={Math.max(1, width)}
            height={Math.max(1, height)}
          />
        ) : null}
        {maskOperation ? (
          <ViuMaskDefinitions geometry={geometry} operation={maskOperation} definitionId={maskDefinitionId} />
        ) : null}
      </defs>
      {maskOperation ? (
        <>
          {structuredFills?.length ? (
            structuredFills.map(({ fill: candidate, paintId }) => (
              <path
                key={paintId}
                data-viu-vector-fill={candidate.id}
                d={maskContentPath}
                fill={structuredFillPaint(candidate, paintId)}
                fillOpacity={candidate.type === 'solid' ? candidate.opacity : undefined}
                fillRule={geometry.fillRule}
                clipPath={maskOperation.kind === 'clip' ? `url(#${maskDefinitionId})` : undefined}
                mask={maskOperation.kind === 'alpha' ? `url(#${maskDefinitionId})` : undefined}
              />
            ))
          ) : (
            <path
              d={maskContentPath}
              fill={fill}
              fillRule={geometry.fillRule}
              clipPath={maskOperation.kind === 'clip' ? `url(#${maskDefinitionId})` : undefined}
              mask={maskOperation.kind === 'alpha' ? `url(#${maskDefinitionId})` : undefined}
            />
          )}
          <path
            d={maskContentPath}
            fill='transparent'
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={geometry.strokeCap}
            strokeLinejoin={geometry.strokeJoin}
            strokeMiterlimit={geometry.miterLimit}
            strokeDasharray={strokeDasharray(nodeStyle.borderStyle, strokeWidth)}
            clipPath={maskOperation.kind === 'clip' ? `url(#${maskDefinitionId})` : undefined}
            mask={maskOperation.kind === 'alpha' ? `url(#${maskDefinitionId})` : undefined}
            vectorEffect='non-scaling-stroke'
          />
          <path
            data-viu-vector-path={geometry.pathData}
            d={geometry.pathData}
            fill='transparent'
            stroke='transparent'
          />
        </>
      ) : booleanOperation ? (
        <>
          {structuredFills?.length ? (
            structuredFills.map(({ fill: candidate, paintId }) => (
              <rect
                key={paintId}
                data-viu-vector-fill={candidate.id}
                x={0}
                y={0}
                width={Math.max(1, width)}
                height={Math.max(1, height)}
                fill={structuredFillPaint(candidate, paintId)}
                fillOpacity={candidate.type === 'solid' ? candidate.opacity : undefined}
                mask={`url(#${maskId})`}
              />
            ))
          ) : (
            <rect
              x={0}
              y={0}
              width={Math.max(1, width)}
              height={Math.max(1, height)}
              fill={fill}
              mask={`url(#${maskId})`}
            />
          )}
          <path
            data-viu-vector-path={geometry.pathData}
            d={geometry.pathData}
            fill='transparent'
            stroke='transparent'
          />
        </>
      ) : structuredFills?.length ? (
        <>
          {structuredFills.map(({ fill: candidate, paintId }) => (
            <path
              key={paintId}
              data-viu-vector-fill={candidate.id}
              d={geometry.pathData}
              fill={structuredFillPaint(candidate, paintId)}
              fillOpacity={candidate.type === 'solid' ? candidate.opacity : undefined}
              fillRule={geometry.fillRule}
            />
          ))}
          <path
            data-viu-vector-path={geometry.pathData}
            d={geometry.pathData}
            fill='transparent'
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap={geometry.strokeCap}
            strokeLinejoin={geometry.strokeJoin}
            strokeMiterlimit={geometry.miterLimit}
            strokeDasharray={strokeDasharray(nodeStyle.borderStyle, strokeWidth)}
            vectorEffect='non-scaling-stroke'
          />
        </>
      ) : (
        <path
          data-viu-vector-path={geometry.pathData}
          d={geometry.pathData}
          fill={fill}
          fillRule={geometry.fillRule}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap={geometry.strokeCap}
          strokeLinejoin={geometry.strokeJoin}
          strokeMiterlimit={geometry.miterLimit}
          strokeDasharray={strokeDasharray(nodeStyle.borderStyle, strokeWidth)}
          vectorEffect='non-scaling-stroke'
        />
      )}
    </svg>
  );
};

export default ViuVectorGraphic;
