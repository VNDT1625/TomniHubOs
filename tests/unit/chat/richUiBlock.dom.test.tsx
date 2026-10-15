import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RichUiBlock from '@/renderer/components/Markdown/richUi/RichUiBlock';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));

afterEach(cleanup);

describe('assistant rich UI renderer', () => {
  it('renders metrics and parallel workflow without interpreting agent HTML', () => {
    render(
      <RichUiBlock
        source={JSON.stringify({
          version: 1,
          title: 'MCP flow',
          fallbackText: 'AI -> Gateway -> Read + Search',
          blocks: [
            { type: 'metrics', items: [{ label: 'Latency', value: '2.5s' }] },
            {
              type: 'flow',
              steps: [{ title: 'AI' }, { title: 'Gateway', parallel: ['Read', 'Search'] }, { title: 'Done' }],
            },
            { type: 'cards', items: [{ title: '<script>alert(1)</script>', description: 'No execution' }] },
          ],
        })}
      />
    );
    expect(screen.getByTestId('rich-ui-block')).toBeInTheDocument();
    expect(screen.getByText('Latency')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.queryByRole('script')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByText('Xem bản văn bản'));
    expect(screen.getByText('AI -> Gateway -> Read + Search')).toBeInTheDocument();
  });

  it('renders a bounded, accessible interactive lesson with reveal and navigation', () => {
    render(
      <RichUiBlock
        source={JSON.stringify({
          version: 1,
          title: 'Làm quen MCP',
          fallbackText: 'MCP là giao thức kết nối.',
          blocks: [
            {
              type: 'lesson',
              slides: [
                { title: 'Câu 1', body: 'Gateway làm gì?', reveal: 'Điều phối và kiểm tra quyền.' },
                { title: 'Câu 2', body: 'Công cụ chạy thế nào?', reveal: 'Có thể chạy đồng thời.' },
              ],
            },
          ],
        })}
      />
    );
    expect(screen.getByTestId('rich-ui-lesson')).toBeInTheDocument();
    expect(screen.getByText('Câu 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hiện giải thích / đáp án' }));
    expect(screen.getByText('Điều phối và kiểm tra quyền.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo' }));
    expect(screen.getByText('Câu 2')).toBeInTheDocument();
    expect(screen.queryByText('Điều phối và kiểm tra quyền.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByText('Câu 1')).toBeInTheDocument();
  });

  it('renders long Markdown safely and lets the learner choose, check and revisit a multiple-choice answer', () => {
    render(
      <RichUiBlock
        source={JSON.stringify({
          version: 1,
          title: 'MCP quiz',
          fallbackText: 'MCP choices',
          blocks: [
            {
              type: 'lesson',
              slides: [
                {
                  title: 'MCQ',
                  body: '### Kiến thức **quan trọng**\n\nĐoạn dài không có khoảng trống: ' + 'x'.repeat(250),
                  question: 'MCP là gì?',
                  options: ['API đóng', 'Giao thức mở', 'Game engine', 'Trình duyệt'],
                  correctIndex: 1,
                  reveal: '**MCP** là giao thức mở.',
                },
                { title: 'Bài tiếp', body: 'Nội dung thứ hai' },
              ],
            },
          ],
        })}
      />
    );
    expect(screen.getByRole('heading', { name: /Kiến thức quan trọng/ })).toBeInTheDocument();
    expect(screen.queryByText('### Kiến thức')).toBeNull();
    expect(screen.getByText(/Đoạn dài không có khoảng trống/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Kiểm tra đáp án' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Giao thức mở/));
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra đáp án' }));
    expect(screen.getByText('Chính xác!')).toBeInTheDocument();
    expect(screen.getByText(/là giao thức mở/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByText('Chính xác!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trả lời lại' }));
    expect(screen.getByRole('button', { name: 'Kiểm tra đáp án' })).toBeDisabled();
  });

  it('accepts free-form answers without falsely auto-grading them', () => {
    render(
      <RichUiBlock
        source={JSON.stringify({
          version: 1,
          title: 'Viết',
          fallbackText: 'Tự luận',
          blocks: [
            {
              type: 'lesson',
              slides: [
                {
                  title: 'Tự luận',
                  body: 'Giải thích cách hoạt động.',
                  question: 'Bạn hiểu thế nào?',
                  allowTextAnswer: true,
                  reveal: 'Một câu trả lời tham khảo.',
                },
                { title: 'Kết thúc', body: 'Hoàn thành!' },
              ],
            },
          ],
        })}
      />
    );
    const input = screen.getByRole('textbox', { name: 'Câu trả lời của bạn' });
    fireEvent.change(input, { target: { value: 'Trả lời của tôi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi câu trả lời' }));
    expect(screen.getByText(/Đã ghi nhận câu trả lời/)).toBeInTheDocument();
    expect(screen.getByText('Một câu trả lời tham khảo.')).toBeInTheDocument();
  });

  it('renders a structured comparison as a semantic table', () => {
    render(
      <RichUiBlock
        source={JSON.stringify({
          version: 1,
          title: 'Compare',
          fallbackText: 'Read faster',
          blocks: [
            {
              type: 'table',
              columns: ['Tool', 'Time'],
              rows: [
                ['Read', '1.6s'],
                ['Map', '2s'],
              ],
            },
          ],
        })}
      />
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Time' })).toBeInTheDocument();
  });

  it('falls back to text for malformed or unsupported component input', () => {
    render(
      <RichUiBlock
        source={JSON.stringify({
          version: 99,
          title: 'Unknown',
          fallbackText: 'Readable fallback',
          blocks: [{ type: 'custom', code: 'alert(1)' }],
        })}
      />
    );
    expect(screen.getByTestId('rich-ui-fallback')).toBeInTheDocument();
    expect(screen.getByText('Readable fallback')).toBeInTheDocument();
  });
});
