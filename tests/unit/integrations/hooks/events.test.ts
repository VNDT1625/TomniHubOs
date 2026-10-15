import { describe, expect, it } from 'vitest';
import {
  KNOWN_UNSUPPORTED_HOOK_EVENTS,
  SUPPORTED_HOOK_EVENTS,
  canEventBlock,
  defaultTimeoutSec,
  effectiveTimeoutSec,
  isKnownEvent,
  isSupportedEvent,
} from '@/common/integrations/hooks';

describe('hook events', () => {
  it('supports exactly the eight v1 events', () => {
    expect([...SUPPORTED_HOOK_EVENTS]).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
      'Notification',
      'SessionEnd',
    ]);
  });

  it('has no overlap between supported and known-unsupported', () => {
    for (const name of KNOWN_UNSUPPORTED_HOOK_EVENTS) expect(isSupportedEvent(name)).toBe(false);
  });

  it.each(['PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'PermissionRequest', 'PermissionDenied'])(
    '%s is known but not supported',
    (name) => {
      expect(isKnownEvent(name)).toBe(true);
      expect(isSupportedEvent(name)).toBe(false);
    }
  );

  it('rejects unknown, wrongly cased and non-string names', () => {
    expect(isKnownEvent('pretooluse')).toBe(false);
    expect(isSupportedEvent('Bogus')).toBe(false);
    expect(isKnownEvent(42)).toBe(false);
    expect(isSupportedEvent(undefined)).toBe(false);
  });

  it('marks only PreToolUse, UserPromptSubmit and Stop as blocking', () => {
    const blocking = SUPPORTED_HOOK_EVENTS.filter((e) => canEventBlock(e));
    expect(blocking).toEqual(['UserPromptSubmit', 'PreToolUse', 'Stop']);
  });

  it('uses 60s by default, 30s for UserPromptSubmit, 1.5s budget for SessionEnd', () => {
    expect(defaultTimeoutSec('PreToolUse')).toBe(60);
    expect(defaultTimeoutSec('UserPromptSubmit')).toBe(30);
    expect(defaultTimeoutSec('SessionEnd')).toBe(1.5);
    expect(defaultTimeoutSec('PreCompact')).toBe(60);
  });

  it('caps SessionEnd at the shared budget even if the handler asks for more', () => {
    expect(effectiveTimeoutSec('SessionEnd', 30)).toBe(1.5);
    expect(effectiveTimeoutSec('SessionEnd', 1)).toBe(1);
    expect(effectiveTimeoutSec('PostToolUse', 120)).toBe(120);
    expect(effectiveTimeoutSec('PostToolUse', undefined)).toBe(60);
    expect(effectiveTimeoutSec('PostToolUse', Number.NaN)).toBe(60);
  });
});
