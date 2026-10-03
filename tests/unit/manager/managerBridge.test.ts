/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for process/manager/managerBridge — the always-resolve envelope +
 * error classification.
 *
 * The `@office-ai/platform` bridge providers are registered onto channel names;
 * we capture the registered handler functions via a mock so we can invoke them
 * directly and assert the {@link ManagerResult} envelope shape (never a reject).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerSpies = vi.hoisted(() => ({
  getForecast: vi.fn(),
  createTravelProvider: vi.fn(),
}));

// Capture providers registered onto each channel name.
const registered = new Map<string, (req: unknown) => Promise<unknown>>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: (req: unknown) => Promise<unknown>) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
    buildEmitter: (_channel: string) => ({ emit: vi.fn(), on: vi.fn() }),
  },
}));

// Avoid real weather/travel provider work. The bridge must admit it before either dependency is touched.
vi.mock('@/process/manager/weatherProvider', () => ({ getForecast: providerSpies.getForecast }));
vi.mock('@/process/manager/travelProvider', () => ({ createTravelProvider: providerSpies.createTravelProvider }));

import type { IManagerStore } from '@/process/manager/managerStore';
import type { IManagerAi } from '@/process/manager/managerAi';
import type { IReminderScheduler } from '@/process/manager/reminderScheduler';
import { emptyManagerData, type CalendarEvent, type ManagerData } from '@/process/manager/managerTypes';
import {
  ACCOUNT_SESSION_ONLINE_REQUIRED,
  MANAGER_CHANNELS,
  registerManagerBridge,
  type ManagerExternalAuthority,
  type ManagerResult,
} from '@/process/manager/managerBridge';

const invoke = async <T>(channel: string, req: unknown = undefined): Promise<ManagerResult<T>> => {
  const handler = registered.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return (await handler(req)) as ManagerResult<T>;
};

const makeStore = (over?: Partial<IManagerStore>): IManagerStore =>
  ({
    load: vi.fn(async () => emptyManagerData()),
    getData: vi.fn(() => emptyManagerData()),
    addTask: vi.fn(async () => ({ id: 't' }) as never),
    updateTask: vi.fn(async () => emptyManagerData()),
    removeTask: vi.fn(async () => emptyManagerData()),
    toggleSubtask: vi.fn(async () => emptyManagerData()),
    setTaskStatus: vi.fn(async () => emptyManagerData()),
    addNote: vi.fn(async () => ({ id: 'n' }) as never),
    updateNote: vi.fn(async () => emptyManagerData()),
    removeNote: vi.fn(async () => emptyManagerData()),
    addEvent: vi.fn(async () => ({ id: 'e' }) as never),
    updateEvent: vi.fn(async () => emptyManagerData()),
    removeEvent: vi.fn(async () => emptyManagerData()),
    setEvents: vi.fn(async () => emptyManagerData()),
    updateSettings: vi.fn(async () => emptyManagerData()),
    updateReminder: vi.fn(async () => emptyManagerData()),
    onChange: vi.fn(() => () => undefined),
    ...over,
  }) as unknown as IManagerStore;

const makeScheduler = (): IReminderScheduler =>
  ({
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    sweep: vi.fn(async () => undefined),
    snooze: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
  }) as unknown as IReminderScheduler;

beforeEach(() => {
  registered.clear();
  providerSpies.getForecast.mockReset();
  providerSpies.getForecast.mockResolvedValue(null);
  providerSpies.createTravelProvider.mockReset();
  providerSpies.createTravelProvider.mockReturnValue({ estimate: vi.fn(async () => null) });
});

const locatedEvent = (id: string, startAt: number, endAt: number, location: string): CalendarEvent =>
  ({ id, startAt, endAt, location }) as CalendarEvent;

const optimizeData = (): ManagerData => ({
  ...emptyManagerData(),
  events: [locatedEvent('before', 0, 100, 'Old office'), locatedEvent('in-range', 200, 300, 'New office')],
  settings: {
    ...emptyManagerData().settings,
    weatherEnabled: true,
    defaultLocation: 'Hanoi',
    travelTimeEnabled: true,
    homeLocation: 'Home',
    googleMapsApiKey: 'main-only-google-key',
  },
});

describe('managerBridge envelope', () => {
  it('wraps a successful mutation as { ok: true, data }', async () => {
    registerManagerBridge({ services: { store: makeStore(), scheduler: makeScheduler() } });
    const result = await invoke(MANAGER_CHANNELS.getData);
    expect(result.ok).toBe(true);
  });

  it('wraps a store failure as { ok: false, code: "error" } and never rejects', async () => {
    const store = makeStore({
      updateTask: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    registerManagerBridge({ services: { store, scheduler: makeScheduler() } });
    const result = await invoke(MANAGER_CHANNELS.updateTask, { id: 'x', patch: {} });
    expect(result).toEqual({ ok: false, error: 'disk full', code: 'error' });
  });

  it('classifies missing AI as code "no-model"', async () => {
    registerManagerBridge({ services: { store: makeStore(), scheduler: makeScheduler() /* no ai */ } });
    const result = await invoke(MANAGER_CHANNELS.aiParseTasks, { description: 'do stuff' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no-model');
  });

  it('classifies a vision-related failure as code "no-vision"', async () => {
    const ai = {
      parseScheduleImage: vi.fn(async () => {
        throw new Error('The selected model cannot read images (no vision).');
      }),
    } as unknown as IManagerAi;
    registerManagerBridge({ services: { store: makeStore(), ai, scheduler: makeScheduler() } });
    const result = await invoke(MANAGER_CHANNELS.aiParseImage, { imageDataUrl: 'data:...' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no-vision');
  });

  it('routes snooze through the scheduler', async () => {
    const scheduler = makeScheduler();
    registerManagerBridge({ services: { store: makeStore(), scheduler } });
    const result = await invoke(MANAGER_CHANNELS.snoozeReminder, { taskId: 't', reminderId: 'r', untilMs: 999 });
    expect(result.ok).toBe(true);
    expect(scheduler.snooze).toHaveBeenCalledWith('t', 'r', 999);
  });

  it('denies an offline session before touching the manager store', async () => {
    const store = makeStore();
    const requireAuthenticatedAccount = vi.fn(() => {
      throw new Error('inactive session must not cross the IPC boundary');
    });
    registerManagerBridge({ services: { store, scheduler: makeScheduler() }, requireAuthenticatedAccount });

    await expect(invoke(MANAGER_CHANNELS.getData)).resolves.toEqual({
      ok: false,
      error: ACCOUNT_SESSION_ONLINE_REQUIRED,
      code: 'error',
    });
    expect(requireAuthenticatedAccount).toHaveBeenCalledTimes(1);
    expect(store.load).not.toHaveBeenCalled();
  });

  it('checks the account guard exactly once before a permitted operation', async () => {
    const store = makeStore();
    const requireAuthenticatedAccount = vi.fn();
    registerManagerBridge({ services: { store, scheduler: makeScheduler() }, requireAuthenticatedAccount });

    await expect(invoke(MANAGER_CHANNELS.getData)).resolves.toMatchObject({ ok: true });
    expect(requireAuthenticatedAccount).toHaveBeenCalledTimes(1);
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('default-denies remote weather and travel before provider/key/resolver work while local reminders remain available', async () => {
    const data = optimizeData();
    const keyRead = vi.fn();
    Object.defineProperty(data.settings, 'googleMapsApiKey', {
      get: () => {
        keyRead();
        return 'main-only-google-key';
      },
    });
    const store = makeStore({ getData: vi.fn(() => data) });
    const scheduler = makeScheduler();
    const optimizeSchedule = vi.fn(async (input) => ({
      proposed: [],
      rationale: [],
      weatherUsed: Boolean(input.weather),
      travelUsed: Boolean(input.travelLegs?.length),
    }));
    const ai = { optimizeSchedule } as unknown as IManagerAi;
    registerManagerBridge({ services: { store, ai, scheduler } });

    await expect(invoke(MANAGER_CHANNELS.aiOptimize, { from: 150, to: 400 })).resolves.toMatchObject({ ok: true });
    await expect(
      invoke(MANAGER_CHANNELS.snoozeReminder, { taskId: 't', reminderId: 'r', untilMs: 999 })
    ).resolves.toMatchObject({
      ok: true,
    });

    expect(providerSpies.getForecast).not.toHaveBeenCalled();
    expect(providerSpies.createTravelProvider).not.toHaveBeenCalled();
    expect(keyRead).not.toHaveBeenCalled();
    expect(scheduler.snooze).toHaveBeenCalledWith('t', 'r', 999);
    expect(optimizeSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ events: [data.events[1]], weather: null, travelLegs: [] })
    );
  });

  it('uses weather and travel only after Main grants each operation, preserving the requested event range', async () => {
    const data = optimizeData();
    const store = makeStore({ getData: vi.fn(() => data) });
    const estimate = vi.fn(async () => ({
      distanceMeters: 1200,
      durationSeconds: 300,
      mode: 'driving' as const,
      source: 'estimate' as const,
    }));
    providerSpies.createTravelProvider.mockReturnValue({ estimate });
    providerSpies.getForecast.mockResolvedValue({ location: 'Hanoi', latitude: 21, longitude: 105, days: [] });
    const optimizeSchedule = vi.fn(async () => ({
      proposed: [],
      rationale: [],
      weatherUsed: false,
      travelUsed: false,
    }));
    const authority: ManagerExternalAuthority = {
      authorizeExternalEgress: vi.fn(async () => undefined),
    };
    registerManagerBridge({
      services: { store, ai: { optimizeSchedule } as unknown as IManagerAi, scheduler: makeScheduler() },
      externalAuthority: authority,
    });

    await expect(invoke(MANAGER_CHANNELS.aiOptimize, { from: 150, to: 400 })).resolves.toMatchObject({ ok: true });

    expect(authority.authorizeExternalEgress).toHaveBeenNthCalledWith(1, 'weather-forecast');
    expect(authority.authorizeExternalEgress).toHaveBeenNthCalledWith(2, 'travel-estimate');
    expect(providerSpies.getForecast).toHaveBeenCalledWith('Hanoi', 7);
    expect(providerSpies.createTravelProvider).toHaveBeenCalledWith({ googleApiKey: 'main-only-google-key' });
    expect(estimate).toHaveBeenCalledWith('Home', 'New office', 'driving');
    expect(optimizeSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [data.events[1]],
        travelLegs: [expect.objectContaining({ fromId: 'home', toId: 'in-range' })],
      })
    );
  });
});
