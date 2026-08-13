/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageText } from '@/common/chat/chatLib';
import { TOMNY_FILES_MARKER } from '@/common/config/constants';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { iconColors } from '@/renderer/styles/colors';
import { Alert, Button, Input, Message, Tag, Tooltip } from '@arco-design/web-react';
import { Copy, PreviewOpen } from '@icon-park/react';
import classNames from 'classnames';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/renderer/utils/ui/clipboard';
import CollapsibleContent from '@renderer/components/chat/CollapsibleContent';
import FilePreview from '@renderer/components/media/FilePreview';
import HorizontalFileList from '@renderer/components/media/HorizontalFileList';
import MarkdownView from '@renderer/components/Markdown';
import { stripThinkTags, hasThinkTags } from '@renderer/utils/chat/thinkTagFilter';
import { stripTokenWatermarkNotice } from '@/common/chat/chatLib';
import { stripSkillSuggest, hasSkillSuggest } from '@renderer/utils/chat/skillSuggestParser';
import { getSecretMarkers, renderSecretMarkers } from '@renderer/utils/chat/secretMarkers';
import { coreIdeClient } from '@/renderer/services/coreIdeClient';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';

/**
 * Format a timestamp for message display.
 * Today: "HH:mm", older: "MM-DD HH:mm".
 */
export const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (
    date.getFullYear() !== now.getFullYear() ||
    date.getMonth() !== now.getMonth() ||
    date.getDate() !== now.getDate()
  ) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}-${day} ${time}`;
  }
  return time;
};
import MessageCronBadge from './MessageCronBadge';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import TeammateMessageAvatar from './TeammateMessageAvatar';

const CODE_STYLE = { marginTop: 4, marginBlock: 4 };

const parseFileMarker = (content: string) => {
  const markerIndex = content.indexOf(TOMNY_FILES_MARKER);
  if (markerIndex === -1) {
    return { text: content, files: [] as string[] };
  }
  const text = content.slice(0, markerIndex).trimEnd();
  const afterMarker = content.slice(markerIndex + TOMNY_FILES_MARKER.length).trim();
  const files = afterMarker
    ? afterMarker
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  return { text, files };
};

const isAbsoluteMessageFilePath = (file_path: string): boolean =>
  file_path.startsWith('/') || /^[A-Za-z]:/.test(file_path);

export const resolveMessageFilePath = (file_path: string, workspace?: string): string => {
  if (!file_path || isAbsoluteMessageFilePath(file_path) || !workspace) {
    return file_path;
  }

  const normalizedWorkspace = workspace.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const normalizedFilePath = file_path.replace(/^\.?[\\/]+/, '').replace(/\\/g, '/');
  return `${normalizedWorkspace}/${normalizedFilePath}`.replace(/\/+/g, '/');
};

const useFormatContent = (content: string) => {
  return useMemo(() => {
    try {
      const json = JSON.parse(content);
      const isJson = typeof json === 'object';
      return {
        json: isJson,
        data: isJson ? json : content,
      };
    } catch {
      return { data: content };
    }
  }, [content]);
};
const BUILD0_INPUT_OPEN = '<build0_input>';
const BUILD0_INPUT_CLOSE = '</build0_input>';

export type Build0InputOption = {
  label: string;
  value: string;
  description?: string;
  recommended?: boolean;
};

export type Build0InputQuestion = {
  id: string;
  label: string;
  type: 'single' | 'multi' | 'text';
  required: boolean;
  placeholder?: string;
  options: Build0InputOption[];
};

export type Build0InputRequest = {
  title: string;
  description?: string;
  questions: Build0InputQuestion[];
};

type ParsedBuild0Input = {
  text: string;
  request: Build0InputRequest;
};

const objectValue = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseBuild0Option = (value: unknown): Build0InputOption | null => {
  const record = objectValue(value);
  const label = stringValue(record?.label);
  const optionValue = stringValue(record?.value);
  if (!label || !optionValue) return null;
  return {
    label,
    value: optionValue,
    ...(stringValue(record?.description) ? { description: stringValue(record?.description) } : {}),
    ...(record?.recommended === true ? { recommended: true } : {}),
  };
};

const parseBuild0Question = (value: unknown): Build0InputQuestion | null => {
  const record = objectValue(value);
  const id = stringValue(record?.id);
  const label = stringValue(record?.label);
  const type = record?.type;
  if (!id || !label || (type !== 'single' && type !== 'multi' && type !== 'text')) return null;
  const options = Array.isArray(record?.options)
    ? record.options
        .map(parseBuild0Option)
        .filter((option): option is Build0InputOption => Boolean(option))
        .slice(0, 8)
    : [];
  if (type !== 'text' && options.length === 0) return null;
  return {
    id,
    label,
    type,
    required: record?.required !== false,
    ...(stringValue(record?.placeholder) ? { placeholder: stringValue(record?.placeholder) } : {}),
    options,
  };
};

/** Parse and remove one complete Build0 structured-input marker from an assistant response. */
export const parseBuild0Input = (content: string): ParsedBuild0Input | null => {
  const start = content.indexOf(BUILD0_INPUT_OPEN);
  if (start < 0) return null;
  const end = content.indexOf(BUILD0_INPUT_CLOSE, start + BUILD0_INPUT_OPEN.length);
  if (end < 0) return null;

  try {
    const payload = JSON.parse(content.slice(start + BUILD0_INPUT_OPEN.length, end)) as unknown;
    const record = objectValue(payload);
    const title = stringValue(record?.title);
    const questions = Array.isArray(record?.questions)
      ? record.questions
          .map(parseBuild0Question)
          .filter((question): question is Build0InputQuestion => Boolean(question))
          .slice(0, 6)
      : [];
    if (!title || questions.length === 0) return null;
    return {
      text: (content.slice(0, start) + content.slice(end + BUILD0_INPUT_CLOSE.length)).trim(),
      request: {
        title,
        ...(stringValue(record?.description) ? { description: stringValue(record?.description) } : {}),
        questions,
      },
    };
  } catch {
    return null;
  }
};

type Build0Answer = string | string[];

const Build0StructuredInput: React.FC<{ request: Build0InputRequest }> = ({ request }) => {
  const { t } = useTranslation();
  const { addToSendBox } = usePreviewContext();
  const [answers, setAnswers] = useState<Record<string, Build0Answer>>({});

  const setSingleAnswer = (id: string, value: string): void => {
    setAnswers((current) => ({ ...current, [id]: value }));
  };

  const toggleMultiAnswer = (id: string, value: string): void => {
    setAnswers((current) => {
      const selected = Array.isArray(current[id]) ? current[id] : [];
      return {
        ...current,
        [id]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
      };
    });
  };

  const isAnswered = (question: Build0InputQuestion): boolean => {
    const answer = answers[question.id];
    return Array.isArray(answer) ? answer.length > 0 : Boolean(answer?.trim());
  };
  const canSubmit = request.questions.every((question) => !question.required || isAnswered(question));

  const submit = (): void => {
    if (!canSubmit) return;
    const lines = request.questions.flatMap((question) => {
      const answer = answers[question.id];
      if (!answer || (Array.isArray(answer) && answer.length === 0)) return [];
      const values = Array.isArray(answer) ? answer : [answer];
      const labels = values.map((value) => question.options.find((option) => option.value === value)?.label ?? value);
      return ['- ' + question.label + ': ' + labels.join(', ')];
    });
    addToSendBox([request.title, ...lines].join('\n'));
  };

  return (
    <div
      className='mt-12px w-full max-w-780px rd-16px border border-b-1 bg-bg-2 p-14px shadow-sm'
      data-testid='build0-structured-input'
    >
      <div className='flex items-start justify-between gap-10px'>
        <div className='min-w-0'>
          <div className='text-14px font-700 text-t-primary'>{request.title}</div>
          {request.description ? (
            <div className='mt-3px text-12px leading-relaxed text-t-secondary'>{request.description}</div>
          ) : null}
        </div>
        <Tag color='arcoblue'>Build0</Tag>
      </div>

      <div className='mt-14px flex flex-col gap-14px'>
        {request.questions.map((question) => {
          const answer = answers[question.id];
          return (
            <div key={question.id} className='flex flex-col gap-8px'>
              <div className='text-12px font-650 text-t-primary'>
                {question.label}
                {question.required ? <span className='ml-3px text-danger-6'>*</span> : null}
              </div>
              {question.type === 'text' ? (
                <Input.TextArea
                  value={typeof answer === 'string' ? answer : ''}
                  placeholder={question.placeholder}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  onChange={(value) => setSingleAnswer(question.id, value)}
                />
              ) : (
                <div className='grid grid-cols-1 gap-7px sm:grid-cols-2'>
                  {question.options.map((option) => {
                    const selected = Array.isArray(answer) ? answer.includes(option.value) : answer === option.value;
                    return (
                      <Button
                        key={option.value}
                        type={selected ? 'primary' : 'secondary'}
                        className='!h-auto !min-h-42px !justify-start !whitespace-normal !text-left'
                        onClick={() =>
                          question.type === 'multi'
                            ? toggleMultiAnswer(question.id, option.value)
                            : setSingleAnswer(question.id, option.value)
                        }
                      >
                        <span className='flex flex-col items-start py-3px'>
                          <span className='font-600'>
                            {option.label}
                            {option.recommended ? (
                              <Tag size='small' color='green' className='ml-6px'>
                                {t('ide.build0.structured.recommended')}
                              </Tag>
                            ) : null}
                          </span>
                          {option.description ? (
                            <span className='mt-2px text-11px font-400 opacity-80'>{option.description}</span>
                          ) : null}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className='mt-14px flex justify-end'>
        <Button type='primary' disabled={!canSubmit} onClick={submit}>
          {t('common.confirm')}
        </Button>
      </div>
    </div>
  );
};

const MessageText: React.FC<{ message: IMessageText }> = ({ message }) => {
  // Filter think tags from content before rendering
  // Filter think tags before rendering.
  const contentToRender = useMemo(() => {
    let content = message.content.content;
    if (typeof content === 'string') {
      content = stripTokenWatermarkNotice(content);
      if (hasThinkTags(content)) {
        content = stripThinkTags(content);
      }
      // Strip any inline [SKILL_SUGGEST] blocks (now handled via separate skill_suggest message type)
      if (hasSkillSuggest(content)) {
        content = stripSkillSuggest(content);
      }
      // Cosmetic normalize for display of the *final* assembled text only.
      // Never run this on live streaming deltas (they are appended in hooks/compose
      // before they reach the component).
      content = content
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return content;
    }
    return content;
  }, [message.content.content]);

  const { text, files } = parseFileMarker(contentToRender);
  const { t } = useTranslation();
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  const [locallyRevealedText, setLocallyRevealedText] = useState<string | null>(null);
  const [unavailableSecrets, setUnavailableSecrets] = useState<Set<string>>(() => new Set());
  const [revealingSecret, setRevealingSecret] = useState<string | null>(null);
  const isUserMessage = message.position === 'right';
  const isTeammateMessage = message.position === 'left' && message.content.teammateMessage === true;
  const shouldRenderPlainText = isUserMessage;
  const conversationContext = useConversationContextSafe();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const secretMarkers = useMemo(() => (isUserMessage ? [] : getSecretMarkers(text)), [isUserMessage, text]);
  const renderedText = useMemo(
    () =>
      locallyRevealedText ??
      renderSecretMarkers(text, {}, unavailableSecrets, (alias) => t('ide.memory.secret.chatUnavailable', { alias })),
    [locallyRevealedText, t, text, unavailableSecrets]
  );
  const build0Input = useMemo(
    () => (isUserMessage ? null : parseBuild0Input(renderedText)),
    [isUserMessage, renderedText]
  );
  const displayText = build0Input?.text ?? renderedText;
  const { data, json } = useFormatContent(displayText);

  useEffect(() => {
    setLocallyRevealedText(null);
    setUnavailableSecrets(new Set());
  }, [text]);

  const resolvedFiles = useMemo(
    () => files.map((file_path) => resolveMessageFilePath(file_path, conversationContext?.workspace)),
    [conversationContext?.workspace, files]
  );

  // Skip empty content to avoid rendering an empty DOM node.
  if (!message.content.content || (typeof message.content.content === 'string' && !message.content.content.trim())) {
    return null;
  }

  const handleCopy = () => {
    // Copy the persisted opaque marker, never a value revealed only in this local view.
    const baseText = shouldRenderPlainText ? text : json ? JSON.stringify(data, null, 2) : displayText;
    const fileList = files.length ? `Files:\n${files.map((path) => `- ${path}`).join('\n')}\n\n` : '';
    const textToCopy = fileList + baseText;
    copyText(textToCopy)
      .then(() => {
        setShowCopyAlert(true);
        setTimeout(() => setShowCopyAlert(false), 2000);
      })
      .catch(() => {
        Message.error(t('common.copyFailed'));
      });
  };

  const handleSecretReveal = async (): Promise<void> => {
    if (!conversationContext?.workspace || revealingSecret) return;
    if (locallyRevealedText !== null) {
      setLocallyRevealedText(null);
      return;
    }

    setRevealingSecret('all');
    const response = await coreIdeClient
      .repoSecretRenderMarkers(conversationContext.workspace, text)
      .catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    setRevealingSecret(null);
    if ('error' in response) {
      setUnavailableSecrets(new Set(secretMarkers.map(({ alias }) => alias)));
      Message.error(response.error);
      return;
    }
    setUnavailableSecrets(new Set());
    setLocallyRevealedText(response.data.text);
  };

  const copyButton = (
    <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
      <div
        className='p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
        onClick={handleCopy}
        style={{ lineHeight: 0 }}
      >
        <Copy theme='outline' size='16' fill={iconColors.secondary} />
      </div>
    </Tooltip>
  );

  const cronMeta = message.content.cronMeta;
  const senderName = message.content.senderName;
  const senderAgentType = message.content.senderAgentType;
  const senderConversationId = message.content.senderConversationId;
  const fallbackBackendLogo = senderAgentType ? getAgentLogo(senderAgentType) : null;

  return (
    <>
      <div className={classNames('min-w-0 flex flex-col group', isUserMessage ? 'items-end' : 'items-start')}>
        {cronMeta && <MessageCronBadge meta={cronMeta} />}
        {isTeammateMessage && senderName && (
          <div className='flex items-center gap-6px mb-4px'>
            <TeammateMessageAvatar
              senderName={senderName}
              senderConversationId={senderConversationId}
              backendLogo={fallbackBackendLogo}
            />
            <span className='text-12px text-t-secondary'>{senderName}</span>
          </div>
        )}
        {files.length > 0 && (
          <div className={classNames('mt-6px', { 'self-end': isUserMessage })}>
            {resolvedFiles.length === 1 ? (
              <div className='flex items-center'>
                <FilePreview path={resolvedFiles[0]} onRemove={() => undefined} readonly />
              </div>
            ) : (
              <HorizontalFileList>
                {resolvedFiles.map((path) => (
                  <FilePreview key={path} path={path} onRemove={() => undefined} readonly />
                ))}
              </HorizontalFileList>
            )}
          </div>
        )}
        {secretMarkers.length > 0 && (
          <div className='mb-6px flex flex-wrap items-center gap-6px'>
            {secretMarkers.map(({ alias }) => (
              <Button
                key={alias}
                size='mini'
                icon={<PreviewOpen theme='outline' size={13} />}
                loading={revealingSecret !== null}
                disabled={!conversationContext?.workspace}
                onClick={() => void handleSecretReveal()}
              >
                {locallyRevealedText !== null
                  ? t('ide.memory.secret.chatHide', { alias })
                  : t('ide.memory.secret.chatReveal', { alias })}
              </Button>
            ))}
          </div>
        )}
        <div
          className={classNames('min-w-0 [&>p:first-child]:mt-0px [&>p:last-child]:mb-0px md:max-w-780px', {
            'bg-aou-2 p-6px md:p-8px': isUserMessage || cronMeta,
            'bg-3 p-6px md:p-8px': isTeammateMessage,
            'w-full': !(isUserMessage || cronMeta || isTeammateMessage),
          })}
          style={{
            ...(isUserMessage || cronMeta
              ? { borderRadius: '8px 0 8px 8px', color: 'var(--text-primary)' }
              : isTeammateMessage
                ? { borderRadius: '0 8px 8px 8px' }
                : undefined),
          }}
        >
          {/* Use CollapsibleContent for JSON content. */}
          {shouldRenderPlainText ? (
            <div className='whitespace-pre-wrap break-words' data-testid='message-text-content'>
              {text}
            </div>
          ) : json ? (
            <CollapsibleContent maxHeight={200} defaultCollapsed={true}>
              <div data-testid='message-text-content'>
                <MarkdownView
                  codeStyle={CODE_STYLE}
                >{`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}</MarkdownView>
              </div>
            </CollapsibleContent>
          ) : (
            <div data-testid='message-text-content'>
              <MarkdownView codeStyle={CODE_STYLE}>{data}</MarkdownView>
            </div>
          )}
          {build0Input ? <Build0StructuredInput request={build0Input.request} /> : null}
        </div>
        {/* Hover-revealed copy + timestamp row. Mobile has no hover affordance,
            so we drop the row entirely; system-level long-press still copies. */}
        {!isMobile && (
          <div
            className={classNames('h-32px flex items-center mt-4px gap-8px', {
              'flex-row-reverse': isUserMessage,
            })}
          >
            {copyButton}
            {message.created_at && (
              <span className='text-12px text-t-secondary opacity-0 group-hover:opacity-100 transition-opacity select-none'>
                {formatMessageTime(message.created_at)}
              </span>
            )}
          </div>
        )}
      </div>
      {showCopyAlert && (
        <Alert
          type='success'
          content={t('messages.copySuccess')}
          showIcon
          className='fixed top-20px left-50% transform -translate-x-50% z-9999 w-max max-w-[80%]'
          style={{ boxShadow: '0px 2px 12px rgba(0,0,0,0.12)' }}
          closable={false}
        />
      )}
    </>
  );
};

export default MessageText;
