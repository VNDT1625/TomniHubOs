import type { Assistant } from '@/common/types/agent/assistantTypes';

// Skill info type
/** 'package' skills come from installed packages; the list shows them as read-only, like extension skills. */
export type SkillSource = 'builtin' | 'custom' | 'extension' | 'package';

export type SkillInfo = {
  name: string;
  description: string;
  location: string;
  is_custom: boolean;
  source: SkillSource;
};

// External source type
export type ExternalSource = {
  name: string;
  path: string;
  source: string;
  skills: Array<{ name: string; description: string; path: string }>;
};

// Pending skill to import
export type PendingSkill = {
  path: string;
  name: string;
  description: string;
};

// Builtin auto-injected skill info
export type BuiltinAutoSkill = {
  name: string;
  description: string;
};

export type AssistantListItem = Assistant;
