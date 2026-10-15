/**
 * UCON Bot v1: parametric 2.5D character painted entirely on Canvas 2D.
 * The energy apparatus always renders BEHIND the shell. It is not a UI control:
 * its holographic panels express runtime state but never execute tools.
 */
export type UconBotState =
  | 'idle'
  | 'thinking'
  | 'listening'
  | 'speaking'
  | 'searching'
  | 'working'
  | 'waiting'
  | 'success'
  | 'warning'
  | 'error'
  | 'offline';

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
  | 'app';

export type UconBotPose = {
  state: UconBotState;
  role: UconBotRole;
  /** Animation time in seconds (pass 0 to render a reduced-motion still). */
  time: number;
  /** Fine detail is disabled for compact tiles. */
  detail: 'full' | 'mini';
  /** CSS token resolved by the host; never read app state in the renderer. */
  accent: string;
};

const BODY_DARK = '#11192c';
const SCREEN = '#050b1a';
const SHELL = '#f3f6ff';
const OUTLINE = '#5a729b';

function glow(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawOrbit(ctx: CanvasRenderingContext2D, p: UconBotPose): void {
  const { state, accent, detail, time } = p;
  if (state === 'offline') return;
  const thinking = state === 'thinking';
  const working = state === 'working' || state === 'searching';
  const warning = state === 'warning' || state === 'error';
  const radius = thinking ? 78 : working ? 92 : 87;
  const orbitTime = time * (thinking ? 1.5 : working ? 1.05 : 0.2);
  const count = thinking ? 3 : working ? 6 : 1;
  ctx.save();
  ctx.translate(110, 110);
  // The ring is in a plane behind the character, NEVER crossing its face.
  ctx.rotate(-0.24);
  ctx.scale(1, 0.9);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const phase = orbitTime + i * ((Math.PI * 2) / count);
    const start = working ? phase : thinking ? phase : phase + 0.25;
    const span = working ? 0.68 : thinking ? 1.18 : 5.7;
    ctx.beginPath();
    ctx.arc(0, 0, radius + (thinking ? i * 5 : 0), start, start + span);
    ctx.strokeStyle = warning ? (state === 'error' ? '#fb6178' : '#f3b758') : accent;
    ctx.globalAlpha = working ? 0.82 : 0.65;
    ctx.lineWidth = detail === 'mini' ? 2.6 : thinking ? 2.4 : 3;
    glow(ctx, ctx.strokeStyle as string, detail === 'mini' ? 4 : 11);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (!working && detail === 'full') {
    // Concentric ion points provide motion without clutter around the head.
    const a = -orbitTime * 0.55;
    for (let i = 0; i < 4; i++) {
      const theta = a + (i * Math.PI) / 2;
      const x = Math.cos(theta) * radius;
      const y = Math.sin(theta) * radius;
      ellipse(ctx, x, y, 2.3, 2.3);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.8;
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tilt: number,
  accent: string,
  time: number
): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(time * 1.8 + x) * 2);
  ctx.rotate(tilt);
  ctx.fillStyle = '#0a244b';
  ctx.globalAlpha = 0.73;
  round(ctx, -23, -16, 46, 32, 5);
  ctx.fill();
  ctx.globalAlpha = 0.94;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  glow(ctx, accent, 7);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-15, -7 + i * 8);
    ctx.lineTo(9 + (i % 2) * 6, -7 + i * 8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, p: UconBotPose, time: number): void {
  const { accent } = p;
  ctx.save();
  const bob = Math.sin(time * 1.7) * 2;
  ctx.translate(0, bob);
  // Arms are distinct from the silhouette and do not carry accessories.
  ctx.fillStyle = OUTLINE;
  ellipse(ctx, 73, 161, 13, 18);
  ctx.fill();
  ellipse(ctx, 147, 161, 13, 18);
  ctx.fill();
  ctx.fillStyle = BODY_DARK;
  ellipse(ctx, 72, 161, 9, 13);
  ctx.fill();
  ellipse(ctx, 148, 161, 9, 13);
  ctx.fill();
  const torso = ctx.createLinearGradient(86, 145, 139, 197);
  torso.addColorStop(0, SHELL);
  torso.addColorStop(0.45, '#b9c9e9');
  torso.addColorStop(1, '#2f4972');
  ctx.fillStyle = torso;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(91, 141);
  ctx.quadraticCurveTo(110, 135, 129, 141);
  ctx.quadraticCurveTo(150, 158, 132, 185);
  ctx.quadraticCurveTo(110, 201, 88, 185);
  ctx.quadraticCurveTo(70, 158, 91, 141);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BODY_DARK;
  ctx.beginPath();
  ctx.moveTo(98, 146);
  ctx.quadraticCurveTo(110, 153, 122, 146);
  ctx.lineTo(112, 164);
  ctx.quadraticCurveTo(110, 167, 108, 164);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = accent;
  glow(ctx, accent, 7);
  ellipse(ctx, 110, 167, 3, 4);
  ctx.fill();
  ctx.restore();
}

function drawShell(ctx: CanvasRenderingContext2D, p: UconBotPose, time: number): void {
  const bob = Math.sin(time * 1.7) * 2;
  ctx.save();
  ctx.translate(0, bob);
  // Polished pearl-metal shell: the outer head is a single uninterrupted shape.
  const rim = ctx.createLinearGradient(51, 25, 173, 154);
  rim.addColorStop(0, '#fff');
  rim.addColorStop(0.28, '#dce7ff');
  rim.addColorStop(0.67, '#859bc1');
  rim.addColorStop(1, '#293e68');
  ctx.fillStyle = rim;
  ctx.strokeStyle = '#475d84';
  ctx.lineWidth = 1.8;
  ellipse(ctx, 110, 91, 63, 63);
  ctx.fill();
  ctx.stroke();
  const glass = ctx.createRadialGradient(91, 57, 8, 115, 110, 72);
  glass.addColorStop(0, '#203354');
  glass.addColorStop(0.36, '#091329');
  glass.addColorStop(1, SCREEN);
  ctx.fillStyle = glass;
  ellipse(ctx, 110, 91, 55, 55);
  ctx.fill();
  ctx.strokeStyle = '#a7b9db';
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Clear-coat highlight stays on the shell; no antenna, crest or head ring.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.ellipse(110, 91, 59, 59, 0, 3.7, 5.25);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#cbe0ff';
  ellipse(ctx, 93, 51, 25, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawSwirl(ctx: CanvasRenderingContext2D, time: number, accent: string, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 1.05);
  ctx.lineWidth = 3.3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = accent;
  glow(ctx, accent, 10);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.moveTo(3, 0);
    ctx.bezierCurveTo(10, -2, 13, -11, 8, -19);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, p: UconBotPose, time: number): void {
  const { state, accent, detail } = p;
  ctx.save();
  ctx.translate(0, Math.sin(time * 1.7) * 2);
  const active = state !== 'offline';
  const light =
    state === 'error' ? '#ff5a7c' : state === 'warning' ? '#ffbb66' : state === 'success' ? '#79efbe' : accent;
  ctx.strokeStyle = light;
  ctx.fillStyle = light;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  glow(ctx, light, detail === 'mini' ? 5 : 10);
  const blink = active && state !== 'thinking' && Math.sin(time * 0.61) > 0.996;
  if (state === 'thinking') {
    drawSwirl(ctx, time, accent, 110, 92);
  } else if (state === 'searching') {
    ctx.lineWidth = 4;
    ellipse(ctx, 105, 89, 15, 15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(116, 101);
    ctx.lineTo(130, 113);
    ctx.stroke();
  } else if (state === 'error') {
    for (const x of [90, 130]) {
      ctx.beginPath();
      ctx.moveTo(x - 6, 80);
      ctx.lineTo(x + 6, 92);
      ctx.moveTo(x + 6, 80);
      ctx.lineTo(x - 6, 92);
      ctx.stroke();
    }
  } else if (state === 'success' || state === 'speaking') {
    for (const x of [91, 129]) {
      ctx.beginPath();
      ctx.arc(x, 92, 8.5, Math.PI * 1.09, Math.PI * 1.91);
      ctx.stroke();
    }
    if (state === 'speaking') {
      ctx.beginPath();
      ctx.ellipse(110, 112, 4 + Math.abs(Math.sin(time * 9)) * 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (blink || state === 'waiting' || state === 'offline') {
    ctx.globalAlpha = state === 'offline' ? 0.3 : 1;
    for (const x of [91, 129]) {
      ctx.beginPath();
      ctx.moveTo(x - 7, 91);
      ctx.lineTo(x + 7, 91);
      ctx.stroke();
    }
  } else if (state === 'listening') {
    for (const x of [91, 129]) {
      round(ctx, x - 7, 87, 14, 6, 3);
      ctx.fill();
    }
    if (detail === 'full') {
      ctx.globalAlpha = 0.55;
      ellipse(ctx, 110, 109, 3, 3);
      ctx.fill();
    }
  } else {
    for (const x of [91, 129]) {
      ellipse(ctx, x, 90, state === 'warning' ? 6.2 : 7.5, state === 'warning' ? 5 : 8);
      ctx.fill();
    }
  }
  if (detail === 'full' && state === 'working') {
    // Short progression line on the face, not a made-up numerical percentage.
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(101, 112);
    ctx.lineTo(119, 112);
    ctx.stroke();
  }
  ctx.restore();
}

/** Render the character in a fixed 220×220 coordinate system onto any pixel size. */
export function paintUconBot(ctx: CanvasRenderingContext2D, pose: UconBotPose): void {
  const time = pose.time;
  ctx.clearRect(0, 0, 220, 220);
  drawOrbit(ctx, pose);
  const panels = pose.state === 'working' || pose.state === 'searching';
  if (panels && pose.detail === 'full') {
    drawPanel(ctx, 26, 72, -0.13, pose.accent, time);
    drawPanel(ctx, 192, 85, 0.12, pose.accent, time + 1);
    drawPanel(ctx, 32, 169, 0.1, pose.accent, time + 2);
  }
  drawBody(ctx, pose, time);
  drawShell(ctx, pose, time);
  drawFace(ctx, pose, time);
}
