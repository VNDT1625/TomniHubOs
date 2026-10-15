/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Files a paired Telegram user sends to the agent: what is accepted and where it is kept. */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Folder inside the chat's workspace that holds received files, so the agent can read them with its tools. */
export const TELEGRAM_UPLOAD_DIRECTORY = 'telegram-uploads';

type TelegramPhotoSize = Readonly<{ file_id: string; file_size?: number; width?: number; height?: number }>;
type TelegramDocument = Readonly<{ file_id: string; file_name?: string; mime_type?: string; file_size?: number }>;

export type TelegramAttachmentMessage = Readonly<{
  photo?: readonly TelegramPhotoSize[];
  document?: TelegramDocument;
  video?: Readonly<{ file_id: string }>;
  video_note?: Readonly<{ file_id: string }>;
  animation?: Readonly<{ file_id: string }>;
  sticker?: Readonly<{ file_id: string }>;
}>;

export type TelegramAttachment = Readonly<{ fileId: string; name: string; size?: number }>;

export type AttachmentPick =
  | { kind: 'none' }
  | { kind: 'file'; attachment: TelegramAttachment }
  | { kind: 'rejected'; reason: string };

/** Images, PDFs, plain text and office documents: things an agent reads. Programs and archives are refused. */
const ACCEPTED_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|bmp|pdf|txt|md|csv|tsv|json|ya?ml|xml|log|html?|docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/iu;

const sizeLabel = `${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;

/** Keeps a received name readable but makes it a single safe file name. */
export const safeAttachmentName = (name: string): string => {
  const base = name.split(/[\\/]/u).at(-1) ?? '';
  const cleaned = Array.from(base.normalize('NFC'))
    .map((char) => (/[\p{L}\p{N}._ -]/u.test(char) ? char : '_'))
    .join('')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '')
    .slice(-120);
  return cleaned || 'file';
};

/** Chooses what to download from a message, or says why it cannot be used. */
export const pickAttachment = (message: TelegramAttachmentMessage): AttachmentPick => {
  if (message.photo && message.photo.length > 0) {
    const fitting = message.photo.filter((size) => (size.file_size ?? 0) <= MAX_ATTACHMENT_BYTES);
    const largest = fitting.toSorted((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
    if (!largest) return { kind: 'rejected', reason: `Ảnh lớn hơn ${sizeLabel}.` };
    return { kind: 'file', attachment: { fileId: largest.file_id, name: 'photo.jpg', size: largest.file_size } };
  }
  if (message.document) {
    const name = safeAttachmentName(message.document.file_name ?? '');
    if (!ACCEPTED_EXTENSION.test(name)) {
      return {
        kind: 'rejected',
        reason: 'Chỉ nhận ảnh, PDF, văn bản và tài liệu Office; chương trình và tệp nén bị từ chối.',
      };
    }
    if ((message.document.file_size ?? 0) > MAX_ATTACHMENT_BYTES) {
      return { kind: 'rejected', reason: `Tệp lớn hơn ${sizeLabel}.` };
    }
    return { kind: 'file', attachment: { fileId: message.document.file_id, name, size: message.document.file_size } };
  }
  if (message.video || message.video_note || message.animation) {
    return { kind: 'rejected', reason: 'Agent chưa xem được video. Hãy gửi ảnh chụp màn hình hoặc mô tả bằng chữ.' };
  }
  if (message.sticker) return { kind: 'rejected', reason: 'Sticker không được gửi cho agent.' };
  return { kind: 'none' };
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** `20261005-093015-photo.jpg`: sorted by arrival, never overwriting an earlier file. */
export const storedAttachmentName = (name: string, at: Date, unique: string): string =>
  `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-${unique}-${safeAttachmentName(name)}`;

/** Splits a long reply into Telegram-sized messages, preferring line breaks; at most `maxParts` parts. */
export const splitTelegramText = (text: string, limit = 4096, maxParts = 5): string[] => {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 0 && parts.length < maxParts) {
    if (rest.length <= limit) {
      parts.push(rest);
      return parts;
    }
    const cut = rest.lastIndexOf('\n', limit);
    const end = cut > limit / 2 ? cut : limit;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^\n/u, '');
  }
  if (rest.length > 0) {
    const notice = '\n…(còn tiếp, mở Tomny để xem đầy đủ)';
    parts[parts.length - 1] = `${parts.at(-1)?.slice(0, limit - notice.length)}${notice}`;
  }
  return parts;
};
