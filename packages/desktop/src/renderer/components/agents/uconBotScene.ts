import type { UconAppearance } from './uconBotConfig';
import { paintUconRear } from './uconBotRear';
import { paintUconParts } from './uconBotParts';

export type UconBotRole =
  | 'primary'
  | 'coordinator'
  | 'coder'
  | 'researcher'
  | 'tool'
  | 'observer'
  | 'creative'
  | 'data'
  | 'security'
  | 'planner'
  | 'team'
  | 'schedule'
  | 'app'
  | 'social';
export type UconBotState =
  | 'sleep'
  | 'offline'
  | 'idle'
  | 'waiting'
  | 'success'
  | 'thinking'
  | 'working'
  | 'searching'
  | 'listening'
  | 'speaking'
  | 'needs_input'
  | 'warning'
  | 'error';

export const UCON_STATE_COLORS: Readonly<Record<UconBotState, string>> = {
  sleep: '#89919d',
  offline: '#89919d',
  idle: '#38ca85',
  waiting: '#38ca85',
  success: '#38ca85',
  thinking: '#428eff',
  working: '#428eff',
  searching: '#428eff',
  listening: '#428eff',
  speaking: '#428eff',
  needs_input: '#ffaf42',
  warning: '#ffaf42',
  error: '#f05264',
};

export type UconBotPose = {
  state: UconBotState;
  previousState?: UconBotState;
  transitionProgress?: number;
  /** Pure appearance independent of execution status. */
  appearance: UconAppearance;
  /** An explicit tool category/glyph from structured runtime, not prompt text. */
  taskGlyph?: UconAppearance['eyes'];
  isSubagent?: boolean;
  time: number;
  detail: 'full' | 'mini';
};
export const ease = (progress: number): number => {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  return p * p * (3 - 2 * p);
};
export const sleeping = (state: UconBotState): boolean => state === 'sleep' || state === 'offline';
export const busy = (state: UconBotState): boolean =>
  state === 'thinking' || state === 'working' || state === 'searching' || state === 'speaking' || state === 'listening';
export const hologram = (state: UconBotState): boolean => state === 'working' || state === 'searching';

export function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}
export function rounded(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
export function strokeLine(c: CanvasRenderingContext2D, points: readonly number[]): void {
  c.beginPath();
  c.moveTo(points[0] ?? 0, points[1] ?? 0);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
  c.stroke();
}

/** Deterministic painter: logical viewport 220×220, no state or timers. */
export function paintUconBot(c: CanvasRenderingContext2D, pose: UconBotPose): void {
  c.clearRect(0, 0, 220, 220);
  paintUconRear(c, pose);
  paintUconParts(c, pose);
}
