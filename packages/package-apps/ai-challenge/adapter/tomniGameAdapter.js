/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tomni Game Adapter - Universal Client Script for Game Engines.
 * Usable directly in Godot Web exports, Unity WebGL .jslib, or custom HTML5 engines.
 */

(function (global) {
  'use strict';

  var LEGAL_MOVEMENTS = ['advance', 'retreat', 'dash_forward', 'dash_backward', 'hold'];
  var LEGAL_COMBAT = ['light_jab', 'heavy_smash', 'block', 'parry', null];
  var LEGAL_ELEMENT_SKILLS = ['elemental_burst', 'energy_shield', 'overdrive', null];

  function computeScriptBotAction(observation) {
    if (!observation || typeof observation !== 'object') {
      return { movement: 'hold', combat: null, elementSkill: null };
    }
    var distance = typeof observation.distance === 'number' ? observation.distance : 4;
    var my = observation.myMech || {};
    var opp = observation.opponentMech || {};
    var directive = (observation.coachDirective || '').toLowerCase();

    if (directive.indexOf('khiên') !== -1 || directive.indexOf('thủ') !== -1 || directive.indexOf('defend') !== -1) {
      return { movement: distance < 3 ? 'retreat' : 'hold', combat: 'block', elementSkill: null };
    }
    if (directive.indexOf('lùi') !== -1 || directive.indexOf('retreat') !== -1) {
      return { movement: 'dash_backward', combat: null, elementSkill: null };
    }
    if (directive.indexOf('combo') !== -1 || directive.indexOf('dồn') !== -1 || directive.indexOf('attack') !== -1) {
      if ((my.energy || 0) >= 50) {
        return { movement: distance > 2 ? 'dash_forward' : 'advance', combat: 'heavy_smash', elementSkill: 'elemental_burst' };
      }
      return { movement: distance > 2 ? 'dash_forward' : 'advance', combat: 'heavy_smash', elementSkill: null };
    }

    if (distance > 5) {
      return { movement: 'dash_forward', combat: null, elementSkill: null };
    }
    if (distance > 2) {
      return { movement: 'advance', combat: 'light_jab', elementSkill: null };
    }
    if (opp.status === 'attacking') {
      return { movement: 'hold', combat: (my.energy || 0) >= 20 ? 'parry' : 'block', elementSkill: null };
    }
    if ((my.energy || 0) >= 80) {
      return { movement: 'hold', combat: 'heavy_smash', elementSkill: 'elemental_burst' };
    }
    if ((my.energy || 0) >= 30) {
      return { movement: 'hold', combat: 'heavy_smash', elementSkill: null };
    }
    return { movement: 'hold', combat: 'light_jab', elementSkill: null };
  }

  function TomniGameAdapter(options) {
    options = options || {};
    this.gameId = options.gameId || 'ai-challenge';
    this.targetWindow = options.targetWindow || (typeof window !== 'undefined' ? window.parent : null);
    this.actionHandlers = [];
    this.coachHandlers = [];
    if (options.onAction) this.actionHandlers.push(options.onAction);
    if (options.onCoachDirective) this.coachHandlers.push(options.onCoachDirective);
    this.lastSeenTick = {};
    this.active = false;

    var self = this;
    this.messageListener = function (event) {
      if (self.targetWindow && event.source !== self.targetWindow) return;
      var data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'tomni.game.action') {
        var action = data;
        if (!action.matchId || typeof action.matchId !== 'string' || action.matchId.length > 128) return;
        if (typeof action.tick !== 'number' || action.tick < 0) return;

        var prev = self.lastSeenTick[action.matchId] !== undefined ? self.lastSeenTick[action.matchId] : -1;
        if (action.tick < prev) return;
        self.lastSeenTick[action.matchId] = action.tick;

        if (!action.action || typeof action.action !== 'object') return;
        if (LEGAL_MOVEMENTS.indexOf(action.action.movement) === -1) return;
        if (LEGAL_COMBAT.indexOf(action.action.combat) === -1) return;
        if (LEGAL_ELEMENT_SKILLS.indexOf(action.action.elementSkill) === -1) return;

        var validated = {
          type: 'tomni.game.action',
          matchId: action.matchId,
          tick: action.tick,
          source: action.source || 'script_bot',
          action: {
            movement: action.action.movement,
            combat: action.action.combat,
            elementSkill: action.action.elementSkill,
          },
          reasoningBrief: typeof action.reasoningBrief === 'string' ? action.reasoningBrief.slice(0, 512) : undefined,
          modelUsed: typeof action.modelUsed === 'string' ? action.modelUsed.slice(0, 128) : undefined,
        };

        for (var i = 0; i < self.actionHandlers.length; i++) {
          try {
            self.actionHandlers[i](validated);
          } catch (e) {
            console.error('[TomniGameAdapter] Action callback error:', e);
          }
        }
      } else if (data.type === 'tomni.game.coach_directive') {
        var directive = data;
        if (!directive.matchId || typeof directive.matchId !== 'string' || directive.matchId.length > 128) return;
        if (typeof directive.text !== 'string' || !directive.text.trim()) return;

        var validDirective = {
          type: 'tomni.game.coach_directive',
          matchId: directive.matchId,
          text: directive.text.slice(0, 512),
          timestamp: typeof directive.timestamp === 'number' ? directive.timestamp : Date.now(),
          urgency: directive.urgency === 'urgent' ? 'urgent' : 'advice',
        };

        for (var j = 0; j < self.coachHandlers.length; j++) {
          try {
            self.coachHandlers[j](validDirective);
          } catch (e2) {
            console.error('[TomniGameAdapter] Coach directive callback error:', e2);
          }
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.messageListener);
      this.active = true;
    }
  }

  TomniGameAdapter.prototype.sendObservation = function (observation) {
    if (!this.targetWindow || typeof this.targetWindow.postMessage !== 'function') return;
    var payload = Object.assign({}, observation, { type: 'tomni.game.observation' });
    this.targetWindow.postMessage(payload, '*');
  };

  TomniGameAdapter.prototype.sendCoachDirective = function (directive) {
    if (!directive || !directive.text) return;
    var payload = {
      type: 'tomni.game.coach_directive',
      matchId: directive.matchId,
      text: String(directive.text).slice(0, 512),
      timestamp: Date.now(),
      urgency: directive.urgency === 'urgent' ? 'urgent' : 'advice',
    };
    if (this.targetWindow && typeof this.targetWindow.postMessage === 'function') {
      this.targetWindow.postMessage(payload, '*');
    }
  };

  TomniGameAdapter.prototype.reportSession = function (report) {
    if (!this.targetWindow || typeof this.targetWindow.postMessage !== 'function') return;
    var rawStatus = report.status || 'working';
    var status = rawStatus === 'in-battle' ? 'working' : (rawStatus === 'victory' || rawStatus === 'defeat') ? 'idle' : rawStatus;

    this.targetWindow.postMessage(
      {
        type: 'tomni.capability.invoke',
        requestId: 'session-' + Date.now(),
        capability: 'sessions.report',
        args: {
          sessions: [
            {
              id: report.matchId,
              title: report.title,
              status: status,
              score: report.score || '',
              lastActiveAt: report.lastActiveAt || Date.now(),
            },
          ],
          actions: { create: true, close: true },
        },
      },
      '*'
    );
  };

  TomniGameAdapter.prototype.onAction = function (handler) {
    this.actionHandlers.push(handler);
    var self = this;
    return function () {
      var idx = self.actionHandlers.indexOf(handler);
      if (idx !== -1) self.actionHandlers.splice(idx, 1);
    };
  };

  TomniGameAdapter.prototype.onCoachDirective = function (handler) {
    this.coachHandlers.push(handler);
    var self = this;
    return function () {
      var idx = self.coachHandlers.indexOf(handler);
      if (idx !== -1) self.coachHandlers.splice(idx, 1);
    };
  };

  TomniGameAdapter.prototype.dispose = function () {
    if (this.active && typeof window !== 'undefined') {
      window.removeEventListener('message', this.messageListener);
      this.active = false;
    }
    this.actionHandlers = [];
    this.coachHandlers = [];
    this.lastSeenTick = {};
  };

  var api = {
    LEGAL_MOVEMENTS: LEGAL_MOVEMENTS,
    LEGAL_COMBAT: LEGAL_COMBAT,
    LEGAL_ELEMENT_SKILLS: LEGAL_ELEMENT_SKILLS,
    computeScriptBotAction: computeScriptBotAction,
    TomniGameAdapter: TomniGameAdapter,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.TomniGameAdapter = TomniGameAdapter;
  global.AiChallengeGameAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
