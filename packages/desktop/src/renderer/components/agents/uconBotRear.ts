import {
  ease,
  ellipse,
  hologram,
  rounded,
  sleeping,
  UCON_STATE_COLORS,
  type UconBotPose,
  type UconBotState,
} from './uconBotScene';

type RearMode = 'sleep' | 'halo' | 'orbit' | 'panels' | 'pulse';
export const rearModeForState = (state: UconBotState): RearMode => {
  if (sleeping(state)) return 'sleep';
  if (hologram(state)) return 'panels';
  if (state === 'thinking' || state === 'speaking') return 'orbit';
  if (state === 'success') return 'pulse';
  return 'halo';
};

function panel(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  time: number,
  mini: boolean,
  opacity: number
): void {
  c.save();
  c.translate(x, y + Math.sin(time * 1.6 + x) * 1.3);
  c.rotate(angle);
  const w = mini ? 30 : 42;
  const h = mini ? 24 : 33;
  c.fillStyle = '#0b1731';
  c.globalAlpha = opacity * 0.9;
  rounded(c, -w / 2, -h / 2, w, h, 5);
  c.fill();
  c.strokeStyle = color;
  c.lineWidth = 1.6;
  c.shadowColor = color;
  c.shadowBlur = mini ? 3 : 7;
  c.stroke();
  c.shadowBlur = 0;
  c.globalAlpha = opacity * 0.7;
  c.beginPath();
  c.moveTo(-w * 0.32, -h * 0.22);
  c.lineTo(w * 0.22, -h * 0.22);
  c.moveTo(-w * 0.32, 0);
  c.lineTo(w * 0.32, 0);
  c.moveTo(-w * 0.32, h * 0.23);
  c.lineTo(w * 0.1, h * 0.23);
  c.stroke();
  c.restore();
}

function rearLayer(c: CanvasRenderingContext2D, pose: UconBotPose, mode: RearMode, opacity: number): void {
  const { state, time, detail } = pose;
  const color = UCON_STATE_COLORS[state];
  const mini = detail === 'mini';
  c.save();
  c.globalAlpha = Math.max(0, Math.min(1, opacity));
  c.translate(110, 110);
  c.rotate(-0.19);
  c.scale(1, 0.87);
  const radius = mode === 'orbit' ? 82 : mode === 'panels' ? 91 : 86;
  const phase = time * (mode === 'orbit' ? 0.9 : 0.24);
  const count = mode === 'orbit' ? 3 : mode === 'panels' ? 5 : 1;
  for (let i = 0; i < count; i++) {
    const start = mode === 'orbit' || mode === 'panels' ? phase + (Math.PI * 2 * i) / count : phase + 0.2;
    const span = mode === 'orbit' ? 1.4 : mode === 'panels' ? 0.74 : 5.86;
    c.beginPath();
    c.arc(0, 0, radius + (mode === 'orbit' ? i * 4 : 0), start, start + span);
    c.lineWidth = mini ? 2.5 : 3;
    c.lineCap = 'round';
    c.strokeStyle = color;
    c.globalAlpha = opacity * (mode === 'sleep' ? 0.2 : 0.7);
    c.shadowBlur = mode === 'sleep' ? 0 : mini ? 3 : 9;
    c.shadowColor = color;
    c.stroke();
  }
  c.restore();
  if (mode === 'panels') {
    c.save();
    c.globalAlpha = opacity;
    panel(c, 24, 75, -0.17, color, time, mini, opacity);
    panel(c, 197, 87, 0.15, color, time + 1, mini, opacity);
    if (!mini) panel(c, 32, 172, 0.11, color, time + 2, mini, opacity);
    c.restore();
  }
  if (mode === 'pulse' && !mini) {
    c.save();
    c.globalAlpha = opacity * (0.15 + Math.pow(Math.max(0, Math.sin(time * 3)), 4) * 0.3);
    c.strokeStyle = color;
    c.lineWidth = 5;
    ellipse(c, 110, 110, 95, 84);
    c.stroke();
    c.restore();
  }
}

/**
 * One apparatus mounted behind the body. State transitions cross-fade the
 * geometry; hologram panels represent activity without inventing tool content.
 */
export function paintUconRear(c: CanvasRenderingContext2D, pose: UconBotPose): void {
  const mode = rearModeForState(pose.state);
  const prev = pose.previousState ? rearModeForState(pose.previousState) : mode;
  const progress = ease(pose.transitionProgress ?? 1);
  if (prev !== mode && progress < 1) rearLayer(c, pose, prev, 1 - progress);
  rearLayer(c, pose, mode, prev === mode ? 1 : progress);
}
