/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  TomniGameAdapter as TomniGameAdapterTs,
  computeScriptBotAction as computeScriptBotActionTs,
  LEGAL_MOVEMENTS as LEGAL_MOVEMENTS_TS,
  LEGAL_COMBAT as LEGAL_COMBAT_TS,
  LEGAL_ELEMENT_SKILLS as LEGAL_ELEMENT_SKILLS_TS,
  type GameObservation,
  type AgentDecision,
} from '../../../packages/package-apps/ai-challenge/adapter/tomniGameAdapter';

// Import JS versions to verify 100% parity
// @ts-expect-error JS module without declaration
import * as adapterJs from '../../../packages/package-apps/ai-challenge/adapter/tomniGameAdapter.js';
// @ts-expect-error JS module without declaration
import * as modelProviderJs from '../../../packages/package-apps/ai-challenge/payload/modelProvider.js';

describe('AI Challenge Game Adapter & Model Provider DOM Test', () => {
  describe('TypeScript vs JavaScript Adapter Parity', () => {
    it('shares exact legal action constants', () => {
      expect(adapterJs.LEGAL_MOVEMENTS).toEqual(LEGAL_MOVEMENTS_TS);
      expect(adapterJs.LEGAL_COMBAT).toEqual(LEGAL_COMBAT_TS);
      expect(adapterJs.LEGAL_ELEMENT_SKILLS).toEqual(LEGAL_ELEMENT_SKILLS_TS);
      expect(modelProviderJs.LEGAL_MOVEMENTS).toEqual(LEGAL_MOVEMENTS_TS);
      expect(modelProviderJs.LEGAL_COMBAT).toEqual(LEGAL_COMBAT_TS);
      expect(modelProviderJs.LEGAL_ELEMENT_SKILLS).toEqual(LEGAL_ELEMENT_SKILLS_TS);
    });

    it('computes identical script bot decisions for coach directives', () => {
      const observations: GameObservation[] = [
        {
          type: 'tomni.game.observation',
          matchId: 'm-1',
          tick: 1,
          timeLeftSeconds: 100,
          distance: 2,
          myMech: { name: 'V-Striker', hp: 100, maxHp: 100, energy: 60, maxEnergy: 100, element: 'lightning', positionX: 2, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 100, maxHp: 100, energy: 50, maxEnergy: 100, element: 'fire', positionX: 4, status: 'idle' },
          coachDirective: 'Bật khiên phòng thủ ngay!',
        },
        {
          type: 'tomni.game.observation',
          matchId: 'm-1',
          tick: 2,
          timeLeftSeconds: 99,
          distance: 4,
          myMech: { name: 'V-Striker', hp: 90, maxHp: 100, energy: 40, maxEnergy: 100, element: 'lightning', positionX: 2, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 100, maxHp: 100, energy: 50, maxEnergy: 100, element: 'fire', positionX: 6, status: 'idle' },
          coachDirective: 'Lùi lại giữ khoảng cách',
        },
        {
          type: 'tomni.game.observation',
          matchId: 'm-1',
          tick: 3,
          timeLeftSeconds: 98,
          distance: 3,
          myMech: { name: 'V-Striker', hp: 90, maxHp: 100, energy: 70, maxEnergy: 100, element: 'lightning', positionX: 2, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 80, maxHp: 100, energy: 30, maxEnergy: 100, element: 'fire', positionX: 5, status: 'idle' },
          coachDirective: 'Dồn combo kết liễu!',
        },
      ];

      for (const obs of observations) {
        const tsAction = computeScriptBotActionTs(obs);
        const jsAction = adapterJs.computeScriptBotAction(obs);
        const modelProviderAction = modelProviderJs.computeScriptBotAction(obs);

        expect(jsAction).toEqual(tsAction);
        expect(modelProviderAction).toEqual(tsAction);
      }
    });

    it('computes identical script bot decisions for autonomous battle states', () => {
      const states: GameObservation[] = [
        // Long distance -> dash forward
        {
          type: 'tomni.game.observation',
          matchId: 'm-2',
          tick: 1,
          timeLeftSeconds: 120,
          distance: 6.5,
          myMech: { name: 'V-Striker', hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, element: 'lightning', positionX: 1, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, element: 'fire', positionX: 7.5, status: 'idle' },
        },
        // Mid distance -> advance & light jab
        {
          type: 'tomni.game.observation',
          matchId: 'm-2',
          tick: 2,
          timeLeftSeconds: 119,
          distance: 3.5,
          myMech: { name: 'V-Striker', hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, element: 'lightning', positionX: 1, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, element: 'fire', positionX: 4.5, status: 'idle' },
        },
        // Close distance + opponent attacking + high energy -> parry
        {
          type: 'tomni.game.observation',
          matchId: 'm-2',
          tick: 3,
          timeLeftSeconds: 118,
          distance: 1.5,
          myMech: { name: 'V-Striker', hp: 100, maxHp: 100, energy: 50, maxEnergy: 100, element: 'lightning', positionX: 1, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, element: 'fire', positionX: 2.5, status: 'attacking' },
        },
        // Close distance + high energy -> elemental burst + heavy smash
        {
          type: 'tomni.game.observation',
          matchId: 'm-2',
          tick: 4,
          timeLeftSeconds: 117,
          distance: 1.5,
          myMech: { name: 'V-Striker', hp: 100, maxHp: 100, energy: 85, maxEnergy: 100, element: 'lightning', positionX: 1, status: 'idle' },
          opponentMech: { name: 'Dreadnought', hp: 100, maxHp: 100, energy: 100, maxEnergy: 100, element: 'fire', positionX: 2.5, status: 'idle' },
        },
      ];

      for (const obs of states) {
        const tsAction = computeScriptBotActionTs(obs);
        const jsAction = adapterJs.computeScriptBotAction(obs);
        const modelProviderAction = modelProviderJs.computeScriptBotAction(obs);

        expect(jsAction).toEqual(tsAction);
        expect(modelProviderAction).toEqual(tsAction);
      }
    });
  });

  describe('TomniGameAdapter Ingestion & Monotonic Tick Validation', () => {
    it('dispatches valid actions and enforces monotonic tick ordering', () => {
      const mockParent = {
        postMessage: vi.fn(),
      } as unknown as Window;

      const actionsReceived: AgentDecision[] = [];
      const adapter = new TomniGameAdapterTs({
        gameId: 'ai-challenge',
        title: 'Arena',
        targetWindow: mockParent,
        onAction: (act) => actionsReceived.push(act),
      });

      // Dispatch tick 1
      const event1 = new MessageEvent('message', {
        source: mockParent,
        data: {
          type: 'tomni.game.action',
          matchId: 'm-test',
          tick: 1,
          source: 'model',
          action: { movement: 'advance', combat: 'light_jab', elementSkill: null },
          reasoningBrief: 'Move in',
          modelUsed: 'qwen2.5:7b',
        },
      });
      window.dispatchEvent(event1);
      expect(actionsReceived).toHaveLength(1);
      expect(actionsReceived[0].tick).toBe(1);
      expect(actionsReceived[0].source).toBe('model');

      // Dispatch tick 2
      const event2 = new MessageEvent('message', {
        source: mockParent,
        data: {
          type: 'tomni.game.action',
          matchId: 'm-test',
          tick: 2,
          source: 'script_bot',
          action: { movement: 'hold', combat: 'heavy_smash', elementSkill: null },
        },
      });
      window.dispatchEvent(event2);
      expect(actionsReceived).toHaveLength(2);
      expect(actionsReceived[1].tick).toBe(2);

      // Dispatch stale tick 1 (replayed or delayed) -> ignored
      const eventStale = new MessageEvent('message', {
        source: mockParent,
        data: {
          type: 'tomni.game.action',
          matchId: 'm-test',
          tick: 1,
          action: { movement: 'retreat', combat: null, elementSkill: null },
        },
      });
      window.dispatchEvent(eventStale);
      expect(actionsReceived).toHaveLength(2);

      // Dispatch action with illegal movement -> ignored
      const eventIllegal = new MessageEvent('message', {
        source: mockParent,
        data: {
          type: 'tomni.game.action',
          matchId: 'm-test',
          tick: 3,
          action: { movement: 'teleport_cheat', combat: null, elementSkill: null },
        },
      });
      window.dispatchEvent(eventIllegal);
      expect(actionsReceived).toHaveLength(2);

      adapter.dispose();
    });

    it('normalizes session status in reportSession', () => {
      const mockParent = {
        postMessage: vi.fn(),
      } as unknown as Window;

      const adapter = new TomniGameAdapterTs({
        gameId: 'ai-challenge',
        title: 'Arena',
        targetWindow: mockParent,
      });

      // 'in-battle' -> 'working'
      adapter.reportSession({
        matchId: 'm-1',
        title: 'Round 1',
        status: 'in-battle',
        lastActiveAt: 1000,
      });
      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({
            sessions: [expect.objectContaining({ status: 'working' })],
          }),
        }),
        '*'
      );

      // 'victory' -> 'idle'
      adapter.reportSession({
        matchId: 'm-1',
        title: 'Victory',
        status: 'victory',
        lastActiveAt: 2000,
      });
      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({
            sessions: [expect.objectContaining({ status: 'idle' })],
          }),
        }),
        '*'
      );

      adapter.dispose();
    });
  });

  describe('ModelDecisionProvider Output Parsing & Sandboxed Request Flow', () => {
    it('parses valid model JSON output from natural text', () => {
      const rawText = `Based on the opponent status, here is my decision:
      {"movement":"dash_forward","combat":"heavy_smash","elementSkill":"elemental_burst","reason":"Capitalize on opponent opening"}
      End of turn.`;

      const parsed = modelProviderJs.parseModelOutput(rawText);
      expect(parsed).toEqual({
        action: {
          movement: 'dash_forward',
          combat: 'heavy_smash',
          elementSkill: 'elemental_burst',
        },
        reason: 'Capitalize on opponent opening',
      });
    });

    it('rejects illegal movements or malformed JSON from model output', () => {
      expect(modelProviderJs.parseModelOutput('invalid text')).toBeNull();
      expect(modelProviderJs.parseModelOutput('{"movement":"fly_away"}')).toBeNull();
      expect(modelProviderJs.parseModelOutput('{"movement":"advance","combat":"laser_beam"}')).toBeNull();
    });

    it('requests decision and handles timely valid model response', async () => {
      const mockParent = {
        postMessage: vi.fn(),
      } as unknown as Window;

      const provider = new modelProviderJs.ModelDecisionProvider({
        targetWindow: mockParent,
        timeoutMs: 1400,
      });

      const decisionPromise = provider.requestDecision({
        matchId: 'm-decision-test',
        tick: 10,
        weightClass: 'middleweight',
        observation: {
          distance: 3,
          myMech: { hp: 100, energy: 80 },
          opponentMech: { hp: 100, status: 'idle' },
        },
      });

      // Verify invoke capability was posted
      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tomni.capability.invoke',
          capability: 'model.invoke',
          args: expect.objectContaining({
            contract: 'ai-challenge.turn.v1',
          }),
        }),
        '*'
      );

      const invokeMsg = vi.mocked(mockParent.postMessage).mock.calls[0][0];
      const requestId = invokeMsg.requestId;

      // Simulate Host sending model result
      window.dispatchEvent(
        new MessageEvent('message', {
          source: mockParent,
          data: {
            type: 'tomni.capability.result',
            requestId: requestId,
            result: {
              ok: true,
              data: {
                text: '{"movement":"advance","combat":"light_jab","elementSkill":null,"reason":"Engage opponent"}',
                model: 'qwen2.5:7b',
              },
            },
          },
        })
      );

      const decision = await decisionPromise;
      expect(decision).toMatchObject({
        type: 'tomni.game.action',
        matchId: 'm-decision-test',
        tick: 10,
        source: 'model',
        action: {
          movement: 'advance',
          combat: 'light_jab',
          elementSkill: null,
        },
        reasoningBrief: 'Engage opponent',
        modelUsed: 'qwen2.5:7b',
      });
    });

    it('falls back to deterministic script bot if model decision fails or times out', async () => {
      const mockParent = {
        postMessage: vi.fn(),
      } as unknown as Window;

      const provider = new modelProviderJs.ModelDecisionProvider({
        targetWindow: mockParent,
        timeoutMs: 50, // Short timeout for test
      });

      const decision = await provider.requestDecision({
        matchId: 'm-fallback-test',
        tick: 15,
        weightClass: 'middleweight',
        observation: {
          distance: 7, // distance > 5 -> script bot will dash_forward
          myMech: { hp: 100, energy: 100 },
          opponentMech: { hp: 100, status: 'idle' },
        },
      });

      expect(decision).toMatchObject({
        type: 'tomni.game.action',
        matchId: 'm-fallback-test',
        tick: 15,
        source: 'script_fallback',
        action: {
          movement: 'dash_forward',
          combat: null,
          elementSkill: null,
        },
        reasoningBrief: 'Model decision deadline exceeded',
      });

      // Cancellation should have been sent to host
      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tomni.capability.cancel',
        }),
        '*'
      );
    });
  });
});
