/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Button, Input, Tooltip } from '@arco-design/web-react';
import { Download, Search, Up, Down } from '@icon-park/react';
import { useTranslation } from 'react-i18next';

export interface InteractiveDataTableProps {
  headers: string[];
  rows: string[][];
  title?: string;
}

export function exportTableToCsv(headers: string[], rows: string[][], filename = 'data_export.csv'): void {
  const escapeCell = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const headerLine = headers.map(escapeCell).join(',');
  const rowLines = rows.map((row) => row.map(escapeCell).join(','));
  const csvContent = '\uFEFF' + [headerLine, ...rowLines].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const InteractiveDataTable: React.FC<InteractiveDataTableProps> = ({ headers, rows, title }) => {
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (colIndex: number) => {
    if (sortCol === colIndex) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortCol(null);
        setSortDir('asc');
      }
    } else {
      setSortCol(colIndex);
      setSortDir('asc');
    }
  };

  const filteredAndSortedRows = useMemo(() => {
    let result = [...rows];

    // Filter
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      result = result.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)));
    }

    // Sort
    if (sortCol !== null) {
      result.sort((a, b) => {
        const valA = a[sortCol] || '';
        const valB = b[sortCol] || '';
        const numA = Number(valA);
        const numB = Number(valB);

        let cmp = 0;
        if (!isNaN(numA) && !isNaN(numB)) {
          cmp = numA - numB;
        } else {
          cmp = valA.localeCompare(valB);
        }

        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, filterText, sortCol, sortDir]);

  const handleExportCsv = () => {
    exportTableToCsv(headers, filteredAndSortedRows, `${title || 'export'}.csv`);
  };

  return (
    <div
      className='my-10px rd-12px b-1 b-solid overflow-hidden shadow-sm'
      style={{
        background: 'var(--bg-1)',
        borderColor: 'var(--color-border-2)',
      }}
      data-testid='interactive-data-table'
    >
      {/* Table Toolbar */}
      <div
        className='flex items-center justify-between p-8px b-b-1 b-solid gap-8px'
        style={{
          borderColor: 'var(--color-border-2)',
          background: 'var(--bg-2)',
        }}
      >
        <div className='text-13px font-600 text-t-primary truncate'>
          {title || t('messages.table.title', { defaultValue: 'Bảng dữ liệu' })} ({filteredAndSortedRows.length} dòng)
        </div>

        <div className='flex items-center gap-8px'>
          <Input
            size='mini'
            prefix={<Search theme='outline' size='12' />}
            placeholder={t('common.search', { defaultValue: 'Tìm kiếm...' })}
            value={filterText}
            onChange={setFilterText}
            allowClear
            style={{ width: 140 }}
          />

          <Tooltip content={t('messages.table.exportCsv', { defaultValue: 'Xuất CSV / Excel' })}>
            <Button
              size='mini'
              type='secondary'
              icon={<Download theme='outline' size='14' />}
              onClick={handleExportCsv}
              data-testid='export-csv-btn'
            >
              CSV
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Table Container */}
      <div className='overflow-x-auto max-w-full'>
        <table
          className='w-full text-left'
          style={{
            borderCollapse: 'collapse',
            fontSize: '13px',
          }}
        >
          <thead>
            <tr
              style={{
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--color-border-2)',
              }}
            >
              {headers.map((header, idx) => {
                const isSorted = sortCol === idx;
                return (
                  <th
                    key={idx}
                    className='p-8px font-600 text-t-primary cursor-pointer select-none hover:bg-fill-2 transition-colors'
                    onClick={() => handleSort(idx)}
                    title='Bấm để sắp xếp'
                  >
                    <div className='flex items-center gap-4px'>
                      <span>{header}</span>
                      {isSorted ? (
                        sortDir === 'asc' ? (
                          <Up theme='filled' size='12' fill='rgb(var(--primary-6))' />
                        ) : (
                          <Down theme='filled' size='12' fill='rgb(var(--primary-6))' />
                        )
                      ) : (
                        <div className='w-12px h-12px opacity-20'>↕</div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedRows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className='p-16px text-center text-t-tertiary text-12px'>
                  {t('common.noData', { defaultValue: 'Không có dữ liệu phù hợp' })}
                </td>
              </tr>
            ) : (
              filteredAndSortedRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className='hover:bg-fill-1 transition-colors'
                  style={{
                    borderBottom: '1px solid var(--color-border-1)',
                  }}
                >
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className='p-8px text-t-primary'>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InteractiveDataTable;
