/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveSpotlightTarget } from '@/common/ui/spotlightTargets';
import { showSpotlight } from '@/renderer/components/Spotlight/spotlightBus';
import React from 'react';

type Request = { query: string; note?: string };

/** Accepts `settings`, free text, or `{"target":"settings","note":"..."}`. Anything else yields no request. */
export const parseSpotlightRequest = (source: string): Request | undefined => {
  const text = source.trim();
  if (!text) return undefined;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { target?: unknown; note?: unknown };
      if (typeof parsed.target !== 'string' || !parsed.target.trim()) return undefined;
      return {
        query: parsed.target,
        ...(typeof parsed.note === 'string' && parsed.note.trim() ? { note: parsed.note.trim().slice(0, 200) } : {}),
      };
    } catch {
      return undefined;
    }
  }
  return { query: text.slice(0, 200) };
};

/**
 * A fenced `spotlight` block in an assistant message becomes a button. Nothing is highlighted until the user
 * presses it, so the assistant can suggest where to look but cannot change the screen on its own.
 */
const SpotlightBlock: React.FC<{ source: string }> = ({ source }) => {
  const request = parseSpotlightRequest(source);
  const target = request ? resolveSpotlightTarget(request.query) : undefined;
  if (!request || !target) {
    return (
      <div style={{ fontSize: 13, opacity: 0.7, margin: '8px 0' }} data-testid='spotlight-block-unknown'>
        Không có vị trí này trong danh mục chỉ dẫn của ứng dụng.
      </div>
    );
  }
  return (
    <button
      type='button'
      data-testid='spotlight-block'
      onClick={() => showSpotlight(request.query, request.note)}
      style={{
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        margin: '8px 0',
        padding: '8px 14px',
        borderRadius: 10,
        border: '1px solid rgba(99, 102, 241, 0.55)',
        background: 'rgba(99, 102, 241, 0.12)',
        color: 'inherit',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span aria-hidden='true'>📍</span>
      <span>Chỉ cho tôi: {target.label}</span>
    </button>
  );
};

export default SpotlightBlock;
