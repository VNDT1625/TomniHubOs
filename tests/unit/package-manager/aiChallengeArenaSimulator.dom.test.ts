/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error JS module without declaration
import * as arenaSimulator from '../../../packages/package-apps/ai-challenge/payload/arenaSimulator.js';

describe('AI Challenge Arena Simulator & Match Arbiter Test', () => {
  describe('Damage Calculation & Mitigation Mechanics', () => {
    it('calculates mitigated damage based on attacker power and defender armor', () => {
      const attacker = { power: 12, element: 'lightning', state: 'attacking' };
      const defender = { armor: 10, element: 'fire', state: 'idle', energy: 50 };

      // Base raw damage 10 -> 10 * (12/10) * (100 / (100 + 40)) = 12 * (100/140) = 8.57 -> 9
      const result = arenaSimulator.calculateDamage(attacker, defender, 10, false);
      expect(result.damage).toBe(9);
      expect(result.isBlocked).toBe(false);
      expect(result.isParried).toBe(false);
    });

    it('applies elemental advantage multiplier', () => {
      const fireAttacker = { power: 10, armor: 0, element: 'fire', state: 'attacking' };
      const iceDefender = { power: 10, armor: 0, element: 'ice', state: 'idle', energy: 50 };

      // Base 20. Fire vs Ice multiplier = 1.25 -> 25
      const advResult = arenaSimulator.calculateDamage(fireAttacker, iceDefender, 20, true);
      expect(advResult.damage).toBe(25);

      const disadvResult = arenaSimulator.calculateDamage(iceDefender, fireAttacker, 20, true);
      // Ice vs Fire multiplier = 0.8 -> 16
      expect(disadvResult.damage).toBe(16);
    });

    it('mitigates 70% damage on standard block and 85% on ice block', () => {
      const attacker = { power: 10, element: 'cyber', state: 'attacking' };
      const defender = { armor: 0, element: 'lightning', state: 'blocking', energy: 50 };

      // Base 20 * 0.3 = 6
      const blocked = arenaSimulator.calculateDamage(attacker, defender, 20, false);
      expect(blocked.damage).toBe(6);
      expect(blocked.isBlocked).toBe(true);

      const iceDefender = { armor: 0, element: 'ice', state: 'blocking', energy: 50 };
      // Base 20 * (1 - 0.85) = 3
      const iceBlocked = arenaSimulator.calculateDamage(attacker, iceDefender, 20, false);
      expect(iceBlocked.damage).toBe(3);
      expect(iceBlocked.isBlocked).toBe(true);
    });

    it('completely negates damage and marks isParried if defender is in parry state with sufficient energy', () => {
      const attacker = { power: 15, element: 'fire', state: 'attacking' };
      const defender = { armor: 10, element: 'lightning', state: 'parry', energy: 20 };

      const parried = arenaSimulator.calculateDamage(attacker, defender, 25, false);
      expect(parried.damage).toBe(0);
      expect(parried.isParried).toBe(true);
    });
  });

  describe('Match Arbiter Simulation Loop & Boundary Resolution', () => {
    it('initializes match with correct fighter parameters and coordinates', () => {
      const arbiter = new arenaSimulator.MatchArbiter({
        playerMech: { name: 'Player-1', hp: 120, maxHp: 120, speed: 8 },
        opponentMech: { name: 'Opponent-1', hp: 130, maxHp: 130, speed: 6 },
        durationSeconds: 100,
      });

      expect(arbiter.player.hp).toBe(120);
      expect(arbiter.opponent.hp).toBe(130);
      expect(arbiter.timeLeftSeconds).toBe(100);
      expect(arbiter.isEnded).toBe(false);
      expect(arbiter.getDistanceMeters()).toBe(6.0); // 9.0 - 3.0 = 6.0m
    });

    it('moves fighters closer on advance and respects minimum collision boundary', () => {
      const arbiter = new arenaSimulator.MatchArbiter();

      // Step 1: both advance
      arbiter.step({ movement: 'advance', combat: null, elementSkill: null }, { movement: 'advance', combat: null, elementSkill: null });
      expect(arbiter.getDistanceMeters()).toBeLessThan(6.0);

      // Advance repeatedly until collision
      for (let i = 0; i < 50; i++) {
        arbiter.step({ movement: 'advance', combat: null, elementSkill: null }, { movement: 'advance', combat: null, elementSkill: null });
      }

      // Distance should never drop below minFighterDistanceMeters (0.8m)
      expect(arbiter.getDistanceMeters()).toBeGreaterThanOrEqual(0.8);
      expect(arbiter.player.xMeters).toBeLessThan(arbiter.opponent.xMeters);
    });

    it('executes attacks and registers damage when in melee range', () => {
      const arbiter = new arenaSimulator.MatchArbiter();
      // Position fighters in melee range
      arbiter.player.xMeters = 5.5;
      arbiter.opponent.xMeters = 6.5; // distance 1.0m <= 1.8m melee range

      const initialOppHp = arbiter.opponent.hp;
      const initialPlayerHp = arbiter.player.hp;

      // Player light jab, opponent hold
      arbiter.step(
        { movement: 'hold', combat: 'light_jab', elementSkill: null },
        { movement: 'hold', combat: null, elementSkill: null }
      );

      expect(arbiter.opponent.hp).toBeLessThan(initialOppHp);
      expect(arbiter.player.hp).toBe(initialPlayerHp);
      expect(arbiter.events.some((e: { type: string }) => e.type === 'hit')).toBe(true);
    });

    it('triggers parry counter and stuns attacker', () => {
      const arbiter = new arenaSimulator.MatchArbiter();
      arbiter.player.xMeters = 5.5;
      arbiter.opponent.xMeters = 6.5;

      const playerInitialHp = arbiter.player.hp;
      const oppInitialHp = arbiter.opponent.hp;

      // Player attacks, opponent parries
      arbiter.step(
        { movement: 'hold', combat: 'heavy_smash', elementSkill: null },
        { movement: 'hold', combat: 'parry', elementSkill: null }
      );

      // Opponent took 0 damage because of parry
      expect(arbiter.opponent.hp).toBe(oppInitialHp);
      // Attacker took reflected damage
      expect(arbiter.player.hp).toBeLessThan(playerInitialHp);
      expect(arbiter.player.stunTicksRemaining).toBeGreaterThan(0);
      expect(arbiter.events.some((e: { type: string }) => e.type === 'parry_counter')).toBe(true);
    });

    it('executes elemental burst and applies elemental status effect', () => {
      const arbiter = new arenaSimulator.MatchArbiter({
        playerMech: { element: 'lightning', maxEnergy: 100, energy: 100 },
      });
      arbiter.player.xMeters = 5.0;
      arbiter.opponent.xMeters = 7.0; // distance 2.0m <= 3.5m burst range

      const oppInitialHp = arbiter.opponent.hp;
      const oppInitialEnergy = arbiter.opponent.energy;

      arbiter.step(
        { movement: 'hold', combat: null, elementSkill: 'elemental_burst' },
        { movement: 'hold', combat: null, elementSkill: null }
      );

      expect(arbiter.opponent.hp).toBeLessThan(oppInitialHp);
      // Lightning burst drains 15 opponent energy and adds shock effect
      expect(arbiter.opponent.energy).toBeLessThan(oppInitialEnergy);
      expect(arbiter.opponent.statusEffects.some((e: { type: string }) => e.type === 'shock')).toBe(true);
    });

    it('declares knockout victory when one fighter HP drops to 0', () => {
      const arbiter = new arenaSimulator.MatchArbiter({
        opponentMech: { hp: 5, maxHp: 100 },
      });
      arbiter.player.xMeters = 5.5;
      arbiter.opponent.xMeters = 6.5;

      arbiter.step(
        { movement: 'hold', combat: 'heavy_smash', elementSkill: null },
        { movement: 'hold', combat: null, elementSkill: null }
      );

      expect(arbiter.opponent.hp).toBe(0);
      expect(arbiter.isEnded).toBe(true);
      expect(arbiter.winner).toBe('player');
      expect(arbiter.events.some((e: { type: string; winner: string }) => e.type === 'match_ended' && e.winner === 'player')).toBe(true);
    });

    it('generates standard game observation payload matching host schema', () => {
      const arbiter = new arenaSimulator.MatchArbiter();
      const obs = arbiter.getObservation('Tập trung phòng thủ!');

      expect(obs.type).toBe('tomni.game.observation');
      expect(obs.matchId).toBe(arbiter.matchId);
      expect(obs.tick).toBe(0);
      expect(obs.distance).toBe(6);
      expect(obs.myMech.hp).toBe(arbiter.player.hp);
      expect(obs.opponentMech.hp).toBe(arbiter.opponent.hp);
      expect(obs.coachDirective).toBe('Tập trung phòng thủ!');
    });
  });
});
