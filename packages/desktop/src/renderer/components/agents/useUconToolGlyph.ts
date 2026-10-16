import { hubActivityChannels, type HubActivityItem, type HubActivityToolTrace } from '@/common/types/agent/hubActivity';
import { useEffect, useState } from 'react';
import type { UconEyes } from './uconBotConfig';

/**
 * Deterministic whitelist of structured tool IDs, not free-text descriptions,
 * prompts, paths or tool I/O. Unknown tools use neutral eyes.
 */
export function eyeGlyphForToolName(name: string): UconEyes | undefined {
  if (!name || name.length > 160) return undefined;
  const id = name.toLowerCase();
  if (/(?:^|[:./_-])(?:edit|write|patch|applypatch|code|compile|build)(?:$|[:./_-])/u.test(id)) return 'code';
  if (/(?:^|[:./_-])(?:read|search|grep|find|web|browser|fetch|crawl|research)(?:$|[:./_-])/u.test(id)) return 'scan';
  if (/(?:^|[:./_-])(?:terminal|shell|exec|command|bash|pty)(?:$|[:./_-])/u.test(id)) return 'terminal';
  if (/(?:^|[:./_-])(?:sql|database|query|analyze|data)(?:$|[:./_-])/u.test(id)) return 'chart';
  if (/(?:^|[:./_-])(?:workflow|delegate|subagent|team|plan)(?:$|[:./_-])/u.test(id)) return 'nodes';
  if (/(?:^|[:./_-])(?:security|audit|scansecret|permission)(?:$|[:./_-])/u.test(id)) return 'shield';
  if (/(?:^|[:./_-])(?:app|window|surface|ui)(?:$|[:./_-])/u.test(id)) return 'app';
  return undefined;
}
export function eyeGlyphForRunningTrace(trace: readonly HubActivityToolTrace[]): UconEyes | undefined {
  const current = trace.filter((tool) => tool.status === 'running');
  for (let i = current.length - 1; i >= 0; i--) {
    const glyph = eyeGlyphForToolName(current[i].name);
    if (glyph) return glyph;
  }
  return undefined;
}

/** Bounded, foreground-only polling of redacted Main traces for an active agent. */
export function useUconToolGlyph(item: HubActivityItem, visible: boolean): UconEyes | undefined {
  const [observed, setObserved] = useState<{ id: string; glyph?: UconEyes } | null>(null);
  useEffect(() => {
    if (!visible || item.kind !== 'agent' || item.status !== 'running') return undefined;
    let alive = true;
    let fetching = false;
    const refresh = () => {
      if (fetching || document.hidden) return;
      fetching = true;
      void hubActivityChannels.trace
        .invoke({ id: item.id })
        .then((trace) => {
          if (!alive) return;
          const glyph = eyeGlyphForRunningTrace(trace);
          setObserved((value) => (value?.id === item.id && value.glyph === glyph ? value : { id: item.id, glyph }));
        })
        .catch(() => {
          if (alive) setObserved({ id: item.id });
        })
        .finally(() => {
          fetching = false;
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 2_500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [item.id, item.kind, item.status, visible]);
  return visible && item.kind === 'agent' && item.status === 'running' && observed?.id === item.id
    ? observed.glyph
    : undefined;
}
