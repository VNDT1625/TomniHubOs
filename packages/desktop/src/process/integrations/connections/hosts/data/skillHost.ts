/**
 * A package skill is imported only after approval, under a dedicated package-owned directory.
 * No user skill is overwritten, and reconcile only touches the dedicated package tree.
 */
import path from 'node:path';
import type { NativeSkillCatalog } from '@process/resources/nativePlatform/skillCatalog';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ConnectionOf,
  type HostContext,
  type HostCheck,
} from '../../core/types';

type SkillConnection = ConnectionOf<'skill'>;
const MAX_SKILL_MD_BYTES = 128 * 1024;

export type SkillHostDeps = Readonly<{
  catalog: () => Promise<
    Pick<NativeSkillCatalog, 'list' | 'info' | 'importPackage' | 'removePackageSkill' | 'reconcilePackageSkills'>
  >;
}>;

const inspect = async (
  context: HostContext,
  connection: SkillConnection,
  catalog: Awaited<ReturnType<SkillHostDeps['catalog']>>
): Promise<HostCheck> => {
  if (!connection.path.startsWith('source/'))
    return { ok: false, reason: 'Skill must live under source/ in this package.' };
  try {
    const bytes = await context.readPackageFile(`${connection.path}/SKILL.md`);
    if (bytes.length === 0 || bytes.length > MAX_SKILL_MD_BYTES)
      return { ok: false, reason: 'SKILL.md is empty or exceeds 128 KiB.' };
    const directory = path.join(context.packageDirectory, ...connection.path.split('/'));
    const { name } = await catalog.info(directory);
    const existing = (await catalog.list()).find(
      (skill) =>
        skill.name.toLowerCase() === name.toLowerCase() &&
        !(skill.source === 'package' && skill.packageId === context.packageId)
    );
    // Existing package copies from the same package can be re-imported; another owner is a conflict.
    if (existing && !(existing.source === 'package' && existing.packageId === context.packageId))
      return {
        ok: false,
        reason: `Skill "${name}" already exists; keep the existing copy or choose a replacement.`,
        needsInput: true,
      };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'The skill files are missing or unsafe.' };
  }
};

export const createSkillHost = (deps: SkillHostDeps): AnyConnectionHost =>
  defineConnectionHost({
    kind: 'skill',
    check: async (context, connection: SkillConnection) => inspect(context, connection, await deps.catalog()),
    describe: async (context, connection: SkillConnection) => ({
      kind: 'skill',
      title: connection.path.split('/').at(-1) ?? 'Skill',
      lines: [
        { label: 'Type', value: 'Agent skill: data and instructions only, no code execution.' },
        { label: 'Skill folder', value: connection.path },
        { label: 'Ownership', value: `package:${context.packageId}` },
        { label: 'Collision policy', value: 'Never overwrite user or other package skills.' },
      ],
      files: [`${connection.path}/SKILL.md`],
    }),
    enable: async (context, connection: SkillConnection) => {
      const catalog = await deps.catalog();
      const check = await inspect(context, connection, catalog);
      if (check.ok === false) throw new Error(check.reason);
      const directory = path.join(context.packageDirectory, ...connection.path.split('/'));
      const installed = await catalog.importPackage(context.packageId, `skill:${connection.path}`, directory);
      return { installed: [installed.skill_name] };
    },
    disable: async (context, connection: SkillConnection) => {
      await (await deps.catalog()).removePackageSkill(context.packageId, `skill:${connection.path}`);
    },
    reconcile: async ({ keep }) => {
      await (await deps.catalog()).reconcilePackageSkills(keep);
    },
  });
