/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tomni Game Adapter - Standard SDK for Game Engines on TomniHubOS.
 * Provides bidirectional communication between Game Engine and Tomni Host:
 * - Dispatches game observations to the Host/Agent
 * - Receives agent actions and coach directives from the Host
 * - Reports match status to TomniHubOS Sidebar Active Sessions
 */

export type WeightClass = 'flyweight' | 'middleweight' | 'heavyweight';

export type MechElement = 'fire' | 'lightning' | 'ice' | 'cyber';

export type MechMovement = 'advance' | 'retreat' | 'dash_forward' | 'dash_backward' | 'hold';

export type CombatAction = 'light_jab' | 'heavy_smash' | 'block' | 'parry' | null;

export type ElementSkill = 'elemental_burst' | 'energy_shield' | 'overdrive' | null;

export const LEGAL_MOVEMENTS: readonly MechMovement[] = ['advance', 'retreat', 'dash_forward', 'dash_backward', 'hold'];

export const LEGAL_COMBAT: readonly CombatAction[] = ['light_jab', 'heavy_smash', 'block', 'parry', null];

export const LEGAL_ELEMENT_SKILLS: readonly ElementSkill[] = ['elemental_burst', 'energy_shield', 'overdrive', null];

export interface MechFighterState {
  name: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  element: MechElement;
  positionX: number;
  status: 'idle' | 'moving' | 'attacking' | 'blocking' | 'stunned';
  currentAction?: string;
}

export interface GameObservation {
  type: 'tomni.game.observation';
  matchId: string;
  tick: number;
  timeLeftSeconds: number;
  distance: number;
  myMech: MechFighterState;
  opponentMech: MechFighterState;
  coachDirective?: string;
}

export interface AgentDecision {
  type: 'tomni.game.action';
  matchId: string;
  tick: number;
  source: 'model' | 'script_fallback' | 'script_bot';
  action: {
    movement: MechMovement;
    combat: CombatAction;
    elementSkill: ElementSkill;
  };
  reasoningBrief?: string;
  modelUsed?: string;
}

export interface CoachDirective {
  type: 'tomni.game.coach_directive';
  matchId: string;
  text: string;
  timestamp: number;
  urgency: 'advice' | 'urgent';
}

export type SidebarSessionStatus = 'working' | 'idle' | 'attention' | 'error' | 'suspended';

export interface GameSessionReport {
  matchId: string;
  title: string;
  status: SidebarSessionStatus | 'in-battle' | 'victory' | 'defeat';
  score?: string;
  lastActiveAt: number;
}

export interface AdapterInitOptions {
  gameId: string;
  title: string;
  targetWindow?: Window;
  onAction?: (decision: AgentDecision) => void;
  onCoachDirective?: (directive: CoachDirective) => void;
}

export function computeScriptBotAction(observation: GameObservation): AgentDecision['action'] {
  const distance = typeof observation?.distance === 'number' ? observation.distance : 4;
  const my = observation?.myMech ?? ({} as MechFighterState);
  const opp = observation?.opponentMech ?? ({} as MechFighterState);
  const directive = (observation?.coachDirective || '').toLowerCase();

  if (directive.includes('khiên') || directive.includes('thủ') || directive.includes('defend')) {
    return { movement: distance < 3 ? 'retreat' : 'hold', combat: 'block', elementSkill: null };
  }
  if (directive.includes('lùi') || directive.includes('retreat')) {
    return { movement: 'dash_backward', combat: null, elementSkill: null };
  }
  if (directive.includes('combo') || directive.includes('dồn') || directive.includes('attack')) {
    if ((my.energy ?? 0) >= 50) {
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
    return { movement: 'hold', combat: (my.energy ?? 0) >= 20 ? 'parry' : 'block', elementSkill: null };
  }
  if ((my.energy ?? 0) >= 80) {
    return { movement: 'hold', combat: 'heavy_smash', elementSkill: 'elemental_burst' };
  }
  if ((my.energy ?? 0) >= 30) {
    return { movement: 'hold', combat: 'heavy_smash', elementSkill: null };
  }
  return { movement: 'hold', combat: 'light_jab', elementSkill: null };
}

export class TomniGameAdapter {
  private gameId: string;
  private targetWindow: Window;
  private actionHandlers = new Set<(decision: AgentDecision) => void>();
  private coachHandlers = new Set<(directive: CoachDirective) => void>();
  private messageListener: (event: MessageEvent) => void;
  private lastSeenTick = new Map<string, number>();
  private active = false;

  constructor(options: AdapterInitOptions) {
    this.gameId = options.gameId;
    this.targetWindow = options.targetWindow ?? (typeof window !== 'undefined' ? window.parent : ({} as Window));
    if (options.onAction) this.actionHandlers.add(options.onAction);
    if (options.onCoachDirective) this.coachHandlers.add(options.onCoachDirective);

    this.messageListener = (event: MessageEvent) => {
      if (this.targetWindow && event.source !== this.targetWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'tomni.game.action') {
        const action = data as AgentDecision;
        if (!action.matchId || typeof action.matchId !== 'string' || action.matchId.length > 128) return;
        if (typeof action.tick !== 'number' || action.tick < 0) return;

        const previousTick = this.lastSeenTick.get(action.matchId) ?? -1;
        if (action.tick < previousTick) return;
        this.lastSeenTick.set(action.matchId, action.tick);

        if (!action.action || typeof action.action !== 'object') return;
        if (!LEGAL_MOVEMENTS.includes(action.action.movement)) return;
        if (!LEGAL_COMBAT.includes(action.action.combat)) return;
        if (!LEGAL_ELEMENT_SKILLS.includes(action.action.elementSkill)) return;

        const validatedDecision: AgentDecision = {
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

        for (const handler of this.actionHandlers) {
          try {
            handler(validatedDecision);
          } catch (err) {
            console.error('[TomniGameAdapter] Action handler error:', err);
          }
        }
      } else if (data.type === 'tomni.game.coach_directive') {
        const directive = data as CoachDirective;
        if (!directive.matchId || typeof directive.matchId !== 'string' || directive.matchId.length > 128) return;
        if (typeof directive.text !== 'string' || !directive.text.trim()) return;

        const validatedDirective: CoachDirective = {
          type: 'tomni.game.coach_directive',
          matchId: directive.matchId,
          text: directive.text.slice(0, 512),
          timestamp: typeof directive.timestamp === 'number' ? directive.timestamp : Date.now(),
          urgency: directive.urgency === 'urgent' ? 'urgent' : 'advice',
        };

        for (const handler of this.coachHandlers) {
          try {
            handler(validatedDirective);
          } catch (err) {
            console.error('[TomniGameAdapter] Coach handler error:', err);
          }
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.messageListener);
      this.active = true;
    }
  }

  public sendObservation(observation: Omit<GameObservation, 'type'>): void {
    const payload: GameObservation = {
      ...observation,
      type: 'tomni.game.observation',
    };
    if (this.targetWindow && typeof this.targetWindow.postMessage === 'function') {
      this.targetWindow.postMessage(payload, '*');
    }
  }

  public sendCoachDirective(directive: {
    matchId: string;
    text: string;
    urgency?: 'advice' | 'urgent';
    focusCost?: number;
  }): void {
    const payload: CoachDirective = {
      type: 'tomni.game.coach_directive',
      matchId: directive.matchId,
      text: directive.text.slice(0, 512),
      timestamp: Date.now(),
      urgency: directive.urgency === 'urgent' ? 'urgent' : 'advice',
    };
    if (this.targetWindow && typeof this.targetWindow.postMessage === 'function') {
      this.targetWindow.postMessage(payload, '*');
    }
  }

  public reportSession(report: GameSessionReport): void {
    if (!this.targetWindow || typeof this.targetWindow.postMessage !== 'function') return;

    const normalizedStatus: SidebarSessionStatus =
      report.status === 'in-battle'
        ? 'working'
        : report.status === 'victory' || report.status === 'defeat'
          ? 'idle'
          : report.status;

    this.targetWindow.postMessage(
      {
        type: 'tomni.capability.invoke',
        requestId: `session-${Date.now()}`,
        capability: 'sessions.report',
        args: {
          sessions: [
            {
              id: report.matchId,
              title: report.title,
              status: normalizedStatus,
              score: report.score,
              lastActiveAt: report.lastActiveAt,
            },
          ],
          actions: { create: true, close: true },
        },
      },
      '*'
    );
  }

  public onAction(handler: (decision: AgentDecision) => void): () => void {
    this.actionHandlers.add(handler);
    return () => this.actionHandlers.delete(handler);
  }

  public onCoachDirective(handler: (directive: CoachDirective) => void): () => void {
    this.coachHandlers.add(handler);
    return () => this.coachHandlers.delete(handler);
  }

  public dispose(): void {
    if (this.active && typeof window !== 'undefined') {
      window.removeEventListener('message', this.messageListener);
      this.active = false;
    }
    this.actionHandlers.clear();
    this.coachHandlers.clear();
    this.lastSeenTick.clear();
  }
}
