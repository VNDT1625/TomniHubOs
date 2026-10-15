/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  dispatchUserPromptSubmit,
  resolveHookConversation,
  type HookTurnContext,
} from '@process/integrations/hookRuntime/hookDispatcher';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

/**
 * UserPromptSubmit hooks (repotopackage design 11.3). Built in, `pre_query`, first in the default pipeline.
 *
 * - A valid `block` decision (exit code 2, `decision: "block"`, `continue: false`) of an approved, active hook
 *   blocks the prompt before any model sees it.
 * - Hook context is added to the pipeline context, so it is inspected as the `pipeline-context` outbound part
 *   together with every other retrieved text, and it stays untrusted data.
 * - Hooks fail open: a missing registry, a timeout or a crashing hook lets the prompt through (section 11.6 item 10),
 *   so this stage is a standard stage, not a guard. Dry runs (pipeline simulation) never run hooks.
 */
export class UserHooksStage implements IChatStage {
  public readonly id = 'builtin:user-hooks';
  public readonly displayName = 'User hooks';
  public readonly description = 'Runs approved UserPromptSubmit hooks; a hook can block the prompt or add context';
  public readonly phase = 'pre_query' as const;
  public readonly icon = 'Hook';
  public readonly defaultEnabled = true;
  // UserPromptSubmit hooks default to 30 s; the stage waits slightly longer so a slow hook is not cut off.
  public readonly defaultTimeoutMs = 32_000;

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    if (input.isDryRun) return { decision: 'continue' };
    const known = await resolveHookConversation(input.runId);
    const turn: HookTurnContext = known ?? { sessionId: input.runId, permissionMode: 'workspace-write' };
    const verdict = await dispatchUserPromptSubmit(turn, input.query);
    if (verdict.blocked) {
      return {
        decision: 'block',
        reasonCode: 'USER_HOOK_BLOCKED',
        evidence: { hookBlocked: true, ...(verdict.reason ? { hookReason: verdict.reason } : {}) },
      };
    }
    if (!verdict.additionalContext) return { decision: 'continue' };
    const context = [input.context?.trim(), verdict.additionalContext].filter(Boolean).join('\n\n');
    return { decision: 'continue', context, evidence: { hookContextAdded: true } };
  }
}
