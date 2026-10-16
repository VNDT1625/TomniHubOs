import { resolveUconAppearance, type UconAppearance, type UconArchetype } from './uconBotConfig';

/**
 * Visual identities belong to the CLI runtime, never to a model selected inside it.
 * Tomny intentionally has NO entry: its existing Core UCON artwork remains unchanged.
 */
export const UCON_CLI_SKINS = [
  { id: 'claude', name: 'Claude Code', color: '#D97757', archetype: 'scholar' },
  { id: 'codex', name: 'Codex CLI', color: '#E8ECEF', archetype: 'engineer' },
  { id: 'gemini', name: 'Gemini CLI', color: '#9B78F2', archetype: 'navigator' },
  { id: 'deepseek', name: 'DeepSeek TUI', color: '#368BFF', archetype: 'analyst' },
  { id: 'cursor', name: 'Cursor Agent', color: '#E6E8F0', archetype: 'guardian' },
  { id: 'opencode', name: 'OpenCode', color: '#D4DAE6', archetype: 'maker' },
  { id: 'kiro', name: 'Kiro CLI', color: '#AD72FA', archetype: 'artist' },
  { id: 'antigravity', name: 'Antigravity', color: '#60CAD8', archetype: 'navigator' },
  { id: 'hermes', name: 'Hermes Agent', color: '#E8B34B', archetype: 'communicator' },
  { id: 'openclaw', name: 'OpenClaw', color: '#F26B48', archetype: 'maker' },
  { id: 'grok', name: 'Grok', color: '#E3E6EC', archetype: 'interface' },
] as const satisfies readonly { id: string; name: string; color: string; archetype: UconArchetype }[];

export type UconCliSkinId = (typeof UCON_CLI_SKINS)[number]['id'];
export type UconCliSkin = (typeof UCON_CLI_SKINS)[number];
const BY_ID = new Map<string, UconCliSkin>(UCON_CLI_SKINS.map((skin) => [skin.id, skin]));
const ALIASES: Readonly<Record<string, UconCliSkinId>> = {
  claude: 'claude',
  'claude-code': 'claude',
  'claude code': 'claude',
  'claude-agent-acp': 'claude',
  codex: 'codex',
  'codex cli': 'codex',
  gemini: 'gemini',
  'gemini cli': 'gemini',
  deepseek: 'deepseek',
  'deepseek tui': 'deepseek',
  'deepseek-tui': 'deepseek',
  cursor: 'cursor',
  'cursor agent': 'cursor',
  'cursor-agent': 'cursor',
  opencode: 'opencode',
  'open code': 'opencode',
  kiro: 'kiro',
  'kiro cli': 'kiro',
  'kiro-cli': 'kiro',
  antigravity: 'antigravity',
  agi: 'antigravity',
  'agi.exe': 'antigravity',
  hermes: 'hermes',
  'hermes agent': 'hermes',
  openclaw: 'openclaw',
  'openclaw gateway': 'openclaw',
  grok: 'grok',
  'grok cli': 'grok',
  'grok-cli': 'grok',
};

/** Explicit CLI id/known CLI display name only. Never inspect model identifiers or prompt text. */
export function resolveUconCliSkin(agentId?: string): UconCliSkin | null {
  const normalized = agentId?.trim().toLowerCase();
  if (!normalized || normalized.length > 60) return null;
  const id = Object.prototype.hasOwnProperty.call(ALIASES, normalized) ? ALIASES[normalized] : undefined;
  return id ? (BY_ID.get(id) ?? null) : null;
}

const CLI_PREFIX = 'uconcli:';
export function parseUconCliAvatar(avatar?: string): UconCliSkin | null {
  if (!avatar?.startsWith(CLI_PREFIX)) return null;
  const id = avatar.slice(CLI_PREFIX.length);
  return BY_ID.get(id) ?? null;
}
export function encodeUconCliAvatar(id: UconCliSkinId): string {
  return CLI_PREFIX + id;
}

export function appearanceForCliSkin(skin: UconCliSkin): UconAppearance {
  const overrides: Partial<UconAppearance> =
    skin.id === 'claude'
      ? { beard: 'none', headwear: 'hood', eyes: 'smile' }
      : skin.id === 'gemini'
        ? { ears: 'wing', headwear: 'crown', prop: 'orb' }
        : skin.id === 'deepseek'
          ? { ears: 'fin', headwear: 'visor', prop: 'scanner' }
          : skin.id === 'cursor'
            ? { ears: 'fin', headwear: 'visor', prop: 'tablet' }
            : skin.id === 'kiro'
              ? { ears: 'none', headwear: 'hood', prop: 'orb' }
              : skin.id === 'antigravity'
                ? { ears: 'antenna', headwear: 'headset', prop: 'orb' }
                : skin.id === 'hermes'
                  ? { ears: 'wing', headwear: 'headset', prop: 'staff' }
                  : skin.id === 'openclaw'
                    ? { ears: 'antenna', headwear: 'cap', prop: 'wrench' }
                    : skin.id === 'grok'
                      ? { ears: 'fin', headwear: 'visor', prop: 'tablet' }
                      : {};
  return resolveUconAppearance(skin.archetype, overrides);
}

type Canvas = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
function path(c: Canvas, points: number[], close = false): void {
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  if (close) c.closePath();
}
function disc(c: Canvas, x: number, y: number, radius: number): void {
  c.beginPath();
  c.arc(x, y, radius, 0, TAU);
}
function polygon(c: Canvas, points: number[]): void {
  path(c, points, true);
  c.fill();
}

/** Small original vector interpretations of CLI symbols, not external logo assets. */
function paintMark(c: Canvas, id: UconCliSkinId): void {
  switch (id) {
    case 'claude':
      for (let i = 0; i < 9; i++) {
        c.save();
        c.rotate((i * TAU) / 9);
        c.lineWidth = i % 2 ? 2.3 : 3.1;
        path(c, [0, -4, 0, -10]);
        c.stroke();
        c.restore();
      }
      disc(c, 0, 0, 3.7);
      c.fill();
      break;
    case 'codex':
      for (let i = 0; i < 6; i++) {
        c.save();
        c.rotate((i * TAU) / 6);
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(-3, -5);
        c.quadraticCurveTo(-1, -12, 5, -9);
        c.quadraticCurveTo(10, -6, 7, -1);
        c.stroke();
        c.restore();
      }
      break;
    case 'gemini':
      c.beginPath();
      c.moveTo(0, -12);
      c.bezierCurveTo(2, -3, 4, -2, 12, 0);
      c.bezierCurveTo(4, 2, 2, 3, 0, 12);
      c.bezierCurveTo(-2, 3, -4, 2, -12, 0);
      c.bezierCurveTo(-4, -2, -2, -3, 0, -12);
      c.fill();
      break;
    case 'deepseek':
      c.beginPath();
      c.moveTo(-12, 1);
      c.quadraticCurveTo(-6, -8, 6, -4);
      c.quadraticCurveTo(10, -6, 11, -11);
      c.lineTo(12, -1);
      c.quadraticCurveTo(11, 10, -2, 9);
      c.quadraticCurveTo(-9, 7, -12, 1);
      c.fill();
      c.clearRect(2, -2, 2.5, 2.5); // whale eye
      break;
    case 'cursor':
      c.lineWidth = 2;
      path(c, [0, -11, 11, -5, 11, 7, 0, 12, -11, 6, -11, -5], true);
      c.stroke();
      path(c, [0, -11, 0, 0, 11, 7]);
      c.stroke();
      path(c, [0, 0, -11, 6]);
      c.stroke();
      break;
    case 'opencode':
      c.fillRect(-11, -10, 7, 7);
      c.fillRect(-11, -1, 7, 7);
      c.fillRect(-2, -10, 7, 7);
      c.fillRect(7, -1, 5, 7);
      c.fillRect(-2, 8, 7, 4);
      c.fillRect(7, 8, 5, 4);
      break;
    case 'kiro':
      c.beginPath();
      c.moveTo(-9, 9);
      c.lineTo(-9, -2);
      c.bezierCurveTo(-9, -15, 9, -15, 9, -2);
      c.lineTo(9, 9);
      c.lineTo(5, 5);
      c.lineTo(1, 9);
      c.lineTo(-3, 5);
      c.closePath();
      c.fill();
      c.save();
      c.fillStyle = '#1D1736';
      disc(c, -3.5, -3, 1.6);
      c.fill();
      disc(c, 3.5, -3, 1.6);
      c.fill();
      c.restore();
      break;
    case 'antigravity':
      polygon(c, [0, -12, 12, 10, 6, 10, 0, -1, -6, 10, -12, 10]);
      c.save();
      c.fillStyle = '#101D2A';
      polygon(c, [0, -2, 4, 6, -4, 6]);
      c.restore();
      break;
    case 'hermes':
      c.lineWidth = 2.2;
      path(c, [0, -10, 0, 12]);
      c.stroke();
      c.beginPath();
      c.moveTo(0, 7);
      c.bezierCurveTo(-10, 5, -9, -1, 0, -2);
      c.bezierCurveTo(9, -3, 10, -8, 0, -9);
      c.stroke();
      polygon(c, [-2, -7, -11, -12, -8, -4]);
      polygon(c, [2, -7, 11, -12, 8, -4]);
      break;
    case 'openclaw':
      c.lineWidth = 3;
      path(c, [-2, 8, -7, 0, -10, -5]);
      c.stroke();
      path(c, [2, 8, 7, 0, 10, -5]);
      c.stroke();
      disc(c, 0, 6, 5);
      c.fill();
      polygon(c, [-11, -11, -4, -7, -8, -2, -12, -5]);
      polygon(c, [11, -11, 4, -7, 8, -2, 12, -5]);
      break;
    case 'grok':
      c.lineWidth = 3.1;
      path(c, [-10, -10, 9, 10]);
      c.stroke();
      c.beginPath();
      c.arc(0, 0, 9, Math.PI * 1.04, Math.PI * 1.66);
      c.stroke();
      c.beginPath();
      c.arc(0, 0, 9, Math.PI * 0.05, Math.PI * 0.55);
      c.stroke();
      break;
  }
}

/** Overlay on the existing Canvas. Brand colors stay independent from runtime eye/status colors. */
export function paintUconCliBrand(c: Canvas, skin: UconCliSkin, isSubagent = false): void {
  c.save();
  if (isSubagent) {
    c.translate(110, 116);
    c.scale(0.88, 0.88);
    c.translate(-110, -116);
  }
  // Shoulder and head seams carry the CLI's accent without changing the neutral shell.
  c.globalAlpha = 0.8;
  c.strokeStyle = skin.color;
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(110, 88, 65, Math.PI * 1.25, Math.PI * 1.75);
  c.stroke();
  c.globalAlpha = 1;
  c.fillStyle = '#101827';
  c.strokeStyle = skin.color;
  c.lineWidth = 2;
  disc(c, 110, 159, 14);
  c.fill();
  c.stroke();
  c.save();
  c.translate(110, 159);
  c.scale(0.84, 0.84);
  c.fillStyle = skin.color;
  c.strokeStyle = skin.color;
  paintMark(c, skin.id);
  c.restore();
  c.restore();
}
