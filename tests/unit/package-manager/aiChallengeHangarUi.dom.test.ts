/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error JS module without declaration
import * as hangarUi from '../../../packages/package-apps/ai-challenge/payload/hangarUi.js';
import {
  TomniGameAdapter,
  type CoachDirective,
} from '../../../packages/package-apps/ai-challenge/adapter/tomniGameAdapter';

describe('AI Challenge Hangar UI & Coach Focus Manager Test', () => {
  describe('Weight Classes & Stat Budget Validation', () => {
    it('provides correct stat budgets across weight classes', () => {
      expect(hangarUi.WEIGHT_CLASSES.flyweight.statBudget).toBe(25);
      expect(hangarUi.WEIGHT_CLASSES.middleweight.statBudget).toBe(30);
      expect(hangarUi.WEIGHT_CLASSES.heavyweight.statBudget).toBe(35);
    });

    it('validates legal stat allocation within budget', () => {
      const validMiddleweight = { hp: 8, energy: 8, speed: 6, power: 4, armor: 4 }; // Sum = 30
      const res = hangarUi.validateLoadout('middleweight', validMiddleweight);
      expect(res.valid).toBe(true);
      expect(res.totalAllocated).toBe(30);
      expect(res.remaining).toBe(0);
      expect(res.errors).toHaveLength(0);
    });

    it('rejects stat allocation exceeding budget', () => {
      const overBudgetFlyweight = { hp: 10, energy: 10, speed: 8, power: 4, armor: 4 }; // Sum = 36 > 25
      const res = hangarUi.validateLoadout('flyweight', overBudgetFlyweight);
      expect(res.valid).toBe(false);
      expect(res.totalAllocated).toBe(36);
      expect(res.remaining).toBe(0);
      expect(res.errors[0]).toContain('vượt quá ngân sách');
    });

    it('rejects negative or excessive single stat values (>15)', () => {
      const invalidStats = { hp: -2, energy: 18, speed: 4, power: 2, armor: 2 };
      const res = hangarUi.validateLoadout('middleweight', invalidStats);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e: string) => e.includes('không được là số âm'))).toBe(true);
      expect(res.errors.some((e: string) => e.includes('tối đa 15 điểm'))).toBe(true);
    });
  });

  describe('Effective Stat Calculations with Elemental Cores', () => {
    it('applies lightning speed passive bonus and calculateEffectiveStats properly', () => {
      const stats = { hp: 8, energy: 8, speed: 6, power: 4, armor: 4 };
      const effective = hangarUi.calculateEffectiveStats('middleweight', stats, 'lightning');

      // Base HP 100 + 8*5 = 140
      expect(effective.maxHp).toBe(140);
      // Base Energy 80 + 8*4 = 112
      expect(effective.maxEnergy).toBe(112);
      // Raw speed (5 + 6*0.5) * 1.15 (lightning) * 1.0 (middleweight mult) = 8.0 * 1.15 = 9.2
      expect(effective.speed).toBe(9.2);
      // Power (6 + 4*1.5) = 12.0
      expect(effective.power).toBe(12.0);
      // Armor (6 + 4*2) = 14.0
      expect(effective.armor).toBe(14.0);
      expect(effective.specialSkill).toBe('Bộc Phá Lôi (EMP Burst)');
    });

    it('applies fire damage multiplier passive bonus', () => {
      const stats = { hp: 12, energy: 6, speed: 2, power: 5, armor: 10 };
      const effective = hangarUi.calculateEffectiveStats('heavyweight', stats, 'fire');

      // Heavyweight base power = 8, 8 + 5*1.5 = 15.5. Fire +15% -> 15.5 * 1.15 = 17.825 -> 17.8
      expect(effective.power).toBe(17.8);
      // Heavyweight armor base = 8, 8 + 10*2 = 28. Heavyweight armor multiplier = 1.25 -> 28 * 1.25 = 35.0
      expect(effective.armor).toBe(35.0);
      expect(effective.specialSkill).toBe('Hỏa Nộ (Overdrive Flame)');
    });

    it('verifies standard robot presets conform to weight class budgets', () => {
      for (const preset of hangarUi.ROBOT_PRESETS) {
        const check = hangarUi.validateLoadout(preset.weightClass, preset.allocatedStats);
        expect(check.valid).toBe(true);
      }
    });
  });

  describe('CoachFocusManager Lifecycle & Consumption', () => {
    it('initializes with default focus points and computes costs', () => {
      const manager = new hangarUi.CoachFocusManager({ maxFocus: 5, initialFocus: 4 });
      expect(manager.currentFocus).toBe(4);
      expect(manager.maxFocus).toBe(5);
      expect(manager.getFocusCost('advice')).toBe(1);
      expect(manager.getFocusCost('urgent_command')).toBe(2);
    });

    it('consumes focus points and notifies subscribers', () => {
      const manager = new hangarUi.CoachFocusManager({ maxFocus: 5, initialFocus: 3 });
      const focusListener = vi.fn();
      manager.onFocusChange(focusListener);

      expect(manager.canExecute('urgent_command')).toBe(true);
      const consumed = manager.consume('urgent_command'); // 3 - 2 = 1
      expect(consumed).toBe(true);
      expect(manager.currentFocus).toBe(1);
      expect(focusListener).toHaveBeenCalledWith(1, 5);

      // Now only 1 focus remains, urgent command requires 2
      expect(manager.canExecute('urgent_command')).toBe(false);
      const failConsume = manager.consume('urgent_command');
      expect(failConsume).toBe(false);
      expect(manager.currentFocus).toBe(1);

      // Advice costs 1, should succeed
      expect(manager.canExecute('advice')).toBe(true);
      manager.consume('advice'); // 1 - 1 = 0
      expect(manager.currentFocus).toBe(0);
      expect(manager.canExecute('advice')).toBe(false);
    });

    it('recovers focus up to max and resets', () => {
      const manager = new hangarUi.CoachFocusManager({ maxFocus: 5, initialFocus: 0 });
      manager.recover(2);
      expect(manager.currentFocus).toBe(2);

      manager.recover(10); // Capped at maxFocus = 5
      expect(manager.currentFocus).toBe(5);

      manager.consume('urgent_command'); // 5 - 2 = 3
      expect(manager.currentFocus).toBe(3);

      manager.reset();
      expect(manager.currentFocus).toBe(5);
    });
  });

  describe('Game Adapter Coach Directive Exchange', () => {
    it('dispatches and listens to coach directives with urgency tagging', () => {
      const mockParent = {
        postMessage: vi.fn(),
      } as unknown as Window;

      const directivesReceived: CoachDirective[] = [];
      const adapter = new TomniGameAdapter({
        gameId: 'ai-challenge',
        title: 'Arena',
        targetWindow: mockParent,
        onCoachDirective: (d) => directivesReceived.push(d),
      });

      // Send directive from coach
      adapter.sendCoachDirective({
        matchId: 'match-dir-1',
        text: 'Bật khiên phòng thủ phản công!',
        urgency: 'urgent',
      });

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tomni.game.coach_directive',
          matchId: 'match-dir-1',
          text: 'Bật khiên phòng thủ phản công!',
          urgency: 'urgent',
        }),
        '*'
      );

      // Simulate incoming directive from Host
      window.dispatchEvent(
        new MessageEvent('message', {
          source: mockParent,
          data: {
            type: 'tomni.game.coach_directive',
            matchId: 'match-dir-1',
            text: 'Đối thủ sơ hở, dồn combo EMP ngay!',
            urgency: 'urgent',
            timestamp: 1234567,
          },
        })
      );

      expect(directivesReceived).toHaveLength(1);
      expect(directivesReceived[0]).toMatchObject({
        type: 'tomni.game.coach_directive',
        matchId: 'match-dir-1',
        text: 'Đối thủ sơ hở, dồn combo EMP ngay!',
        urgency: 'urgent',
      });

      adapter.dispose();
    });
  });
});
