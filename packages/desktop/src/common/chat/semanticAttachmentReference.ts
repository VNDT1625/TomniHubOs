/**
 * Renderer-safe semantic attachment references embedded in composer text.
 * The reference marker is only an identity link; file delivery stays on the
 * existing attachment/workspace-reference transport.
 */

export type SemanticAttachmentReferenceSource = 'file' | 'workspace';

export type SemanticAttachmentReference = Readonly<{
  id: string;
  attachmentKey: string;
  label: string;
  referencePath: string;
  source: SemanticAttachmentReferenceSource;
}>;

export type SemanticAttachmentReferencePresentation = 'display' | 'model';

const TOKEN_PREFIX = '[[tomni:attachment:';
const TOKEN_SUFFIX = ']]';

export const attachmentReferenceToken = (referenceId: string): string => `${TOKEN_PREFIX}${referenceId}${TOKEN_SUFFIX}`;

export const insertAttachmentReference = (
  value: string,
  caret: number,
  reference: SemanticAttachmentReference
): { value: string; caret: number } => {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const token = attachmentReferenceToken(reference.id);
  return {
    value: `${value.slice(0, safeCaret)}${token}${value.slice(safeCaret)}`,
    caret: safeCaret + token.length,
  };
};

/** Removes the first occurrence so duplicate references retain their independent semantic placement. */
export const removeAttachmentReference = (value: string, referenceId: string): string =>
  value.replace(attachmentReferenceToken(referenceId), '');

export const serializeAttachmentReferences = (
  value: string,
  references: readonly SemanticAttachmentReference[],
  presentation: SemanticAttachmentReferencePresentation
): string => {
  let serialized = value;
  for (const reference of references) {
    const replacement =
      presentation === 'model' ? `[File reference: ${reference.referencePath}]` : `[${reference.label}]`;
    serialized = serialized.split(attachmentReferenceToken(reference.id)).join(replacement);
  }
  return serialized;
};

export const referencedAttachmentIds = (value: string, references: readonly SemanticAttachmentReference[]): string[] =>
  references
    .filter((reference) => value.includes(attachmentReferenceToken(reference.id)))
    .map((reference) => reference.id);
