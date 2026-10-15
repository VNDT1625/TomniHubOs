import { describe, expect, it } from 'vitest';

import { LiveSessionRegistry } from '@/process/system/liveSessions/liveSessionRegistry';
import { reportPackageSessions } from '@/process/system/liveSessions/reportPackageSessions';

const sessions = [{ id: 't', title: 'Doc', status: 'idle' }];

describe('reportPackageSessions', () => {
  it('reports sessions and actions under the given package id', () => {
    const registry = new LiveSessionRegistry();
    expect(reportPackageSessions(registry, 'com.x.app', { sessions, actions: { create: true } })).toBe(true);
    const app = registry.snapshot().apps[0];
    expect(app.appId).toBe('com.x.app');
    expect(app.actions).toEqual({ create: true });
    registry.dispose();
  });

  it('works without actions', () => {
    const registry = new LiveSessionRegistry();
    expect(reportPackageSessions(registry, 'com.x.app', { sessions })).toBe(true);
    expect(registry.snapshot().apps[0]).not.toHaveProperty('actions');
    registry.dispose();
  });

  it('returns false and changes nothing for undefined or garbage args', () => {
    const registry = new LiveSessionRegistry();
    registry.report('com.x.app', sessions, { close: true });
    for (const args of [undefined, null, 'x', 42, {}, { sessions: 'no', actions: { create: true } }]) {
      expect(reportPackageSessions(registry, 'com.x.app', args)).toBe(false);
    }
    expect(registry.snapshot().apps[0].actions).toEqual({ close: true });
    registry.dispose();
  });

  it('never takes the package id from args', () => {
    const registry = new LiveSessionRegistry();
    reportPackageSessions(registry, 'com.x.app', { appId: 'chat', packageId: 'chat', sessions });
    expect(registry.snapshot().apps.map((app) => app.appId)).toEqual(['com.x.app']);
    registry.dispose();
  });
});
