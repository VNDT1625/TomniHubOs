/** User-controlled sidebar pins. A pin is a shortcut, never proof of package installation. */
export const MIN_SIDEBAR_PINS = 3;

export const DEFAULT_NAV_PINS = ['home', 'artifacts', 'schedule', 'company', 'store'] as const;
export const DEFAULT_APP_PINS = [
    'com.tomni.browser:browser',
  'com.tomni.ide:ide',
  'com.tomni.document-studio:document',
  'com.tomni.automation-studio:automation',
  'com.tomni.calculator:calculator',
] as const;

/** Stable package identities for first-login download; not preinstalled artifacts. */
export const DEFAULT_ONBOARDING_APPS = [
  { id: 'com.tomni.browser', name: 'Browser' },
  { id: 'com.tomni.ide', name: 'IDE' },
  { id: 'com.tomni.document-studio', name: 'Document' },
  { id: 'com.tomni.automation-studio', name: 'Automation' },
  { id: 'com.tomni.calculator', name: 'Calculator' },
] as const;

/** Legacy base routes remain available until Browser and IDE finish signed package extraction. */
export const getDefaultAppBaseRoute = (packageId: string): string | undefined => {
  if (packageId === 'com.tomni.browser') return '/browser';
  if (packageId === 'com.tomni.ide') return '/ide';
  return undefined;
};

export const DEFAULT_PACKAGE_SHORTCUTS = [
  { id: 'com.tomni.browser:browser', packageId: 'com.tomni.browser', moduleId: 'browser', title: 'Browser' },
  { id: 'com.tomni.ide:ide', packageId: 'com.tomni.ide', moduleId: 'ide', title: 'IDE' },
  { id: 'com.tomni.document-studio:document', packageId: 'com.tomni.document-studio', moduleId: 'document', title: 'Document' },
  { id: 'com.tomni.automation-studio:automation', packageId: 'com.tomni.automation-studio', moduleId: 'automation', title: 'Automation' },
  { id: 'com.tomni.calculator:calculator', packageId: 'com.tomni.calculator', moduleId: 'calculator', title: 'Calculator' },
] as const;

export const normalizeSidebarPins = (
  raw: unknown,
  available: readonly string[],
  defaults: readonly string[]
): string[] => {
  const allowed = new Set(available);
  const pins = Array.isArray(raw) ? raw : defaults;
  const valid = [...new Set(pins.filter((item): item is string => typeof item === 'string' && allowed.has(item)))];
  // Stale preference records never leave an empty or two-item sidebar.
  for (const id of defaults) {
    if (valid.length >= MIN_SIDEBAR_PINS) break;
    if (allowed.has(id) && !valid.includes(id)) valid.push(id);
  }
  return valid;
};

export const toggleSidebarPin = (
  current: readonly string[],
  id: string,
  allIds: readonly string[]
): string[] => {
  if (!allIds.includes(id)) return [...current];
  if (current.includes(id)) {
    return current.length <= MIN_SIDEBAR_PINS ? [...current] : current.filter((item) => item !== id);
  }
  return [...current, id];
};

export const orderSidebarEntries = <T extends { id: string }>(
  entries: readonly T[],
  pins: readonly string[]
): T[] => {
  const order = new Map(pins.map((id, index) => [id, index]));
  return entries.toSorted((a, b) => {
    const aOrder = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
};

/** Drag & drop changes the order of all functions, not their visibility. */
export function reorderSidebarEntries(available: readonly string[], stored: unknown): string[];
export function reorderSidebarEntries(available: readonly string[], source: string, target: string): string[];
export function reorderSidebarEntries(available: readonly string[], sourceOrStored: unknown, target?: string): string[] {
  const initial = [...new Set(available)];
  if (target === undefined) {
    if (!Array.isArray(sourceOrStored)) return initial;
    const saved = sourceOrStored.filter((id): id is string => typeof id === 'string' && initial.includes(id));
    return [...new Set([...saved, ...initial])];
  }
  if (typeof sourceOrStored !== 'string') return initial;
  const sourceIndex = initial.indexOf(sourceOrStored);
  const targetIndex = initial.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return initial;
  const [item] = initial.splice(sourceIndex, 1);
  initial.splice(targetIndex, 0, item!);
  return initial;
}

export const pinStorageKey = (kind: 'nav' | 'apps', userId?: string): string =>
  `tomni.hub.sidebar.pins.${kind}.${userId ?? 'local'}`;
