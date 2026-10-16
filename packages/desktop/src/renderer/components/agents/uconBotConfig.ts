/**
 * UCON appearance is independent of execution state. Presets are visual skins,
 * not statements about an agent's permissions or capabilities.
 */
export const UCON_ARCHETYPES = [
  'core',
  'engineer',
  'scholar',
  'navigator',
  'maker',
  'interface',
  'guardian',
  'artist',
  'analyst',
  'communicator',
] as const;
export type UconArchetype = (typeof UCON_ARCHETYPES)[number];

export type UconEars = 'none' | 'round' | 'fin' | 'wing' | 'square' | 'antenna';
export type UconEyes =
  | 'dots'
  | 'smile'
  | 'code'
  | 'scan'
  | 'nodes'
  | 'terminal'
  | 'app'
  | 'shield'
  | 'chart'
  | 'chat'
  | 'spark';
export type UconNose = 'none' | 'dot' | 'plate' | 'triangle';
export type UconBeard = 'none' | 'short' | 'sage' | 'circuit';
export type UconMouth = 'none' | 'soft' | 'line' | 'speaker' | 'grin';
export type UconHeadwear = 'none' | 'cap' | 'hood' | 'visor' | 'crown' | 'headset';
export type UconOutfit = 'suit' | 'uniform' | 'cloak' | 'robe' | 'armor' | 'jacket';
export type UconApron = 'none' | 'plain' | 'chef' | 'mechanic' | 'lab';
export type UconProp = 'none' | 'tablet' | 'scanner' | 'wrench' | 'staff' | 'shield' | 'orb' | 'brush' | 'book';

export type UconAppearance = {
  ears: UconEars;
  eyes: UconEyes;
  nose: UconNose;
  beard: UconBeard;
  mouth: UconMouth;
  headwear: UconHeadwear;
  outfit: UconOutfit;
  /** Optional layered accessory; does not replace coat/robe. */
  apron?: UconApron;
  prop: UconProp;
};
export type UconAppearanceOverride = Partial<UconAppearance>;

const PRESETS: Record<UconArchetype, Readonly<UconAppearance>> = {
  core: {
    ears: 'none',
    eyes: 'dots',
    nose: 'dot',
    beard: 'none',
    mouth: 'soft',
    headwear: 'none',
    outfit: 'suit',
    prop: 'none',
  },
  engineer: {
    ears: 'fin',
    eyes: 'code',
    nose: 'plate',
    beard: 'none',
    mouth: 'line',
    headwear: 'headset',
    outfit: 'uniform',
    prop: 'tablet',
  },
  scholar: {
    ears: 'round',
    eyes: 'scan',
    nose: 'dot',
    beard: 'sage',
    mouth: 'soft',
    headwear: 'none',
    outfit: 'robe',
    prop: 'book',
  },
  navigator: {
    ears: 'wing',
    eyes: 'nodes',
    nose: 'triangle',
    beard: 'none',
    mouth: 'line',
    headwear: 'visor',
    outfit: 'cloak',
    prop: 'staff',
  },
  maker: {
    ears: 'square',
    eyes: 'terminal',
    nose: 'plate',
    beard: 'short',
    mouth: 'grin',
    headwear: 'cap',
    outfit: 'uniform',
    prop: 'wrench',
  },
  interface: {
    ears: 'none',
    eyes: 'app',
    nose: 'none',
    beard: 'none',
    mouth: 'speaker',
    headwear: 'visor',
    outfit: 'jacket',
    prop: 'tablet',
  },
  guardian: {
    ears: 'square',
    eyes: 'shield',
    nose: 'plate',
    beard: 'none',
    mouth: 'line',
    headwear: 'crown',
    outfit: 'armor',
    prop: 'shield',
  },
  artist: {
    ears: 'wing',
    eyes: 'spark',
    nose: 'dot',
    beard: 'none',
    mouth: 'grin',
    headwear: 'hood',
    outfit: 'cloak',
    prop: 'brush',
  },
  analyst: {
    ears: 'antenna',
    eyes: 'chart',
    nose: 'triangle',
    beard: 'circuit',
    mouth: 'line',
    headwear: 'none',
    outfit: 'jacket',
    prop: 'scanner',
  },
  communicator: {
    ears: 'round',
    eyes: 'chat',
    nose: 'dot',
    beard: 'none',
    mouth: 'soft',
    headwear: 'headset',
    outfit: 'suit',
    prop: 'orb',
  },
};

/** A stable, runtime-independent FNV-1a slot for agents with no configured skin. */
export function archetypeForIdentity(identity: string): UconArchetype {
  if (!identity) return 'core';
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return UCON_ARCHETYPES[(hash >>> 0) % UCON_ARCHETYPES.length];
}

/** Only known slot values are accepted. Malformed persisted preferences fail closed. */
export const UCON_SLOT_OPTIONS: { [K in keyof UconAppearance]: readonly UconAppearance[K][] } = {
  ears: ['none', 'round', 'fin', 'wing', 'square', 'antenna'],
  eyes: ['dots', 'smile', 'code', 'scan', 'nodes', 'terminal', 'app', 'shield', 'chart', 'chat', 'spark'],
  nose: ['none', 'dot', 'plate', 'triangle'],
  beard: ['none', 'short', 'sage', 'circuit'],
  mouth: ['none', 'soft', 'line', 'speaker', 'grin'],
  headwear: ['none', 'cap', 'hood', 'visor', 'crown', 'headset'],
  outfit: ['suit', 'uniform', 'cloak', 'robe', 'armor', 'jacket'],
  apron: ['none', 'plain', 'chef', 'mechanic', 'lab'],
  prop: ['none', 'tablet', 'scanner', 'wrench', 'staff', 'shield', 'orb', 'brush', 'book'],
};

/** User-selected assistant avatar. Stored in the existing validated avatar field (no IPC migration). */
export type UconAvatarChoice = { archetype: UconArchetype; overrides: UconAppearanceOverride };
const PREFIX = 'ucon:';
export function parseUconAvatar(value?: string): UconAvatarChoice | null {
  if (!value?.startsWith(PREFIX) || value.length > 300) return null;
  const [name, ...tokens] = value.slice(PREFIX.length).split(';');
  if (!UCON_ARCHETYPES.includes(name as UconArchetype)) return null;
  const overrides: UconAppearanceOverride = {};
  for (const token of tokens) {
    const pivot = token.indexOf('=');
    if (pivot < 1) return null;
    const slot = token.slice(0, pivot);
    const entry = token.slice(pivot + 1);
    if (!Object.prototype.hasOwnProperty.call(UCON_SLOT_OPTIONS, slot)) return null;
    if (!(UCON_SLOT_OPTIONS[slot as keyof UconAppearance] as readonly string[]).includes(entry)) return null;
    Object.assign(overrides, { [slot]: entry });
  }
  return { archetype: name as UconArchetype, overrides };
}
export function encodeUconAvatar(choice: UconAvatarChoice): string {
  const archetype = UCON_ARCHETYPES.includes(choice.archetype) ? choice.archetype : 'core';
  const preset = resolveUconAppearance(archetype);
  const resolved = resolveUconAppearance(archetype, choice.overrides);
  const custom = (Object.keys(UCON_SLOT_OPTIONS) as (keyof UconAppearance)[])
    .filter((slot) => resolved[slot] !== preset[slot])
    .map((slot) => slot + '=' + resolved[slot]);
  return PREFIX + archetype + (custom.length ? ';' + custom.join(';') : '');
}
/**
 * Subagents inherit outfit, handheld prop and facial fittings, but get a
 * distinctive, lightweight mini silhouette. Never assign a new capability.
 */
export function subagentAppearance(parent: UconAppearance, identity: string): UconAppearance {
  const types: readonly UconEars[] = ['round', 'fin', 'wing', 'square'];
  const index = UCON_ARCHETYPES.indexOf(archetypeForIdentity(identity));
  return {
    ...parent,
    ears: types[index % types.length] === parent.ears ? types[(index + 1) % types.length] : types[index % types.length],
  };
}

export function resolveUconAppearance(
  archetype: UconArchetype = 'core',
  overrides?: UconAppearanceOverride
): UconAppearance {
  const base = PRESETS[archetype] ?? PRESETS.core;
  const result: UconAppearance = { apron: 'none', ...base };
  if (!overrides) return result;
  for (const slot of Object.keys(UCON_SLOT_OPTIONS) as (keyof UconAppearance)[]) {
    const value = overrides[slot];
    if (value !== undefined && (UCON_SLOT_OPTIONS[slot] as readonly string[]).includes(value)) {
      // Every override is a checked member of its corresponding discriminated slot union.
      Object.assign(result, { [slot]: value });
    }
  }
  return result;
}
