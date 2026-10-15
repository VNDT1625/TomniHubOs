import type { AdapterConnection } from '@/common/packages/adapter';
import { connectionSchema } from '@/common/packages/adapter/connections';
import type { Detector, DetectorResult, RepoInventory } from '../types';

const RULES: readonly Readonly<{
  pattern: RegExp;
  format: 'agents-md' | 'claude-md' | 'gemini-md' | 'cursor-mdc' | 'copilot' | 'windsurf' | 'kiro' | 'plain';
}>[] = [
  { pattern: /(?:^|\/)agents\.md$/iu, format: 'agents-md' },
  { pattern: /(?:^|\/)claude\.md$/iu, format: 'claude-md' },
  { pattern: /(?:^|\/)gemini\.md$/iu, format: 'gemini-md' },
  { pattern: /(?:^|\/)(?:\.cursorrules|\.cursor\/rules\/.+\.mdc)$/iu, format: 'cursor-mdc' },
  { pattern: /(?:^|\/)\.github\/copilot-instructions\.md$/iu, format: 'copilot' },
  { pattern: /(?:^|\/)\.windsurf\/rules\/.+\.(?:md|mdc)$/iu, format: 'windsurf' },
  { pattern: /(?:^|\/)\.kiro\/steering\/.+\.md$/iu, format: 'kiro' },
  { pattern: /(?:^|\/)\.clinerules(?:\/.+\.(?:md|txt))?$/iu, format: 'plain' },
];

const idOf = (path: string): string => {
  const base =
    path
      .split('/')
      .at(-1)
      ?.replace(/\.(?:md|mdc|txt)$/iu, '') ?? 'rules';
  return (
    base
      .replace(/^\./u, '')
      .replace(/[^a-z0-9._-]+/giu, '-')
      .toLowerCase()
      .slice(0, 64) || 'rules'
  );
};

export const rules: Detector = {
  id: 'rules',
  version: 1,
  detect: (inventory: RepoInventory): DetectorResult => {
    const connections: AdapterConnection[] = [];
    const claimed: string[] = [];
    const used = new Set<string>();
    for (const path of inventory.files) {
      const matched = RULES.find((rule) => rule.pattern.test(path));
      if (!matched) continue;
      const base = idOf(path);
      let id = base;
      for (let suffix = 2; used.has(id); suffix += 1) id = `${base.slice(0, 60)}-${suffix}`;
      used.add(id);
      const parsed = connectionSchema.safeParse({
        kind: 'rules',
        id,
        title: path.split('/').at(-1)?.slice(0, 120) ?? id,
        path: `source/${path}`,
        format: matched.format,
      });
      if (parsed.success) connections.push(parsed.data);
      claimed.push(path);
    }
    return {
      connections,
      openItems: [],
      reasons: connections.length ? [`Detected ${connections.length} repository rule files`] : [],
      claimed: claimed.toSorted(),
    };
  },
};
