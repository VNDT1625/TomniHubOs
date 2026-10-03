/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Card, Radio, Tag, Tooltip } from '@arco-design/web-react';
import { Check, CheckOne, Code, Copy } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

export interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'header';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface SplitDiffRow {
  left?: { lineNumber?: number; content: string; type: 'delete' | 'context' };
  right?: { lineNumber?: number; content: string; type: 'add' | 'context' };
}

export function parseDiffLines(diffText: string): { unified: DiffLine[]; split: SplitDiffRow[] } {
  const lines = diffText.split('\n');
  const unified: DiffLine[] = [];
  const split: SplitDiffRow[] = [];

  let oldLine = 1;
  let newLine = 1;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      unified.push({ type: 'header', content: line });
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      continue;
    }

    if (line.startsWith('+')) {
      const content = line.slice(1);
      unified.push({ type: 'add', newLineNumber: newLine, content });
      split.push({
        right: { lineNumber: newLine, content, type: 'add' },
      });
      newLine++;
    } else if (line.startsWith('-')) {
      const content = line.slice(1);
      unified.push({ type: 'delete', oldLineNumber: oldLine, content });
      split.push({
        left: { lineNumber: oldLine, content, type: 'delete' },
      });
      oldLine++;
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      unified.push({ type: 'context', oldLineNumber: oldLine, newLineNumber: newLine, content });
      split.push({
        left: { lineNumber: oldLine, content, type: 'context' },
        right: { lineNumber: newLine, content, type: 'context' },
      });
      oldLine++;
      newLine++;
    }
  }

  return { unified, split };
}

export interface CodeDiffViewerProps {
  diff: string;
  fileName?: string;
  onApplyPatch?: (diff: string) => Promise<void>;
}

export const CodeDiffViewer: React.FC<CodeDiffViewerProps> = ({ diff, fileName, onApplyPatch }) => {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [isApplying, setIsApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const { unified, split } = useMemo(() => parseDiffLines(diff), [diff]);

  const handleApply = async () => {
    if (!onApplyPatch) return;
    setIsApplying(true);
    try {
      await onApplyPatch(diff);
      setApplied(true);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Card
      className='my-10px rd-12px b-1 b-solid overflow-hidden'
      style={{
        background: 'var(--bg-1)',
        borderColor: 'var(--color-border-2)',
      }}
      data-testid='code-diff-viewer'
    >
      {/* Diff Toolbar */}
      <div
        className='flex items-center justify-between p-8px b-b-1 b-solid gap-8px'
        style={{
          borderColor: 'var(--color-border-2)',
          background: 'var(--bg-2)',
        }}
      >
        <div className='flex items-center gap-6px min-w-0'>
          <Code theme='outline' size='16' />
          <span className='font-600 text-13px text-t-primary truncate'>{fileName || 'Diff Changes'}</span>
          {applied && (
            <Tag color='green' size='small'>
              ✓ {t('common.applied', { defaultValue: 'Đã áp dụng' })}
            </Tag>
          )}
        </div>

        <div className='flex items-center gap-8px'>
          <Radio.Group type='button' size='mini' value={viewMode} onChange={setViewMode}>
            <Radio value='unified'>Unified</Radio>
            <Radio value='split'>Split</Radio>
          </Radio.Group>

          {onApplyPatch && !applied && (
            <Button size='mini' type='primary' loading={isApplying} onClick={handleApply} data-testid='apply-patch-btn'>
              {t('messages.diff.applyPatch', { defaultValue: 'Áp dụng Patch' })}
            </Button>
          )}
        </div>
      </div>

      {/* Code Container */}
      <div
        className='overflow-x-auto max-w-full font-mono text-12px leading-20px'
        style={{ background: 'var(--bg-1)' }}
      >
        {viewMode === 'unified' ? (
          <div className='flex flex-col'>
            {unified.map((line, idx) => {
              if (line.type === 'header') {
                return (
                  <div key={idx} className='px-8px py-2px bg-fill-2 text-t-secondary font-600 select-none'>
                    {line.content}
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  className={classNames('flex items-center px-4px', {
                    'bg-success-light-1 text-success-6': line.type === 'add',
                    'bg-danger-light-1 text-danger-6': line.type === 'delete',
                    'text-t-primary': line.type === 'context',
                  })}
                >
                  <span className='w-40px flex-shrink-0 text-right pr-8px select-none opacity-40'>
                    {line.oldLineNumber || ''}
                  </span>
                  <span className='w-40px flex-shrink-0 text-right pr-8px select-none opacity-40'>
                    {line.newLineNumber || ''}
                  </span>
                  <span className='w-16px select-none font-bold'>
                    {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                  </span>
                  <span className='whitespace-pre overflow-visible'>{line.content}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className='flex flex-col'>
            {split.map((row, idx) => (
              <div key={idx} className='flex w-full b-b-1 b-solid border-border-1'>
                {/* Left pane: deleted or context */}
                <div
                  className={classNames('flex-1 flex items-center px-4px border-r border-border-2', {
                    'bg-danger-light-1 text-danger-6': row.left?.type === 'delete',
                    'text-t-primary': row.left?.type === 'context',
                    'bg-fill-1': !row.left,
                  })}
                >
                  <span className='w-36px flex-shrink-0 text-right pr-8px select-none opacity-40'>
                    {row.left?.lineNumber || ''}
                  </span>
                  <span className='whitespace-pre overflow-visible'>{row.left?.content || ''}</span>
                </div>

                {/* Right pane: added or context */}
                <div
                  className={classNames('flex-1 flex items-center px-4px', {
                    'bg-success-light-1 text-success-6': row.right?.type === 'add',
                    'text-t-primary': row.right?.type === 'context',
                    'bg-fill-1': !row.right,
                  })}
                >
                  <span className='w-36px flex-shrink-0 text-right pr-8px select-none opacity-40'>
                    {row.right?.lineNumber || ''}
                  </span>
                  <span className='whitespace-pre overflow-visible'>{row.right?.content || ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default CodeDiffViewer;
