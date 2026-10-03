import { describe, expect, it } from 'vitest';
import {
  createAccountExecutionLifecycle,
  type AccountExecutionTimer,
} from '@process/services/security/accountSession/accountExecutionLifecycle';
import { createAccountSessionService } from '@process/services/security/accountSession/accountSessionService';
import type { AccountSessionVault } from '@process/services/security/accountSession/accountSessionVault';
import type { AuthenticatedAccountSession } from '@process/services/security/accountSession/types';
import { createAutomationBackgroundController, type AutomationServices } from '@process/automation/automationBridge';

const session = (): AuthenticatedAccountSession => ({
  schemaVersion: 1,
  accountId: 'account-1',
  subjectId: 'subject-1',
  issuer: 'https://accounts.tomni.example/',
  clientId: 'tomni-desktop',
  accessToken: 'access-token-secret',
  idToken: 'id-token-secret',
  expiresAt: '2026-08-20T10:00:00.000Z',
  verifiedAt: '2026-08-20T09:00:00.000Z',
});

const vault = (): AccountSessionVault => {
  let saved: AuthenticatedAccountSession | undefined;
  return {
    load: async () => saved,
    save: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = undefined;
    },
  };
};

const fakeTimer = (): { timer: AccountExecutionTimer; trigger: () => void; delays: number[] } => {
  let callback: (() => void) | undefined;
  const delays: number[] = [];
  return {
    timer: {
      set: (next, delayMs) => {
        callback = next;
        delays.push(delayMs);
        return next;
      },
      clear: () => {
        callback = undefined;
      },
    },
    trigger: () => callback?.(),
    delays,
  };
};

describe('account execution lifecycle', () => {
  it('never starts before online sign-in, stops on signout, and serializes repeated transitions', async () => {
    const clock = new Date('2026-08-20T09:00:00.000Z');
    const accountSession = createAccountSessionService({
      vault: vault(),
      now: () => clock,
      onlineValidationMaxAgeMs: 60_000,
      validateOnline: async () => ({ status: 'valid' }),
    });
    const starts: string[] = [];
    const stops: string[] = [];
    const fake = fakeTimer();
    const lifecycle = createAccountExecutionLifecycle({
      accountSession,
      now: () => clock,
      timer: fake.timer,
      leases: [
        { name: 'rust-sidecar', start: () => starts.push('rust-sidecar'), stop: () => stops.push('rust-sidecar') },
        {
          name: 'telegram-polling',
          start: () => starts.push('telegram-polling'),
          stop: () => stops.push('telegram-polling'),
        },
        {
          name: 'scheduled-tasks',
          start: () => starts.push('scheduled-tasks'),
          stop: () => stops.push('scheduled-tasks'),
        },
        { name: 'tomny-gateway', start: () => starts.push('tomny-gateway'), stop: () => stops.push('tomny-gateway') },
      ],
    });

    await lifecycle.start();
    expect(starts).toEqual([]);

    await accountSession.recordVerifiedSession(session());
    await lifecycle.reconcile();
    await lifecycle.reconcile();
    expect(starts).toEqual(['rust-sidecar', 'telegram-polling', 'scheduled-tasks', 'tomny-gateway']);
    expect(fake.delays).toEqual([60_000, 60_000, 60_000]);

    await accountSession.signOut();
    await lifecycle.reconcile();
    expect(stops).toEqual(['tomny-gateway', 'scheduled-tasks', 'telegram-polling', 'rust-sidecar']);
    await lifecycle.reconcile();
    expect(stops).toEqual(['tomny-gateway', 'scheduled-tasks', 'telegram-polling', 'rust-sidecar']);
  });

  it('does not arm Automation scheduler or webhook before online sign-in and tears both down on signout', async () => {
    const clock = new Date('2026-08-20T09:00:00.000Z');
    const accountSession = createAccountSessionService({
      vault: vault(),
      now: () => clock,
      validateOnline: async () => ({ status: 'valid' }),
    });
    let schedulerStarts = 0;
    let schedulerStops = 0;
    let webhookStarts = 0;
    let webhookStops = 0;
    const services = {
      scheduler: {
        start: async () => {
          schedulerStarts++;
        },
        stop: () => {
          schedulerStops++;
        },
      },
    } as unknown as AutomationServices;
    const automation = createAutomationBackgroundController({
      services,
      requireAuthenticatedAccount: () => {
        accountSession.requireOnlineSession();
      },
      startWebhook: async () => {
        webhookStarts++;
        return {} as never;
      },
      stopWebhook: async () => {
        webhookStops++;
      },
      startMcp: async () => undefined,
    });
    const lifecycle = createAccountExecutionLifecycle({
      accountSession,
      now: () => clock,
      leases: [{ name: 'automation-background', start: () => automation.start(), stop: () => automation.stop() }],
    });

    await lifecycle.start();
    expect(schedulerStarts).toBe(0);
    expect(webhookStarts).toBe(0);
    await expect(automation.start()).rejects.toThrow('verified account session');
    expect(schedulerStarts).toBe(0);
    expect(webhookStarts).toBe(0);

    await accountSession.recordVerifiedSession(session());
    await lifecycle.reconcile();
    expect(schedulerStarts).toBe(1);
    expect(webhookStarts).toBe(1);

    await accountSession.signOut();
    await lifecycle.reconcile();
    expect(schedulerStops).toBe(1);
    expect(webhookStops).toBe(1);
  });

  it('gates Manager and News workers until online sign-in, then stops them in reverse order', async () => {
    const clock = new Date('2026-08-20T09:00:00.000Z');
    const accountSession = createAccountSessionService({
      vault: vault(),
      now: () => clock,
      validateOnline: async () => ({ status: 'valid' }),
    });
    const starts: string[] = [];
    const stops: string[] = [];
    const lifecycle = createAccountExecutionLifecycle({
      accountSession,
      now: () => clock,
      leases: [
        {
          name: 'manager-reminder-scheduler',
          start: () => starts.push('manager-reminder-scheduler'),
          stop: () => stops.push('manager-reminder-scheduler'),
        },
        {
          name: 'news-rss-scheduler',
          start: () => starts.push('news-rss-scheduler'),
          stop: () => stops.push('news-rss-scheduler'),
        },
        {
          name: 'news-realtime-connector',
          start: () => starts.push('news-realtime-connector'),
          stop: () => stops.push('news-realtime-connector'),
        },
        {
          name: 'news-bot-engine',
          start: () => starts.push('news-bot-engine'),
          stop: () => stops.push('news-bot-engine'),
        },
      ],
    });

    await lifecycle.start();
    expect(starts).toEqual([]);

    await accountSession.recordVerifiedSession(session());
    await lifecycle.reconcile();
    expect(starts).toEqual([
      'manager-reminder-scheduler',
      'news-rss-scheduler',
      'news-realtime-connector',
      'news-bot-engine',
    ]);

    await accountSession.signOut();
    await lifecycle.reconcile();
    expect(stops).toEqual([
      'news-bot-engine',
      'news-realtime-connector',
      'news-rss-scheduler',
      'manager-reminder-scheduler',
    ]);
    // This proves the lifecycle issues stop callbacks. Legacy operations that
    // began before their service observes `stop` remain non-abortable by design.
  });

  it('uses the earliest online deadline and stops leases when that deadline fires', async () => {
    let clock = new Date('2026-08-20T09:00:00.000Z');
    const accountSession = createAccountSessionService({
      vault: vault(),
      now: () => clock,
      onlineValidationMaxAgeMs: 30_000,
      validateOnline: async () => ({ status: 'valid' }),
    });
    const fake = fakeTimer();
    let starts = 0;
    let stops = 0;
    const lifecycle = createAccountExecutionLifecycle({
      accountSession,
      now: () => clock,
      timer: fake.timer,
      leases: [{ name: 'telegram-polling', start: () => starts++, stop: () => stops++ }],
    });

    await accountSession.recordVerifiedSession(session());
    await lifecycle.start();
    expect(starts).toBe(1);
    expect(fake.delays).toEqual([30_000]);

    clock = new Date('2026-08-20T09:00:30.000Z');
    fake.trigger();
    await lifecycle.reconcile();
    expect(stops).toBe(1);
  });
});
