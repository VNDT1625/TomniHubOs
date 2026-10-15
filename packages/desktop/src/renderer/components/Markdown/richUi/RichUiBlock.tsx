/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { useTranslation } from 'react-i18next';
import { parseRichUiSpec, type RichUiPart, type RichUiLessonSlide } from './richUiSpec';
import ImageGallery from './ImageGallery';

type LessonAnswer = { selected?: number; text?: string; submitted?: boolean; revealed?: boolean };

/** Markdown is display-only here: links and images cannot fetch content or navigate. */
const LessonCopy: React.FC<{ content: string }> = ({ content }) => (
  <div className='tomni-rich-ui-lesson-copy'>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a: ({ children }) => <span>{children}</span>,
        img: () => null,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const RichUiLesson: React.FC<{ slides: readonly RichUiLessonSlide[] }> = ({ slides }) => {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, LessonAnswer>>({});
  const slide = slides[index];
  const answer = answers[index] ?? {};
  const patchAnswer = (patch: Partial<LessonAnswer>) =>
    setAnswers((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));
  const hasOptions = !!slide.options;
  const hasInput = slide.allowTextAnswer === true;
  const submitted = answer.submitted === true;
  const correct = submitted && hasOptions && answer.selected === slide.correctIndex;
  const hasQuiz = hasOptions || hasInput;

  return (
    <section className='tomni-rich-ui-lesson' data-testid='rich-ui-lesson' aria-label='Bài học tương tác'>
      <div className='tomni-rich-ui-lesson-progress'>
        Bước {index + 1} / {slides.length}
      </div>
      <div className='tomni-rich-ui-lesson-slide' key={index} aria-live='polite'>
        <strong>{slide.title}</strong>
        <LessonCopy content={slide.body} />
        {slide.question && (
          <div className='tomni-rich-ui-lesson-question'>
            <LessonCopy content={slide.question} />
          </div>
        )}
        {hasOptions && (
          <div className='tomni-rich-ui-lesson-options' role='group' aria-label='Chọn một đáp án'>
            {slide.options!.map((option, optionIndex) => (
              <label className='tomni-rich-ui-lesson-option' key={optionIndex}>
                <input
                  type='radio'
                  name={`lesson-answer-${index}`}
                  checked={answer.selected === optionIndex}
                  disabled={submitted}
                  onChange={() => patchAnswer({ selected: optionIndex })}
                />
                <span className='tomni-rich-ui-lesson-option-marker'>{String.fromCharCode(65 + optionIndex)}.</span>
                <span>{option}</span>
              </label>
            ))}
          </div>
        )}
        {hasInput && (
          <label className='tomni-rich-ui-lesson-input-label'>
            Câu trả lời của bạn
            <textarea
              rows={3}
              maxLength={1500}
              value={answer.text ?? ''}
              disabled={submitted}
              placeholder='Nhập câu trả lời tại đây…'
              onChange={(event) => patchAnswer({ text: event.target.value })}
            />
          </label>
        )}
        {hasQuiz && !submitted && (
          <button
            type='button'
            className='tomni-rich-ui-lesson-submit'
            disabled={hasOptions ? answer.selected === undefined : !answer.text?.trim()}
            onClick={() => patchAnswer({ submitted: true, revealed: true })}
          >
            {hasOptions ? 'Kiểm tra đáp án' : 'Gửi câu trả lời'}
          </button>
        )}
        {submitted && (
          <div className='tomni-rich-ui-lesson-feedback' role='status'>
            {hasOptions
              ? correct
                ? 'Chính xác!'
                : 'Chưa đúng. Hãy xem phần giải thích.'
              : 'Đã ghi nhận câu trả lời. Hãy tự đối chiếu với phần gợi ý bên dưới.'}
            <button type='button' onClick={() => setAnswers((prev) => ({ ...prev, [index]: {} }))}>
              Trả lời lại
            </button>
          </div>
        )}
        {slide.reveal && (
          <div className='tomni-rich-ui-lesson-reveal'>
            {answer.revealed || submitted ? (
              <div role='status'>
                <LessonCopy content={slide.reveal} />
              </div>
            ) : (
              <button type='button' onClick={() => patchAnswer({ revealed: true })}>
                Hiện giải thích / đáp án
              </button>
            )}
          </div>
        )}
      </div>
      <div className='tomni-rich-ui-lesson-actions'>
        <button type='button' disabled={index === 0} onClick={() => setIndex((v) => v - 1)}>
          Quay lại
        </button>
        <button type='button' disabled={index === slides.length - 1} onClick={() => setIndex((v) => v + 1)}>
          Tiếp theo
        </button>
      </div>
    </section>
  );
};

const RichUiPartView: React.FC<{ block: RichUiPart }> = ({ block }) => {
  switch (block.type) {
    case 'metrics':
      return (
        <div className='tomni-rich-ui-grid tomni-rich-ui-metrics'>
          {block.items.map((item, index) => (
            <div className={`tomni-rich-ui-tile tomni-rich-ui-tone-${item.tone ?? 'neutral'}`} key={index}>
              <div className='tomni-rich-ui-muted'>{item.label}</div>
              <div className='tomni-rich-ui-value' title={item.value}>
                {item.value}
              </div>
              {item.detail && <div className='tomni-rich-ui-muted'>{item.detail}</div>}
            </div>
          ))}
        </div>
      );
    case 'flow':
      return (
        <ol className='tomni-rich-ui-flow'>
          {block.steps.map((step, index) => (
            <li className='tomni-rich-ui-flow-step' key={index}>
              <div className='tomni-rich-ui-flow-node'>
                <strong>{step.title}</strong>
                {step.description && <span className='tomni-rich-ui-muted'>{step.description}</span>}
                {step.parallel && (
                  <ul className='tomni-rich-ui-parallel'>
                    {step.parallel.map((label, childIndex) => (
                      <li key={childIndex}>{label}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      );
    case 'cards':
      return (
        <div className='tomni-rich-ui-grid tomni-rich-ui-cards'>
          {block.items.map((item, index) => (
            <div className={`tomni-rich-ui-tile tomni-rich-ui-tone-${item.tone ?? 'neutral'}`} key={index}>
              {item.tag && <span className='tomni-rich-ui-tag'>{item.tag}</span>}
              <strong>{item.title}</strong>
              <p className='tomni-rich-ui-muted'>{item.description}</p>
            </div>
          ))}
        </div>
      );
    case 'lesson':
      return <RichUiLesson slides={block.slides} />;
    case 'gallery':
      return <ImageGallery images={block.images} targetCount={block.targetCount} />;
    case 'table':
      return (
        <div className='tomni-rich-ui-table-scroll'>
          <table className='tomni-rich-ui-table'>
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th scope='col' key={index}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
};

/**
 * Render a curated assistant-facing UI. AI output is strictly data, never JS, HTML,
 * event handlers or capability grants. Invalid/unsupported payloads stay readable.
 */
const RichUiBlock: React.FC<{ source: string }> = ({ source }) => {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseRichUiSpec(source), [source]);
  if (parsed.ok === false) {
    return (
      <div className='tomni-rich-ui tomni-rich-ui-fallback' data-testid='rich-ui-fallback' role='status'>
        <div>
          {t('messages.richUiUnavailable', {
            defaultValue: 'Không thể hiển thị giao diện; đang hiển thị nội dung văn bản.',
          })}
        </div>
        <pre>{parsed.fallbackText}</pre>
      </div>
    );
  }
  const { spec } = parsed;
  return (
    <section className='tomni-rich-ui' aria-label={spec.title} data-testid='rich-ui-block'>
      <header className='tomni-rich-ui-header'>
        <strong>{spec.title}</strong>
        {spec.description && <p className='tomni-rich-ui-muted'>{spec.description}</p>}
      </header>
      <div className='tomni-rich-ui-body'>
        {spec.blocks.map((block, index) => (
          <RichUiPartView key={index} block={block} />
        ))}
      </div>
      <details className='tomni-rich-ui-details'>
        <summary>{t('messages.richUiTextVersion', { defaultValue: 'Xem bản văn bản' })}</summary>
        <p>{spec.fallbackText}</p>
      </details>
    </section>
  );
};

export default RichUiBlock;
