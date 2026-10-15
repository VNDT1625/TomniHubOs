import { attachmentReferenceToken, type SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

type SemanticAttachmentEditorProps = {
  value: string;
  references: readonly SemanticAttachmentReference[];
  onValueChange: (value: string) => void;
  onCaretChange: (caret: number) => void;
  caretOffset?: number;
  onRemoveReference: (referenceId: string) => void;
  onQuickViewReference?: (reference: SemanticAttachmentReference) => void;
  onQuickViewReferenceLeave?: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
  onCompositionStartCapture?: React.CompositionEventHandler<HTMLDivElement>;
  onCompositionEndCapture?: React.CompositionEventHandler<HTMLDivElement>;
  placeholder?: string;
  className?: string;
  testId?: string;
};

type TextPart = { kind: 'text'; value: string };
type ReferencePart = { kind: 'reference'; reference: SemanticAttachmentReference };
type EditorPart = TextPart | ReferencePart;

const splitValue = (value: string, references: readonly SemanticAttachmentReference[]): EditorPart[] => {
  const candidates = references.map((reference) => ({ token: attachmentReferenceToken(reference.id), reference }));
  const parts: EditorPart[] = [];
  let remaining = value;
  while (remaining) {
    let next: { token: string; reference: SemanticAttachmentReference; index: number } | undefined;
    for (const candidate of candidates) {
      const index = remaining.indexOf(candidate.token);
      if (index >= 0 && (!next || index < next.index)) {
        next = { token: candidate.token, reference: candidate.reference, index };
      }
    }
    if (!next) {
      parts.push({ kind: 'text', value: remaining });
      break;
    }
    if (next.index > 0) parts.push({ kind: 'text', value: remaining.slice(0, next.index) });
    parts.push({ kind: 'reference', reference: next.reference });
    remaining = remaining.slice(next.index + next.token.length);
  }
  return parts.length ? parts : [{ kind: 'text', value: '' }];
};

const nodeValue = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  const referenceId = node.dataset.attachmentReference;
  if (referenceId) return attachmentReferenceToken(referenceId);
  if (node.tagName === 'BR') return '\n';
  return [...node.childNodes].map(nodeValue).join('');
};

const editorValue = (element: HTMLElement): string => [...element.childNodes].map(nodeValue).join('');

const selectionOffset = (element: HTMLElement): number => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return editorValue(element).length;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return editorValue(element).length;
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return [...before.cloneContents().childNodes].map(nodeValue).join('').length;
};

const restoreSelectionOffset = (element: HTMLElement, target: number): void => {
  const range = document.createRange();
  let offset = 0;
  for (const child of element.childNodes) {
    const length = nodeValue(child).length;
    if (child.nodeType === Node.TEXT_NODE && target <= offset + length) {
      range.setStart(child, target - offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    if (child instanceof HTMLElement && child.dataset.attachmentReference && target <= offset + length) {
      if (target - offset === 0) range.setStartBefore(child);
      else range.setStartAfter(child);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    offset += length;
  }
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

/** Writes only known reference records into the editable DOM; typed unknown marker text stays ordinary text. */
const renderParts = (element: HTMLElement, parts: readonly EditorPart[]): void => {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.kind === 'text') {
      fragment.append(document.createTextNode(part.value));
      continue;
    }
    const reference = document.createElement('span');
    reference.className = 'semantic-attachment-reference';
    reference.dataset.attachmentReference = part.reference.id;
    reference.contentEditable = 'false';

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '▣';
    reference.append(icon);

    const label = document.createElement('span');
    label.className = 'semantic-attachment-reference__label';
    label.textContent = part.reference.label;
    reference.append(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'semantic-attachment-reference__remove';
    remove.dataset.removeAttachmentReference = part.reference.id;
    remove.setAttribute('aria-label', `Remove ${part.reference.label}`);
    remove.textContent = '×';
    reference.append(remove);
    fragment.append(reference);
  }
  element.replaceChildren(fragment);
};

const SemanticAttachmentEditor: React.FC<SemanticAttachmentEditorProps> = ({
  value,
  references,
  onValueChange,
  onCaretChange,
  caretOffset,
  onRemoveReference,
  onQuickViewReference,
  onQuickViewReferenceLeave,
  onKeyDown,
  onPaste,
  onFocus,
  onBlur,
  onCompositionStartCapture,
  onCompositionEndCapture,
  placeholder,
  className,
  testId,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | undefined>(undefined);
  const referencesById = useMemo(() => new Map(references.map((reference) => [reference.id, reference])), [references]);
  const parts = useMemo(() => splitValue(value, references), [value, references]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    renderParts(editor, parts);
    restoreSelectionOffset(
      editor,
      pendingCaretRef.current ?? caretOffset ?? Math.min(selectionOffset(editor), value.length)
    );
    pendingCaretRef.current = undefined;
  }, [caretOffset, parts, value]);

  const syncCaret = useCallback(() => {
    if (editorRef.current) onCaretChange(selectionOffset(editorRef.current));
  }, [onCaretChange]);

  const handleInput = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      const editor = event.currentTarget;
      pendingCaretRef.current = selectionOffset(editor);
      onValueChange(editorValue(editor));
    },
    [onValueChange]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.key === 'Backspace' || event.key === 'Delete') && !event.nativeEvent.isComposing) {
        const editor = editorRef.current;
        const selection = window.getSelection();
        if (editor && selection?.rangeCount && selection.getRangeAt(0).collapsed && editor.contains(selection.anchorNode)) {
          const caret = selectionOffset(editor);
          let start = 0;
          for (const part of parts) {
            const length = part.kind === 'reference' ? attachmentReferenceToken(part.reference.id).length : part.value.length;
            const atBoundary = part.kind === 'reference' &&
              (event.key === 'Backspace' ? caret === start + length : caret === start);
            if (atBoundary) {
              event.preventDefault();
              pendingCaretRef.current = start;
              onValueChange(value.slice(0, start) + value.slice(start + length));
              onCaretChange(start);
              return;
            }
            start += length;
          }
        }
      }
      onKeyDown?.(event);
    },
    [onCaretChange, onKeyDown, onValueChange, parts, value]
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button[data-remove-attachment-reference]')
          : null;
      const referenceId = target?.dataset.removeAttachmentReference;
      if (referenceId) onRemoveReference(referenceId);
    },
    [onRemoveReference]
  );

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('button[data-remove-attachment-reference]'))
      event.preventDefault();
  }, []);

  const handleReferenceQuickView = useCallback(
    (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const referenceId = target.closest<HTMLElement>('[data-attachment-reference]')?.dataset.attachmentReference;
      const reference = referenceId ? referencesById.get(referenceId) : undefined;
      if (reference) onQuickViewReference?.(reference);
    },
    [onQuickViewReference, referencesById]
  );

  return (
    <div
      ref={editorRef}
      role='textbox'
      aria-multiline='true'
      contentEditable
      suppressContentEditableWarning
      data-testid={testId}
      className={className}
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyUp={syncCaret}
      onClick={(event) => {
        handleClick(event);
        syncCaret();
      }}
      onSelect={syncCaret}
      onMouseDown={handleMouseDown}
      onMouseOver={(event) => handleReferenceQuickView(event.target)}
      onMouseOut={(event) => {
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-attachment-reference]'))
          return;
        onQuickViewReferenceLeave?.();
      }}
      onFocus={(event) => {
        handleReferenceQuickView(event.target);
        syncCaret();
        onFocus?.(event);
      }}
      onKeyDown={handleKeyDown}
      aria-label={placeholder}
      onPaste={onPaste}
      onBlur={onBlur}
      onCompositionStartCapture={onCompositionStartCapture}
      onCompositionEndCapture={onCompositionEndCapture}
    />
  );
};

export default SemanticAttachmentEditor;
