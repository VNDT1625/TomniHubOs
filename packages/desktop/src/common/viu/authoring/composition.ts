/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ViuImeDraftSnapshot = {
  draft: string;
  committed: string;
  composing: boolean;
  dirty: boolean;
};

export type ViuImeDraftController = {
  snapshot: () => ViuImeDraftSnapshot;
  syncExternal: (value: string) => ViuImeDraftSnapshot;
  change: (value: string) => ViuImeDraftSnapshot;
  compositionStart: () => ViuImeDraftSnapshot;
  compositionEnd: (value: string) => ViuImeDraftSnapshot;
  commit: () => string | null;
  cancel: () => ViuImeDraftSnapshot;
};

/**
 * Keeps IME composition isolated from project commits. The caller commits once at
 * an editing-session boundary such as blur, preserving one-step undo.
 */
export const createViuImeDraftController = (initialValue: string): ViuImeDraftController => {
  let committed = initialValue;
  let draft = initialValue;
  let composing = false;
  const snapshot = (): ViuImeDraftSnapshot => ({
    draft,
    committed,
    composing,
    dirty: draft !== committed,
  });
  return {
    snapshot,
    syncExternal: (value) => {
      if (!composing) {
        committed = value;
        draft = value;
      }
      return snapshot();
    },
    change: (value) => {
      draft = value;
      return snapshot();
    },
    compositionStart: () => {
      composing = true;
      return snapshot();
    },
    compositionEnd: (value) => {
      draft = value;
      composing = false;
      return snapshot();
    },
    commit: () => {
      if (composing || draft === committed) return null;
      committed = draft;
      return committed;
    },
    cancel: () => {
      draft = committed;
      composing = false;
      return snapshot();
    },
  };
};
