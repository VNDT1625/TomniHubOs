/**
 * Read-only contract for viewing an installed skill's SKILL.md.
 * Main resolves the skill only from the skill catalog (built-in, user, and installed package folders);
 * the renderer never supplies a filesystem path.
 */

/** Largest SKILL.md Main will return. Larger files are refused, not truncated. */
export const SKILL_DOCUMENT_MAX_BYTES = 256 * 1024;

export const SKILL_DOCUMENT_CHANNEL = 'core.skill-document.read';

export type SkillDocumentRequest = {
  /** Skill name as listed by the skill catalog (matched case-insensitively). */
  name: string;
  /** Installed package that owns the skill. When set, a skill of another owner is not found. */
  packageId?: string;
};

export type SkillDocumentData = {
  name: string;
  description: string;
  packageId?: string;
  content: string;
};

export type SkillDocumentErrorCode = 'DENIED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'TOO_LARGE' | 'UNREADABLE';

export type SkillDocumentResult = { ok: true; data: SkillDocumentData } | { ok: false; code: SkillDocumentErrorCode };

export type SkillDocumentNativeAPI = {
  read: (payload: SkillDocumentRequest) => Promise<SkillDocumentResult>;
};
