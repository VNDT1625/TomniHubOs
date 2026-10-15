/**
 * Renderer-safe result of a bounded Main-owned attachment quick view.
 * The result never grants filesystem access or carries an attachment path.
 */
export const ATTACHMENT_QUICK_VIEW_METADATA_REASONS = ['unsupported', 'directory', 'too-large', 'unavailable'] as const;

export type AttachmentQuickViewMetadataReason = (typeof ATTACHMENT_QUICK_VIEW_METADATA_REASONS)[number];

/** A Main-issued capability for the attachment chosen through a native picker. */
export type AttachmentQuickViewSelection = Readonly<{ attachmentId: string; path: string }>;

/** Renderer request for a file already admitted by an Explorer session. */
export type ExplorerQuickViewSelectionRequest = Readonly<{
  sessionId: string;
  relativePath: string;
}>;

export type AttachmentQuickView =
  | Readonly<{ kind: 'text'; content: string; truncated: boolean }>
  | Readonly<{ kind: 'image'; dataUrl: string; width: number; height: number }>
  | Readonly<{
      kind: 'metadata';
      name: string;
      size: number;
      reason: AttachmentQuickViewMetadataReason;
    }>;
