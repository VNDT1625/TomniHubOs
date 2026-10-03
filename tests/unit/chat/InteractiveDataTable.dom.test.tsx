/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InteractiveDataTable, {
  exportTableToCsv,
} from '../../../packages/desktop/src/renderer/components/chat/InteractiveDataTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue || k }),
}));

describe('InteractiveDataTable', () => {
  const headers = ['Tên', 'Tuổi', 'Thành phố'];
  const rows = [
    ['An', '25', 'Hà Nội'],
    ['Bình', '19', 'Đà Nẵng'],
    ['Cường', '30', 'TP.HCM'],
  ];

  it('renders table headers and rows correctly', () => {
    render(<InteractiveDataTable headers={headers} rows={rows} title='Danh sách' />);

    expect(screen.getByText('Danh sách (3 dòng)')).toBeDefined();
    expect(screen.getByText('An')).toBeDefined();
    expect(screen.getByText('Bình')).toBeDefined();
    expect(screen.getByText('Cường')).toBeDefined();
  });

  it('filters rows when typing in search box', () => {
    render(<InteractiveDataTable headers={headers} rows={rows} />);

    const searchInput = screen.getByPlaceholderText('Tìm kiếm...');
    fireEvent.change(searchInput, { target: { value: 'Đà Nẵng' } });

    expect(screen.getByText('Bình')).toBeDefined();
    expect(screen.queryByText('An')).toBeNull();
    expect(screen.queryByText('Cường')).toBeNull();
  });

  it('sorts rows when clicking column header', () => {
    render(<InteractiveDataTable headers={headers} rows={rows} />);

    const ageHeader = screen.getByText('Tuổi');
    // Click once for ascending numeric sort
    fireEvent.click(ageHeader);

    const cells = screen.getAllByRole('cell');
    // First row should be Bình with age 19
    expect(cells[0].textContent).toBe('Bình');
    expect(cells[1].textContent).toBe('19');
  });

  it('exports CSV without throwing', () => {
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURLSpy = vi.fn();
    window.URL.createObjectURL = createObjectURLSpy;
    window.URL.revokeObjectURL = revokeObjectURLSpy;

    expect(() => exportTableToCsv(headers, rows, 'test.csv')).not.toThrow();
    expect(createObjectURLSpy).toHaveBeenCalled();
  });
});
