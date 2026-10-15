/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mech Arena Simulator & Match Arbiter
 * Deterministic physics, damage calculation, elemental interactions, and rule arbiter.
 */

(function (global) {
  'use strict';

  var ARENA_CONFIG = {
    widthMeters: 12.0,
    pixelsPerMeter: 80.0,
    stageWidthPx: 960,
    stageHeightPx: 380,
    tickRateHz: 10, // 100ms per simulation tick
    defaultRoundTimeSeconds: 120,
    minFighterDistanceMeters: 0.8,
    meleeRangeMeters: 1.8,
  };

  var ELEMENT_ADVANTAGES = {
    // Attacker -> Defender multiplier (1.25 for advantage, 0.85 for disadvantage)
    lightning: { cyber: 1.25, ice: 1.0, fire: 0.85, lightning: 1.0 },
    fire: { ice: 1.25, lightning: 1.15, cyber: 1.0, fire: 0.85 },
    ice: { lightning: 1.2, cyber: 1.1, fire: 0.8, ice: 0.85 },
    cyber: { fire: 1.25, lightning: 1.0, ice: 0.9, cyber: 1.0 },
  };

  /**
   * Calculate effective physical/elemental damage
   */
  function calculateDamage(attacker, defender, rawBaseDamage, isElemental) {
    var rawPower = typeof attacker.power === 'number' ? attacker.power : 10;
    var rawArmor = typeof defender.armor === 'number' ? defender.armor : 10;

    // Armor mitigation formula: damage = base * (power / 10) * (100 / (100 + armor * 4))
    var armorMitigation = 100 / (100 + rawArmor * 4);
    var baseDamage = rawBaseDamage * (rawPower / 10) * armorMitigation;

    // Elemental multiplier
    if (isElemental && attacker.element && defender.element) {
      var advantageTable = ELEMENT_ADVANTAGES[attacker.element] || {};
      var elementMult = advantageTable[defender.element] || 1.0;
      baseDamage *= elementMult;
    }

    // Block & Parry mitigation
    var isParried = false;
    var isBlocked = false;

    if (defender.state === 'parry' && defender.energy >= 15) {
      isParried = true;
      baseDamage = 0; // Completely negated
    } else if (defender.state === 'blocking') {
      isBlocked = true;
      // Ice core increases block mitigation from 70% to 85%
      var mitigationRate = defender.element === 'ice' ? 0.85 : 0.7;
      baseDamage = Math.max(1, baseDamage * (1 - mitigationRate));
    }

    return {
      damage: Math.max(0, Math.round(baseDamage)),
      isBlocked: isBlocked,
      isParried: isParried,
    };
  }

  /**
   * Match Arbiter instance controlling the flow of a single arena duel
   */
  function MatchArbiter(options) {
    options = options || {};
    this.matchId = options.matchId || 'match-' + Date.now();
    this.round = options.round || 1;
    this.tick = 0;
    this.timeLeftSeconds = options.durationSeconds || ARENA_CONFIG.defaultRoundTimeSeconds;
    this.isEnded = false;
    this.winner = null; // 'player' | 'opponent' | 'draw' | null
    this.events = [];

    // Player Mech setup
    var p = options.playerMech || {};
    this.player = {
      name: p.name || 'V-Striker',
      element: p.element || 'lightning',
      maxHp: p.maxHp || 140,
      hp: p.hp || p.maxHp || 140,
      maxEnergy: p.maxEnergy || 112,
      energy: p.energy || p.maxEnergy || 112,
      speed: p.speed || 9.2,
      power: p.power || 12.0,
      armor: p.armor || 14.0,
      xMeters: 3.0,
      state: 'idle', // idle, moving, attacking, blocking, parry, stunned, hit
      stunTicksRemaining: 0,
      statusEffects: [], // { type: 'burn'|'freeze'|'shock'|'shield', value: number, durationTicks: number }
    };

    // Opponent Mech setup
    var opp = options.opponentMech || {};
    this.opponent = {
      name: opp.name || 'Dreadnought',
      element: opp.element || 'fire',
      maxHp: opp.maxHp || 140,
      hp: opp.hp || opp.maxHp || 140,
      maxEnergy: opp.maxEnergy || 110,
      energy: opp.energy || opp.maxEnergy || 110,
      speed: opp.speed || 7.0,
      power: opp.power || 14.0,
      armor: opp.armor || 15.0,
      xMeters: 9.0,
      state: 'idle',
      stunTicksRemaining: 0,
      statusEffects: [],
    };
  }

  MatchArbiter.prototype.getDistanceMeters = function () {
    return Number(Math.abs(this.player.xMeters - this.opponent.xMeters).toFixed(2));
  };

  /**
   * Step the simulation by 1 tick (100ms) with dual actions
   */
  MatchArbiter.prototype.step = function (playerAction, opponentAction) {
    if (this.isEnded) return this.getSummary();

    this.tick++;
    this.events = [];

    // 1. Time countdown (every 10 ticks = 1 second)
    if (this.tick % ARENA_CONFIG.tickRateHz === 0) {
      this.timeLeftSeconds = Math.max(0, this.timeLeftSeconds - 1);
      // Passive energy regen (+2 energy per second)
      this._regenEnergy(this.player, 2);
      this._regenEnergy(this.opponent, 2);
    }

    // 2. Tick status effects & stun counters
    this._processStatusEffects(this.player);
    this._processStatusEffects(this.opponent);

    // 3. Process Movements
    this._applyMovement(this.player, playerAction ? playerAction.movement : 'hold', 1);
    this._applyMovement(this.opponent, opponentAction ? opponentAction.movement : 'hold', -1);

    // Enforce arena boundaries & collision distance
    this._resolvePositions();

    // 4. Process Combat & Skills
    this._resolveCombat(playerAction, opponentAction);

    // 5. Check Termination Conditions
    if (this.player.hp <= 0 || this.opponent.hp <= 0 || this.timeLeftSeconds <= 0) {
      this.isEnded = true;
      if (this.player.hp <= 0 && this.opponent.hp <= 0) {
        this.winner = 'draw';
      } else if (this.player.hp <= 0) {
        this.winner = 'opponent';
      } else if (this.opponent.hp <= 0) {
        this.winner = 'player';
      } else {
        // Time over: compare HP percentages
        var playerPct = this.player.hp / this.player.maxHp;
        var oppPct = this.opponent.hp / this.opponent.maxHp;
        if (Math.abs(playerPct - oppPct) < 0.01) {
          this.winner = 'draw';
        } else {
          this.winner = playerPct > oppPct ? 'player' : 'opponent';
        }
      }
      this.events.push({
        type: 'match_ended',
        winner: this.winner,
        reason: this.player.hp <= 0 || this.opponent.hp <= 0 ? 'knockout' : 'timeout',
      });
    }

    return this.getSummary();
  };

  MatchArbiter.prototype._applyMovement = function (fighter, movement, direction) {
    if (fighter.stunTicksRemaining > 0) {
      fighter.state = 'stunned';
      return;
    }

    var moveSpeed = (fighter.speed / 10) * 0.35; // meters per tick
    // Check freeze status effect
    var freezeEffect = fighter.statusEffects.find(function (e) { return e.type === 'freeze'; });
    if (freezeEffect) {
      moveSpeed *= 0.6; // 40% slow
    }

    if (movement === 'advance') {
      fighter.xMeters += moveSpeed * direction;
      fighter.state = 'moving';
    } else if (movement === 'retreat') {
      fighter.xMeters -= moveSpeed * direction;
      fighter.state = 'moving';
    } else if (movement === 'dash_forward') {
      if (fighter.energy >= 8) {
        fighter.energy -= 8;
        fighter.xMeters += moveSpeed * 2.2 * direction;
        fighter.state = 'moving';
      }
    } else if (movement === 'dash_backward') {
      if (fighter.energy >= 8) {
        fighter.energy -= 8;
        fighter.xMeters -= moveSpeed * 2.2 * direction;
        fighter.state = 'moving';
      }
    } else {
      fighter.state = 'idle';
    }
  };

  MatchArbiter.prototype._resolvePositions = function () {
    // Keep within [1.0m, width - 1.0m]
    this.player.xMeters = Math.max(1.0, Math.min(ARENA_CONFIG.widthMeters - 1.0, this.player.xMeters));
    this.opponent.xMeters = Math.max(1.0, Math.min(ARENA_CONFIG.widthMeters - 1.0, this.opponent.xMeters));

    // Ensure player is on left, opponent on right
    if (this.player.xMeters >= this.opponent.xMeters - ARENA_CONFIG.minFighterDistanceMeters) {
      var mid = (this.player.xMeters + this.opponent.xMeters) / 2;
      this.player.xMeters = mid - ARENA_CONFIG.minFighterDistanceMeters / 2;
      this.opponent.xMeters = mid + ARENA_CONFIG.minFighterDistanceMeters / 2;
    }
  };

  MatchArbiter.prototype._resolveCombat = function (playerAction, opponentAction) {
    var pCombat = playerAction ? playerAction.combat : null;
    var pSkill = playerAction ? playerAction.elementSkill : null;
    var oppCombat = opponentAction ? opponentAction.combat : null;
    var oppSkill = opponentAction ? opponentAction.elementSkill : null;

    // Defense state flags
    if (this.player.stunTicksRemaining <= 0) {
      if (pCombat === 'block') this.player.state = 'blocking';
      else if (pCombat === 'parry' && this.player.energy >= 15) {
        this.player.state = 'parry';
        this.player.energy -= 15;
      }
    }

    if (this.opponent.stunTicksRemaining <= 0) {
      if (oppCombat === 'block') this.opponent.state = 'blocking';
      else if (oppCombat === 'parry' && this.opponent.energy >= 15) {
        this.opponent.state = 'parry';
        this.opponent.energy -= 15;
      }
    }

    // Process Skills first
    this._executeSkill(this.player, this.opponent, pSkill);
    this._executeSkill(this.opponent, this.player, oppSkill);

    // Process Basic Combat Attacks
    this._executeAttack(this.player, this.opponent, pCombat);
    this._executeAttack(this.opponent, this.player, oppCombat);
  };

  MatchArbiter.prototype._executeAttack = function (attacker, defender, combatAction) {
    if (attacker.stunTicksRemaining > 0 || !combatAction) return;
    if (combatAction === 'block' || combatAction === 'parry') return;

    var distance = this.getDistanceMeters();
    if (distance > ARENA_CONFIG.meleeRangeMeters) {
      // Out of range
      return;
    }

    var baseDamage = combatAction === 'heavy_smash' ? 18 : 8;
    var energyCost = combatAction === 'heavy_smash' ? 15 : 6;

    if (attacker.energy < energyCost) {
      baseDamage = Math.round(baseDamage * 0.5); // Depleted energy attack
    } else {
      attacker.energy -= energyCost;
    }

    attacker.state = 'attacking';
    var calc = calculateDamage(attacker, defender, baseDamage, false);

    if (calc.isParried) {
      // Attacker is parried! Stun attacker for 12 ticks (1.2s) and reflect damage
      attacker.stunTicksRemaining = 12;
      attacker.state = 'stunned';
      attacker.hp = Math.max(0, attacker.hp - Math.round(baseDamage * 0.5));
      this.events.push({
        type: 'parry_counter',
        defender: defender.name,
        attacker: attacker.name,
        reflectedDamage: Math.round(baseDamage * 0.5),
      });
      return;
    }

    // Apply damage to defender
    defender.hp = Math.max(0, defender.hp - calc.damage);
    defender.state = calc.isBlocked ? 'blocking' : 'hit';

    this.events.push({
      type: 'hit',
      attacker: attacker.name,
      defender: defender.name,
      action: combatAction,
      damage: calc.damage,
      isBlocked: calc.isBlocked,
    });
  };

  MatchArbiter.prototype._executeSkill = function (caster, target, skillName) {
    if (caster.stunTicksRemaining > 0 || !skillName) return;

    if (skillName === 'elemental_burst') {
      if (caster.energy >= 35) {
        caster.energy -= 35;
        var distance = this.getDistanceMeters();
        var hitDistance = caster.element === 'lightning' ? 3.5 : 2.5;

        if (distance <= hitDistance) {
          var calc = calculateDamage(caster, target, 24, true);
          target.hp = Math.max(0, target.hp - calc.damage);
          target.state = 'hit';

          // Apply elemental status
          if (caster.element === 'lightning') {
            target.energy = Math.max(0, target.energy - 15);
            target.statusEffects.push({ type: 'shock', value: 1, durationTicks: 6 });
          } else if (caster.element === 'fire') {
            target.statusEffects.push({ type: 'burn', value: 3, durationTicks: 15 });
          } else if (caster.element === 'ice') {
            target.statusEffects.push({ type: 'freeze', value: 1, durationTicks: 20 });
          }

          this.events.push({
            type: 'elemental_burst',
            caster: caster.name,
            element: caster.element,
            damage: calc.damage,
          });
        }
      }
    } else if (skillName === 'energy_shield') {
      if (caster.energy >= 25) {
        caster.energy -= 25;
        caster.statusEffects.push({ type: 'shield', value: 25, durationTicks: 30 });
        this.events.push({
          type: 'shield_activated',
          caster: caster.name,
          shieldValue: 25,
        });
      }
    } else if (skillName === 'overdrive') {
      if (caster.energy >= 30) {
        caster.energy -= 30;
        caster.hp = Math.min(caster.maxHp, caster.hp + 10);
        caster.energy = Math.min(caster.maxEnergy, caster.energy + 20);
        this.events.push({
          type: 'overdrive_activated',
          caster: caster.name,
        });
      }
    }
  };

  MatchArbiter.prototype._processStatusEffects = function (fighter) {
    if (fighter.stunTicksRemaining > 0) {
      fighter.stunTicksRemaining--;
    }

    for (var i = fighter.statusEffects.length - 1; i >= 0; i--) {
      var effect = fighter.statusEffects[i];
      effect.durationTicks--;

      if (effect.type === 'burn') {
        // Burn DoT
        fighter.hp = Math.max(0, fighter.hp - (effect.value || 2));
      } else if (effect.type === 'shock' && fighter.stunTicksRemaining <= 0) {
        fighter.stunTicksRemaining = 2; // Micro-stun
      }

      if (effect.durationTicks <= 0) {
        fighter.statusEffects.splice(i, 1);
      }
    }
  };

  MatchArbiter.prototype._regenEnergy = function (fighter, amount) {
    if (fighter.energy < fighter.maxEnergy) {
      fighter.energy = Math.min(fighter.maxEnergy, fighter.energy + amount);
    }
  };

  MatchArbiter.prototype.getObservation = function (coachDirective) {
    return {
      type: 'tomni.game.observation',
      matchId: this.matchId,
      tick: this.tick,
      timeLeftSeconds: this.timeLeftSeconds,
      distance: this.getDistanceMeters(),
      myMech: {
        name: this.player.name,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        energy: this.player.energy,
        maxEnergy: this.player.maxEnergy,
        element: this.player.element,
        positionX: Number((this.player.xMeters * ARENA_CONFIG.pixelsPerMeter).toFixed(1)),
        status: this.player.state === 'attacking' ? 'attacking' : this.player.state === 'blocking' ? 'blocking' : 'idle',
      },
      opponentMech: {
        name: this.opponent.name,
        hp: this.opponent.hp,
        maxHp: this.opponent.maxHp,
        energy: this.opponent.energy,
        maxEnergy: this.opponent.maxEnergy,
        element: this.opponent.element,
        positionX: Number((this.opponent.xMeters * ARENA_CONFIG.pixelsPerMeter).toFixed(1)),
        status: this.opponent.state === 'attacking' ? 'attacking' : this.opponent.state === 'blocking' ? 'blocking' : 'idle',
      },
      coachDirective: coachDirective || undefined,
    };
  };

  MatchArbiter.prototype.getSummary = function () {
    return {
      matchId: this.matchId,
      tick: this.tick,
      timeLeftSeconds: this.timeLeftSeconds,
      distanceMeters: this.getDistanceMeters(),
      isEnded: this.isEnded,
      winner: this.winner,
      player: {
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        energy: this.player.energy,
        maxEnergy: this.player.maxEnergy,
        xMeters: this.player.xMeters,
        state: this.player.state,
      },
      opponent: {
        hp: this.opponent.hp,
        maxHp: this.opponent.maxHp,
        energy: this.opponent.energy,
        maxEnergy: this.opponent.maxEnergy,
        xMeters: this.opponent.xMeters,
        state: this.opponent.state,
      },
      events: this.events.slice(),
    };
  };

  var api = {
    ARENA_CONFIG: ARENA_CONFIG,
    ELEMENT_ADVANTAGES: ELEMENT_ADVANTAGES,
    calculateDamage: calculateDamage,
    MatchArbiter: MatchArbiter,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.AiChallengeArenaSimulator = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
