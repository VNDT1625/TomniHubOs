/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createViuImeDraftController, type ViuImeDraftController } from '@/common/viu/authoring';

export type ViuImeTextDraft = {
  value: string;
  composing: boolean;
  dirty: boolean;
  onChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (event: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
};

/** Binds an Arco TextArea to one IME-safe, blur-committed editing session. */
export const useViuImeTextDraft = (
  externalValue: string,
  onCommit: (value: string) => void,
  resetKey = ''
): ViuImeTextDraft => {
  const controllerRef = useRef<ViuImeDraftController | null>(null);
  if (!controllerRef.current) controllerRef.current = createViuImeDraftController(externalValue);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const [snapshot, setSnapshot] = useState(() => controllerRef.current!.snapshot());

  useEffect(() => {
    setSnapshot(controllerRef.current!.syncExternal(externalValue));
  }, [externalValue, resetKey]);

  const commit = useCallback((): void => {
    const value = controllerRef.current!.commit();
    setSnapshot(controllerRef.current!.snapshot());
    if (value !== null) onCommitRef.current(value);
  }, []);

  return {
    value: snapshot.draft,
    composing: snapshot.composing,
    dirty: snapshot.dirty,
    onChange: (value) => setSnapshot(controllerRef.current!.change(value)),
    onCompositionStart: () => setSnapshot(controllerRef.current!.compositionStart()),
    onCompositionEnd: (event) => setSnapshot(controllerRef.current!.compositionEnd(event.currentTarget.value)),
    onBlur: commit,
    onKeyDown: (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSnapshot(controllerRef.current!.cancel());
    },
  };
};
