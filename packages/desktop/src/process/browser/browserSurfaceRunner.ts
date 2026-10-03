/** Browser package adapter for a live browser workspace surface. */

import type { AgentEvent, BrowserTabId, RunAgentBridgeResult } from '@/common/packages/browserHost';
import type {
  BrowserSurfaceSpec,
  ISurfaceRunner,
  SurfacePrepared,
  SurfaceRunContext,
  SurfaceRunOutcome,
  SurfaceSpec,
} from '@process/workspace/surfaceTypes';
import { hostTitle } from '@process/workspace/surfaceTypes';

type BrowserViewManager = Readonly<{
  createTab: (options: { url?: string; visible?: boolean; background?: boolean }) => BrowserTabId;
  destroyTab: (id: BrowserTabId) => void;
}>;

type BrowserAgentRunner = Readonly<{
  run: (
    request: { tabId: BrowserTabId; model: string; instruction: string },
    onEvent: (event: AgentEvent) => void
  ) => Promise<RunAgentBridgeResult>;
  cancel: (tabId: BrowserTabId) => void;
}>;

export type BrowserSurfaceRunnerDeps = Readonly<{
  viewManager: BrowserViewManager;
  agentRunner: BrowserAgentRunner;
}>;

export const createBrowserSurfaceRunner = (deps: BrowserSurfaceRunnerDeps): ISurfaceRunner => {
  const asBrowser = (spec: SurfaceSpec): BrowserSurfaceSpec => {
    if (spec.kind !== 'browser') throw new Error('[BrowserSurfaceRunner] received a non-browser surface spec.');
    return spec;
  };
  const tabOf = (prepared: SurfacePrepared): BrowserTabId => {
    if (!prepared.tabId) throw new Error('[BrowserSurfaceRunner] prepared surface is missing its tab id.');
    return prepared.tabId;
  };

  return {
    prepare(spec): Promise<SurfacePrepared> {
      const browser = asBrowser(spec);
      const tabId = deps.viewManager.createTab({ url: browser.url, visible: false, background: false });
      return Promise.resolve({ title: hostTitle(browser.url), tabId });
    },
    async run(spec, prepared, ctx: SurfaceRunContext): Promise<SurfaceRunOutcome> {
      const browser = asBrowser(spec);
      const tabId = tabOf(prepared);
      const onAbort = (): void => deps.agentRunner.cancel(tabId);
      if (ctx.signal.aborted) deps.agentRunner.cancel(tabId);
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const result = await deps.agentRunner.run(
          { tabId, model: browser.model, instruction: browser.instruction },
          (event) => {
            if (event.type === 'action') ctx.emit({ type: 'step', tool: event.tool, summary: event.summary });
            else if (event.type === 'observation') {
              ctx.emit({ type: 'observation', tool: event.tool, ok: event.ok, summary: event.summary });
            }
          }
        );
        if (result.status === 'error') throw new Error(result.answer || 'The web agent failed.');
        return {
          answer: result.answer,
          steps: result.steps,
          ...(result.status === 'stopped' ? { status: 'stopped' as const } : {}),
        };
      } finally {
        ctx.signal.removeEventListener('abort', onAbort);
      }
    },
    dispose(_spec, prepared): void {
      if (prepared.tabId) deps.viewManager.destroyTab(prepared.tabId);
    },
  };
};
