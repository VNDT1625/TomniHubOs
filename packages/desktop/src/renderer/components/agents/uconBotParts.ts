import { ellipse, rounded, strokeLine, busy, sleeping, UCON_STATE_COLORS, type UconBotPose } from './uconBotScene';
import type { UconEyes } from './uconBotConfig';

const METAL = '#dce8fb';
const RIM = '#546b91';
const DARK = '#15243d';
const shellPaint = (c: CanvasRenderingContext2D): CanvasGradient => {
  const g = c.createLinearGradient(49, 24, 170, 159);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, METAL);
  g.addColorStop(0.7, '#94aaca');
  g.addColorStop(1, '#334970');
  return g;
};
function cloak(c: CanvasRenderingContext2D, pose: UconBotPose): void {
  const type = pose.appearance.outfit;
  if (type !== 'cloak' && type !== 'robe') return;
  c.save();
  const g = c.createLinearGradient(75, 140, 156, 204);
  g.addColorStop(0, type === 'robe' ? '#bfcbed' : '#738eb9');
  g.addColorStop(1, '#263b61');
  c.fillStyle = g;
  c.strokeStyle = RIM;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(83, 145);
  c.bezierCurveTo(54, 151, 53, 187, 46, 201);
  c.quadraticCurveTo(79, 215, 111, 194);
  c.quadraticCurveTo(149, 215, 176, 201);
  c.bezierCurveTo(164, 182, 157, 148, 136, 143);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}
function torso(c: CanvasRenderingContext2D, p: UconBotPose): void {
  c.save();
  c.fillStyle = '#344866';
  ellipse(c, 74, 159, 13, 15);
  c.fill();
  ellipse(c, 146, 159, 13, 15);
  c.fill();
  c.fillStyle = shellPaint(c);
  c.strokeStyle = RIM;
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(91, 139);
  c.quadraticCurveTo(110, 134, 129, 139);
  c.bezierCurveTo(152, 149, 151, 182, 135, 192);
  c.quadraticCurveTo(110, 201, 85, 192);
  c.bezierCurveTo(68, 180, 70, 151, 91, 139);
  c.fill();
  c.stroke();
  c.fillStyle = DARK;
  const outfit = p.appearance.outfit;
  if (outfit === 'jacket' || outfit === 'uniform') {
    c.beginPath();
    c.moveTo(91, 145);
    c.lineTo(108, 172);
    c.lineTo(92, 182);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(129, 145);
    c.lineTo(112, 172);
    c.lineTo(129, 182);
    c.closePath();
    c.fill();
    c.strokeStyle = '#96a8c7';
    c.lineWidth = 1.6;
    strokeLine(c, [110, 173, 110, 193]);
  } else if (outfit === 'armor') {
    c.fillStyle = '#304665';
    rounded(c, 85, 146, 50, 29, 7);
    c.fill();
    c.strokeStyle = '#bdcae0';
    c.lineWidth = 2;
    c.stroke();
    strokeLine(c, [93, 181, 128, 181]);
  } else if (outfit === 'cloak' || outfit === 'robe') {
    c.fillStyle = '#243551';
    c.beginPath();
    c.moveTo(90, 144);
    c.lineTo(109, 164);
    c.lineTo(130, 144);
    c.lineTo(123, 174);
    c.lineTo(97, 174);
    c.closePath();
    c.fill();
  }
  if (p.appearance.apron && p.appearance.apron !== 'none') {
    // A small, separately painted textile layer, independent from the uniform.
    c.save();
    c.fillStyle =
      p.appearance.apron === 'chef'
        ? '#f8e9d5'
        : p.appearance.apron === 'mechanic'
          ? '#8d9fae'
          : p.appearance.apron === 'lab'
            ? '#d8e7f0'
            : '#b1b6a2';
    c.strokeStyle = '#516280';
    c.lineWidth = 1.8;
    rounded(c, 99, 152, 22, 34, 4);
    c.fill();
    c.stroke();
    c.strokeStyle = '#d8e0ef';
    strokeLine(c, [100, 154, 94, 146, 89, 151]);
    strokeLine(c, [120, 154, 126, 146, 131, 151]);
    c.strokeStyle = '#5f708b';
    strokeLine(c, [101, 176, 119, 176]);
    c.restore();
  }
  c.fillStyle = UCON_STATE_COLORS[p.state];
  c.shadowColor = c.fillStyle as string;
  c.shadowBlur = sleeping(p.state) ? 0 : 8;
  ellipse(c, 110, 178, 4.1, 4.1);
  c.fill();
  c.restore();
}
function ears(c: CanvasRenderingContext2D, p: UconBotPose): void {
  const style = p.appearance.ears;
  if (style === 'none') return;
  c.save();
  c.fillStyle = shellPaint(c);
  c.strokeStyle = RIM;
  c.lineWidth = 2.3;
  for (const side of [-1, 1]) {
    c.save();
    c.translate(110, 0);
    c.scale(side, 1);
    c.translate(-110, 0);
    if (style === 'round') {
      ellipse(c, 45, 87, 14, 21);
      c.fill();
      c.stroke();
    } else if (style === 'square') {
      rounded(c, 25, 78, 34, 27, 7);
      c.fill();
      c.stroke();
    } else if (style === 'fin' || style === 'wing') {
      c.beginPath();
      c.moveTo(57, 77);
      c.lineTo(style === 'wing' ? 17 : 29, style === 'wing' ? 51 : 63);
      c.lineTo(style === 'wing' ? 26 : 24, style === 'wing' ? 110 : 102);
      c.lineTo(59, 110);
      c.closePath();
      c.fill();
      c.stroke();
    } else if (style === 'antenna') {
      c.strokeStyle = '#91a9ca';
      c.lineWidth = 4;
      strokeLine(c, [58, 72, 36, 47, 33, 33]);
      c.fillStyle = UCON_STATE_COLORS[p.state];
      ellipse(c, 33, 31, 6, 6);
      c.fill();
    }
    if (style !== 'antenna') {
      c.fillStyle = DARK;
      rounded(c, style === 'square' ? 31 : 37, 85, 15, 12, 4);
      c.fill();
    }
    c.restore();
  }
  c.restore();
}
function helmet(c: CanvasRenderingContext2D): void {
  c.save();
  c.fillStyle = shellPaint(c);
  c.strokeStyle = RIM;
  c.lineWidth = 2;
  ellipse(c, 110, 88, 63, 62);
  c.fill();
  c.stroke();
  const glass = c.createRadialGradient(89, 52, 5, 119, 103, 70);
  glass.addColorStop(0, '#273e60');
  glass.addColorStop(0.43, '#0c192f');
  glass.addColorStop(1, '#040b19');
  c.fillStyle = glass;
  ellipse(c, 110, 89, 55, 54);
  c.fill();
  c.strokeStyle = '#90a7c8';
  c.lineWidth = 1.6;
  c.stroke();
  c.strokeStyle = '#ffffff';
  c.globalAlpha = 0.35;
  c.lineWidth = 5;
  c.beginPath();
  c.ellipse(110, 88, 59, 58, 0, 3.4, 5.08);
  c.stroke();
  c.restore();
}
function headwear(c: CanvasRenderingContext2D, p: UconBotPose): void {
  const a = p.appearance.headwear;
  if (a === 'none') return;
  c.save();
  c.fillStyle = '#6c85b1';
  c.strokeStyle = '#d2e3fb';
  c.lineWidth = 2;
  if (a === 'cap' || a === 'visor') {
    c.beginPath();
    c.moveTo(63, 51);
    c.quadraticCurveTo(110, 8, 157, 51);
    c.lineTo(159, a === 'visor' ? 60 : 56);
    c.quadraticCurveTo(110, a === 'visor' ? 35 : 47, 61, 58);
    c.closePath();
    c.fill();
    c.stroke();
    if (a === 'visor') {
      c.lineWidth = 5;
      strokeLine(c, [66, 56, 154, 56]);
    }
  } else if (a === 'crown') {
    c.beginPath();
    c.moveTo(73, 41);
    c.lineTo(67, 14);
    c.lineTo(90, 28);
    c.lineTo(110, 5);
    c.lineTo(130, 28);
    c.lineTo(153, 14);
    c.lineTo(147, 41);
    c.closePath();
    c.fill();
    c.stroke();
  } else if (a === 'hood') {
    c.beginPath();
    c.arc(110, 87, 68, 3.8, 5.65);
    c.strokeStyle = '#9caed4';
    c.lineWidth = 11;
    c.stroke();
  } else if (a === 'headset') {
    c.beginPath();
    c.arc(110, 90, 66, 3.6, 5.8);
    c.strokeStyle = '#465b80';
    c.lineWidth = 7;
    c.stroke();
    c.fillStyle = '#92a8d3';
    rounded(c, 38, 89, 13, 25, 4);
    c.fill();
    rounded(c, 169, 89, 13, 25, 4);
    c.fill();
  }
  c.restore();
}
function glyph(c: CanvasRenderingContext2D, eyes: UconEyes): void {
  const y = 86;
  if (eyes === 'code') {
    c.font = 'bold 23px ui-monospace, Consolas, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('</>', 110, y + 5);
  } else if (eyes === 'terminal') {
    strokeLine(c, [88, 82, 99, 91, 88, 100]);
    strokeLine(c, [105, 101, 131, 101]);
  } else if (eyes === 'app') {
    for (const x of [95, 113])
      for (const yy of [77, 95]) {
        rounded(c, x, yy, 12, 12, 3);
        c.fill();
      }
  } else if (eyes === 'scan') {
    ellipse(c, 108, 88, 15, 15);
    c.stroke();
    strokeLine(c, [118, 100, 131, 111]);
    strokeLine(c, [83, 91, 92, 91]);
  } else if (eyes === 'nodes') {
    c.lineWidth = 2.5;
    strokeLine(c, [90, 98, 110, 77, 130, 98, 90, 98]);
    for (const [x, yy] of [
      [90, 98],
      [110, 77],
      [130, 98],
    ]) {
      ellipse(c, x, yy, 4.5, 4.5);
      c.fill();
    }
  } else if (eyes === 'shield') {
    c.beginPath();
    c.moveTo(110, 69);
    c.lineTo(129, 76);
    c.lineTo(124, 102);
    c.lineTo(110, 113);
    c.lineTo(96, 102);
    c.lineTo(91, 76);
    c.closePath();
    c.stroke();
    strokeLine(c, [102, 90, 108, 96, 120, 83]);
  } else if (eyes === 'chart') {
    for (const [x, h] of [
      [89, 9],
      [103, 20],
      [117, 15],
      [131, 29],
    ]) {
      rounded(c, x, 111 - h, 9, h, 2);
      c.fill();
    }
  } else if (eyes === 'chat') {
    rounded(c, 89, 77, 42, 27, 10);
    c.stroke();
    for (const x of [98, 110, 122]) {
      ellipse(c, x, 90, 2.5, 2.5);
      c.fill();
    }
  } else if (eyes === 'spark') {
    strokeLine(c, [110, 69, 114, 87, 130, 91, 114, 95, 110, 113, 106, 95, 90, 91, 106, 87, 110, 69]);
  } else {
    for (const x of [91, 129]) {
      if (eyes === 'smile') {
        c.beginPath();
        c.arc(x, y + 4, 8, 3.35, 6.08);
        c.stroke();
      } else {
        ellipse(c, x, 90, 7, 8);
        c.fill();
      }
    }
  }
}

function face(c: CanvasRenderingContext2D, p: UconBotPose): void {
  c.save();
  const color = UCON_STATE_COLORS[p.state];
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 3.7;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowColor = color;
  c.shadowBlur = p.detail === 'mini' || sleeping(p.state) ? 0 : 8;
  c.globalAlpha = sleeping(p.state) ? 0.4 : 1;
  if (sleeping(p.state)) {
    strokeLine(c, [84, 91, 98, 91]);
    strokeLine(c, [122, 91, 136, 91]);
  } else if (p.state === 'error') {
    for (const x of [91, 129]) {
      strokeLine(c, [x - 6, 81, x + 6, 94]);
      strokeLine(c, [x + 6, 81, x - 6, 94]);
    }
  } else if (p.state === 'needs_input' || p.state === 'warning') {
    c.font = 'bold 34px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', 110, 92);
  } else if (p.state === 'thinking' && !p.taskGlyph) {
    c.save();
    c.translate(110, 91);
    c.rotate(p.time * 0.8);
    for (let i = 0; i < 5; i++) {
      c.save();
      c.rotate((i * Math.PI * 2) / 5);
      strokeLine(c, [3, 0, 11, -9, 8, -18]);
      c.restore();
    }
    c.restore();
  } else {
    glyph(c, p.taskGlyph ?? (busy(p.state) ? 'dots' : p.appearance.eyes));
  }
  c.shadowBlur = 0;
  if (p.detail === 'full' && p.appearance.nose !== 'none') {
    c.globalAlpha = 0.45;
    if (p.appearance.nose === 'dot') {
      ellipse(c, 110, 110, 2.4, 2.4);
      c.fill();
    } else if (p.appearance.nose === 'plate') {
      rounded(c, 105, 106, 10, 6, 2);
      c.fill();
    } else {
      strokeLine(c, [110, 106, 106, 114, 114, 114]);
    }
  }
  if (p.detail === 'full' && p.appearance.mouth !== 'none') {
    c.globalAlpha = 0.75;
    c.lineWidth = 2.5;
    if (p.appearance.mouth === 'speaker' || p.state === 'speaking') {
      ellipse(c, 110, 122, 4, 3 + (p.state === 'speaking' ? Math.abs(Math.sin(p.time * 8)) * 3 : 0));
      c.stroke();
    } else if (p.appearance.mouth === 'grin') {
      c.beginPath();
      c.arc(110, 112, 10, 0.22, 2.9);
      c.stroke();
    } else if (p.appearance.mouth === 'soft') {
      c.beginPath();
      c.arc(110, 117, 7, 0.32, 2.82);
      c.stroke();
    } else {
      strokeLine(c, [102, 120, 118, 120]);
    }
  }
  if (p.detail === 'full' && p.appearance.beard !== 'none') {
    c.globalAlpha = 0.74;
    c.strokeStyle = '#b6c9ed';
    c.fillStyle = '#849dc7';
    if (p.appearance.beard === 'short') {
      c.beginPath();
      c.arc(110, 119, 13, 0.25, 2.9);
      c.stroke();
    } else if (p.appearance.beard === 'sage') {
      c.beginPath();
      c.moveTo(101, 124);
      c.quadraticCurveTo(108, 151, 110, 140);
      c.quadraticCurveTo(120, 143, 120, 124);
      c.fill();
    } else {
      strokeLine(c, [94, 119, 106, 132, 110, 127, 114, 132, 126, 119]);
    }
  }
  c.restore();
}

function prop(c: CanvasRenderingContext2D, p: UconBotPose): void {
  const type = p.appearance.prop;
  if (type === 'none') return;
  c.save();
  c.translate(160, 164);
  if (p.detail === 'mini') c.scale(0.66, 0.66);
  c.strokeStyle = '#bbd2f8';
  c.fillStyle = '#344969';
  c.lineWidth = 3;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (type === 'tablet' || type === 'book') {
    c.rotate(0.16);
    rounded(c, -12, -18, 28, 34, 4);
    c.fill();
    c.stroke();
    c.strokeStyle = UCON_STATE_COLORS[p.state];
    c.lineWidth = 2;
    strokeLine(c, [-5, -10, 9, -10]);
    strokeLine(c, [-5, -3, 6, -3]);
  } else if (type === 'wrench') {
    c.rotate(0.5);
    strokeLine(c, [0, -17, 0, 21]);
    c.beginPath();
    c.arc(0, -21, 10, Math.PI * 0.19, Math.PI * 0.82);
    c.stroke();
  } else if (type === 'staff' || type === 'brush') {
    strokeLine(c, [0, 20, 3, -27]);
    c.fillStyle = UCON_STATE_COLORS[p.state];
    ellipse(c, 3, -27, type === 'staff' ? 9 : 6, 8);
    c.fill();
  } else if (type === 'shield') {
    c.beginPath();
    c.moveTo(0, -21);
    c.lineTo(18, -14);
    c.lineTo(14, 14);
    c.lineTo(0, 23);
    c.lineTo(-13, 14);
    c.lineTo(-18, -14);
    c.closePath();
    c.fill();
    c.stroke();
  } else if (type === 'orb') {
    c.fillStyle = UCON_STATE_COLORS[p.state];
    c.shadowBlur = 9;
    c.shadowColor = c.fillStyle as string;
    ellipse(c, 0, 0, 12, 12);
    c.fill();
  } else if (type === 'scanner') {
    rounded(c, -15, -9, 28, 20, 5);
    c.fill();
    c.stroke();
    strokeLine(c, [-9, -14, 5, -14]);
  }
  // One visible hand holds the tool; props remain static character accessories.
  c.shadowBlur = 0;
  c.fillStyle = METAL;
  ellipse(c, -15, 9, 7, 7);
  c.fill();
  c.restore();
}

/** Paint slots in anatomical order. Outfit and props belong to the session identity, not its status. */
export function paintUconParts(c: CanvasRenderingContext2D, p: UconBotPose): void {
  c.save();
  c.translate(0, Math.sin(p.time * 1.5) * (p.detail === 'mini' ? 0.8 : 2));
  if (p.isSubagent) {
    c.translate(110, 116);
    c.scale(0.88, 0.88);
    c.translate(-110, -116);
  }
  cloak(c, p);
  torso(c, p);
  ears(c, p);
  helmet(c);
  headwear(c, p);
  face(c, p);
  prop(c, p);
  c.restore();
}
