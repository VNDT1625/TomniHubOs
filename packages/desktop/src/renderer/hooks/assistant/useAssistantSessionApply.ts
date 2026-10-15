/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DefaultToolCandidate } from '@/common/types/agent/assistant/assistantDefaultTools';
import {
  planAssistantSession,
  type AssistantPlanNotice,
  type AssistantSessionPlan,
} from '@/common/types/agent/assistant/assistantSessionSelection';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { Message } from '@arco-design/web-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type AssistantSessionApplyOptions = {
  /** The assistant the user picked for this chat, or undefined when none is selected. */
  assistant: Assistant | undefined;
  /** Plugins (MCP servers) the host knows about; `enabled` mirrors the user's Settings switch. */
  plugins: readonly { id: string; enabled: boolean }[];
  /** Skill names the user can use right now. */
  skillNames: readonly string[];
  /** Tools the person can attach as default tools (built from MCP servers). Absent means none. */
  tools?: readonly DefaultToolCandidate[];
  /** False until plugins and skills have loaded; planning earlier would report installed items as missing. */
  ready: boolean;
  /** Receives the plan once per selected assistant. Callers decide how to store it for this chat. */
  onApply: (plan: AssistantSessionPlan) => void;
};

export type AssistantSessionApplyResult = {
  /** Hook allowlist for the next conversation, or undefined when no assistant is applied. */
  hookIds: string[] | undefined;
  /** Items that were not applied because they are missing or not enabled/approved. */
  notices: AssistantPlanNotice[];
};

/** Reads the hooks the user has approved and enabled. Fails closed: no bridge means no hooks. */
export const loadActiveHookIds = async (): Promise<string[]> => {
  try {
    const result = await window.electronAPI?.hookSettings?.list();
    if (!result?.ok) return [];
    return result.data.hooks.filter((hook) => hook.active).map((hook) => hook.id);
  } catch {
    return [];
  }
};

/**
 * Applies an assistant to the current chat. The plan is computed when the selected assistant changes, not on every
 * catalog refresh, so a user's manual toggles are not overwritten. Items that could not be applied are announced once.
 */
export const useAssistantSessionApply = (options: AssistantSessionApplyOptions): AssistantSessionApplyResult => {
  const { t } = useTranslation();
  const [state, setState] = useState<AssistantSessionApplyResult>({ hookIds: undefined, notices: [] });
  const latest = useRef(options);
  latest.current = options;
  const assistantId = options.assistant?.id;

  const ready = options.ready;

  useEffect(() => {
    const current = latest.current;
    if (!current.assistant) {
      setState({ hookIds: undefined, notices: [] });
      return;
    }
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const activeHookIds = await loadActiveHookIds();
      if (cancelled || !latest.current.assistant) return;
      const plan = planAssistantSession(latest.current.assistant, {
        skillNames: latest.current.skillNames,
        plugins: latest.current.plugins,
        activeHookIds,
        tools: latest.current.tools,
      });
      latest.current.onApply(plan);
      setState({ hookIds: plan.hookIds, notices: plan.notices });
      if (plan.notices.length > 0) {
        Message.warning(
          t('guid.assistantSessionNotApplied', {
            count: plan.notices.length,
            defaultValue: `${plan.notices.length} item(s) of this assistant are not enabled and were not applied.`,
          })
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-plan only when the selected assistant (or readiness) changes; see the doc comment above.
  }, [assistantId, ready]);

  return state;
};
