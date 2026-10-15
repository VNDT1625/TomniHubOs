/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Challenge - Sandboxed Local Model Decision Provider.
 * Communicates ONLY via window.parent postMessage mediation.
 * Runs in a CSP-locked iframe: connect-src 'none' (zero direct network access).
 * Implements deterministic script-bot fallback (<300ms) with a 1,400ms hard model deadline.
 */

(function (global) {
  'use strict';

  var LEGAL_MOVEMENTS = ['advance', 'retreat', 'dash_forward', 'dash_backward', 'hold'];
  var LEGAL_COMBAT = ['light_jab', 'heavy_smash', 'block', 'parry', null];
  var LEGAL_ELEMENT_SKILLS = ['elemental_burst', 'energy_shield', 'overdrive', null];

  var INVOCATION_CLIENT_TIMEOUT_MS = 1400;

  /**
   * Deterministic Script Bot Decider.
   * Runs synchronously under 5ms, guaranteeing a safe, legal action candidate.
   */
  function computeScriptBotAction(observation) {
    if (!observation || typeof observation !== 'object') {
      return { movement: 'hold', combat: null, elementSkill: null };
    }

    var distance = typeof observation.distance === 'number' ? observation.distance : 4;
    var myMech = observation.myMech || {};
    var oppMech = observation.opponentMech || {};
    var directive = (observation.coachDirective || '').toLowerCase();

    var movement = 'hold';
    var combat = null;
    var elementSkill = null;

    // 1. Coach directive priority
    if (directive.indexOf('khiên') !== -1 || directive.indexOf('thủ') !== -1 || directive.indexOf('defend') !== -1) {
      return { movement: distance < 3 ? 'retreat' : 'hold', combat: 'block', elementSkill: null };
    }
    if (directive.indexOf('lùi') !== -1 || directive.indexOf('retreat') !== -1) {
      return { movement: 'dash_backward', combat: null, elementSkill: null };
    }
    if (directive.indexOf('combo') !== -1 || directive.indexOf('dồn') !== -1 || directive.indexOf('attack') !== -1) {
      if (myMech.energy >= 50) {
        return { movement: distance > 2 ? 'dash_forward' : 'advance', combat: 'heavy_smash', elementSkill: 'elemental_burst' };
      }
      return { movement: distance > 2 ? 'dash_forward' : 'advance', combat: 'heavy_smash', elementSkill: null };
    }

    // 2. Autonomous state-based tactic
    if (distance > 5) {
      movement = 'dash_forward';
      combat = null;
    } else if (distance > 2) {
      movement = 'advance';
      combat = 'light_jab';
    } else {
      movement = 'hold';
      if (oppMech.status === 'attacking') {
        combat = myMech.energy >= 20 ? 'parry' : 'block';
      } else if (myMech.energy >= 80) {
        elementSkill = 'elemental_burst';
        combat = 'heavy_smash';
      } else if (myMech.energy >= 30) {
        combat = 'heavy_smash';
      } else {
        combat = 'light_jab';
      }
    }

    return {
      movement: movement,
      combat: combat,
      elementSkill: elementSkill,
    };
  }

  function buildPrompt(weightClass, observation) {
    var my = observation.myMech || {};
    var opp = observation.opponentMech || {};
    var dist = observation.distance !== undefined ? observation.distance : 4;
    var directive = observation.coachDirective || 'None';

    var base = 'Match Tick: ' + (observation.tick || 0) + '\n' +
      'Distance: ' + dist + 'm\n' +
      'My Mech: HP ' + (my.hp || 0) + '/' + (my.maxHp || 100) + ', Energy ' + (my.energy || 0) + ', Status ' + (my.status || 'idle') + '\n' +
      'Opponent: HP ' + (opp.hp || 0) + '/' + (opp.maxHp || 100) + ', Energy ' + (opp.energy || 0) + ', Status ' + (opp.status || 'idle') + '\n' +
      'Coach Directive: ' + directive + '\n' +
      'Choose one movement from [advance, retreat, dash_forward, dash_backward, hold].\n' +
      'Choose one combat action from [light_jab, heavy_smash, block, parry, null].\n' +
      'Choose one element skill from [elemental_burst, energy_shield, overdrive, null].\n' +
      'Respond STRICTLY in JSON: {"movement":"...","combat":...,"elementSkill":...,"reason":"..."}';

    return base;
  }

  function parseModelOutput(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) return null;

    var cleaned = rawText.trim();
    var jsonStart = cleaned.indexOf('{');
    var jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;

    try {
      var parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
      if (!parsed || typeof parsed !== 'object') return null;

      var movement = parsed.movement;
      var combat = parsed.combat === undefined ? null : parsed.combat;
      var elementSkill = parsed.elementSkill === undefined ? null : parsed.elementSkill;

      if (LEGAL_MOVEMENTS.indexOf(movement) === -1) return null;
      if (LEGAL_COMBAT.indexOf(combat) === -1) return null;
      if (LEGAL_ELEMENT_SKILLS.indexOf(elementSkill) === -1) return null;

      var reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 256) : undefined;
      return {
        action: {
          movement: movement,
          combat: combat,
          elementSkill: elementSkill,
        },
        reason: reason,
      };
    } catch {
      return null;
    }
  }

  function ModelDecisionProvider(options) {
    options = options || {};
    this.targetWindow = options.targetWindow || (typeof window !== 'undefined' ? window.parent : null);
    this.timeoutMs = options.timeoutMs || INVOCATION_CLIENT_TIMEOUT_MS;
    this.activeRequestId = null;
  }

  ModelDecisionProvider.prototype.requestDecision = function (params) {
    var self = this;
    var tick = (params && params.tick) || 0;
    var matchId = (params && params.matchId) || 'match-default';
    var weightClass = (params && params.weightClass) || 'middleweight';
    var observation = (params && params.observation) || {};

    // 1. Calculate deterministic fallback action immediately (<5ms)
    var scriptFallbackAction = computeScriptBotAction(observation);

    // 2. Validate environment
    if (!self.targetWindow || typeof self.targetWindow.postMessage !== 'function' || typeof window === 'undefined') {
      return Promise.resolve({
        type: 'tomni.game.action',
        matchId: matchId,
        tick: tick,
        source: 'script_fallback',
        action: scriptFallbackAction,
        reasoningBrief: 'Environment does not support postMessage mediation',
      });
    }

    var requestId = 'ai-turn-' + tick + '-' + Math.random().toString(36).slice(2, 10);
    self.activeRequestId = requestId;

    var prompt = buildPrompt(weightClass, observation);
    var systemPrompt = 'You are the autonomous tactical AI core of an arena battle mech. Output pure JSON only.';

    return new Promise(function (resolve) {
      var settled = false;
      var timer = null;

      function finish(result) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (self.activeRequestId === requestId) {
          self.activeRequestId = null;
        }
        resolve(result);
      }

      function onMessage(event) {
        if (event.source !== self.targetWindow) return;
        var data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'tomni.capability.result' || data.requestId !== requestId) return;

        var res = data.result;
        if (res && res.ok === true && res.data && typeof res.data.text === 'string') {
          var parsed = parseModelOutput(res.data.text);
          if (parsed) {
            finish({
              type: 'tomni.game.action',
              matchId: matchId,
              tick: tick,
              source: 'model',
              action: parsed.action,
              reasoningBrief: parsed.reason,
              modelUsed: res.data.model,
            });
            return;
          }
        }

        // Output invalid or error -> fallback to script
        finish({
          type: 'tomni.game.action',
          matchId: matchId,
          tick: tick,
          source: 'script_fallback',
          action: scriptFallbackAction,
          reasoningBrief: (res && res.code) || 'Invalid model candidate',
        });
      }

      window.addEventListener('message', onMessage);

      // Timeout handler
      timer = setTimeout(function () {
        // Send cancellation to host
        try {
          self.targetWindow.postMessage(
            {
              type: 'tomni.capability.cancel',
              requestId: requestId,
            },
            '*'
          );
        } catch {
          // ignore
        }
        finish({
          type: 'tomni.game.action',
          matchId: matchId,
          tick: tick,
          source: 'script_fallback',
          action: scriptFallbackAction,
          reasoningBrief: 'Model decision deadline exceeded',
        });
      }, self.timeoutMs);

      // Post invocation to host
      try {
        self.targetWindow.postMessage(
          {
            type: 'tomni.capability.invoke',
            requestId: requestId,
            capability: 'model.invoke',
            args: {
              contract: 'ai-challenge.turn.v1',
              prompt: prompt,
              systemPrompt: systemPrompt,
              temperature: 0.2,
              maxTokens: 128,
            },
          },
          '*'
        );
      } catch (err) {
        finish({
          type: 'tomni.game.action',
          matchId: matchId,
          tick: tick,
          source: 'script_fallback',
          action: scriptFallbackAction,
          reasoningBrief: 'Failed to post invocation: ' + String(err),
        });
      }
    });
  };

  ModelDecisionProvider.prototype.cancel = function () {
    if (this.activeRequestId && this.targetWindow && typeof this.targetWindow.postMessage === 'function') {
      try {
        this.targetWindow.postMessage(
          {
            type: 'tomni.capability.cancel',
            requestId: this.activeRequestId,
          },
          '*'
        );
      } catch {
        // ignore
      }
      this.activeRequestId = null;
    }
  };

  var api = {
    LEGAL_MOVEMENTS: LEGAL_MOVEMENTS,
    LEGAL_COMBAT: LEGAL_COMBAT,
    LEGAL_ELEMENT_SKILLS: LEGAL_ELEMENT_SKILLS,
    computeScriptBotAction: computeScriptBotAction,
    buildPrompt: buildPrompt,
    parseModelOutput: parseModelOutput,
    ModelDecisionProvider: ModelDecisionProvider,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.AiChallengeModelProvider = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
