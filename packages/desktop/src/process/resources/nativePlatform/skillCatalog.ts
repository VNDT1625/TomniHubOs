import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { SKILL_DOCUMENT_MAX_BYTES, type SkillDocumentData } from '@/common/skills/skillDocument';
import { skillLookupKey, unknownSkillMessage } from '@process/resources/skillDocument/nameMatch';

export type SkillSummary = {
  name: string;
  description: string;
  location: string;
  relative_location?: string;
  is_custom: boolean;
  source: 'builtin' | 'custom' | 'extension' | 'package';
  packageId?: string;
};
export type DetectedSkill = { name: string; description: string; path: string };
export type SkillResource = {
  name: string;
  description: string;
  resource: string;
  content: string;
};

const MAX_SKILL_RESOURCE_BYTES = 128 * 1024;
/** Only the front matter and first lines of a SKILL.md are read while listing; the full file is read on demand. */
const SKILL_HEAD_BYTES = 16 * 1024;
/** Directory entries one catalog scan may visit. Bounds a pathological tree or a link loop. */
const MAX_SCAN_ENTRIES = 20_000;
const PACKAGE_DIR = '.tomny-packages';
const SAFE_PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const PACKAGE_SKILL_LIMIT = 2000;
const PACKAGE_SKILL_BYTES = 20 * 1024 * 1024;

/** Stable, package-owned folder that cannot collide with a person's skill directory. */
const packageSkillKey = (connectionKey: string): string =>
  createHash('sha256').update(connectionKey).digest('hex').slice(0, 32);

/** Never follow links or special files into a package skill copied into the catalog. */
const inspectPackageSkillTree = async (source: string): Promise<void> => {
  let count = 0;
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      if (++count > PACKAGE_SKILL_LIMIT) throw new Error('Package skill has too many files.');
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw new Error('Package skill cannot contain links or special files.');
      if (info.isFile()) {
        total += info.size;
        if (total > PACKAGE_SKILL_BYTES) throw new Error('Package skill exceeds its size limit.');
      }
      if (info.isDirectory()) await visit(target);
    }
  };
  await visit(source);
};

const parseMetadata = (content: string, fallback: string): { name: string; description: string } => {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const body = frontmatter?.[1] ?? '';
  const name = body.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() || fallback;
  const description =
    body.match(/^description:\s*[>|]?-?\s*(.*)$/m)?.[1]?.trim() ||
    content
      .replace(/^---[\s\S]*?---/, '')
      .trim()
      .split(/\r?\n\r?\n/)[0]
      ?.slice(0, 240) ||
    '';
  return { name, description };
};

/** Reads the first {@link SKILL_HEAD_BYTES} of a file as text. Listing needs only the front matter, not a large body. */
const readSkillHead = async (file: string): Promise<string> => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(SKILL_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SKILL_HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
};

const scanRoot = async (root: string, maxDepth = 4): Promise<DetectedSkill[]> => {
  const found: DetectedSkill[] = [];
  const budget = { left: MAX_SCAN_ENTRIES };
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (--budget.left < 0) return;
      const target = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        const metadata = parseMetadata(await readSkillHead(target), path.basename(directory));
        found.push({ ...metadata, path: directory });
      } else if (entry.isDirectory()) await visit(target, depth + 1);
    }
  };
  await visit(path.resolve(root), 0);
  return found;
};

export class NativeSkillCatalog {
  private readonly externalFile: string;
  constructor(
    private readonly userRoot: string,
    private readonly builtinRoots: string[],
    private readonly materializedRoot: string
  ) {
    this.externalFile = path.join(path.dirname(userRoot), 'skill-external-paths.json');
  }
  async list(): Promise<SkillSummary[]> {
    const all: SkillSummary[] = [];
    for (const root of this.builtinRoots)
      for (const skill of await scanRoot(root))
        all.push({
          name: skill.name,
          description: skill.description,
          location: skill.path,
          relative_location: path.relative(root, skill.path),
          is_custom: false,
          source: 'builtin',
        });
    for (const skill of await scanRoot(this.userRoot)) {
      const relative = path.relative(this.userRoot, skill.path);
      const segments = relative.split(path.sep);
      const packageId = segments[0] === PACKAGE_DIR && segments.length === 3 ? segments[1] : undefined;
      all.push({
        name: skill.name,
        description: skill.description,
        location: skill.path,
        relative_location: relative,
        is_custom: packageId === undefined,
        source: packageId === undefined ? 'custom' : 'package',
        ...(packageId === undefined ? {} : { packageId }),
      });
    }
    return [...new Map(all.map((skill) => [skill.name.toLowerCase(), skill])).values()];
  }
  async info(skillPath: string): Promise<{ name: string; description: string }> {
    return parseMetadata(
      await readFile(path.join(path.resolve(skillPath), 'SKILL.md'), 'utf8'),
      path.basename(skillPath)
    );
  }
  /**
   * Reads one skill resource. Accepts the bare skill name or the catalog id `skill:<name>`; a miss names close
   * candidates so the agent can retry with an exact name.
   */
  async read(name: string, resource = 'SKILL.md'): Promise<SkillResource> {
    const skills = await this.list();
    const key = skillLookupKey(name);
    const skill = skills.find((candidate) => candidate.name.toLowerCase() === key);
    if (!skill) throw new Error(unknownSkillMessage(name, skills.map((item) => item.name)));
    const root = await realpath(skill.location);
    const requested = path.resolve(root, resource.trim() || 'SKILL.md');
    let target: string;
    try {
      target = await realpath(requested);
    } catch {
      throw new Error(`Skill resource does not exist: ${resource}`);
    }
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error('Skill resource escapes the skill directory.');
    }
    const metadata = await lstat(target);
    if (!metadata.isFile()) throw new Error('Skill resource must be a file.');
    if (metadata.size > MAX_SKILL_RESOURCE_BYTES) {
      throw new Error(`Skill resource exceeds ${MAX_SKILL_RESOURCE_BYTES} bytes.`);
    }
    return {
      name: skill.name,
      description: skill.description,
      resource: path.relative(root, target).replaceAll(path.sep, '/') || 'SKILL.md',
      content: await readFile(target, 'utf8'),
    };
  }
  /**
   * Reads the SKILL.md of one catalog skill for the read-only viewer. Only skills that `list()` returns can resolve,
   * so no renderer-supplied path is ever opened; links that leave the skill folder and oversized files are refused.
   * Errors are thrown as the stable codes NOT_FOUND, UNREADABLE or TOO_LARGE.
   */
  async readDocument(name: string, packageId?: string): Promise<SkillDocumentData> {
    const wanted = name.trim().toLowerCase();
    const skill = wanted ? (await this.list()).find((candidate) => candidate.name.toLowerCase() === wanted) : undefined;
    if (!skill || (packageId !== undefined && skill.packageId !== packageId)) throw new Error('NOT_FOUND');
    const root = await realpath(skill.location);
    let target: string | undefined;
    for (const file of ['SKILL.md', 'skill.md']) {
      try {
        target = await realpath(path.join(root, file));
        break;
      } catch {
        // Try the other casing; a missing file is reported below.
      }
    }
    if (!target || !target.startsWith(`${root}${path.sep}`)) throw new Error('NOT_FOUND');
    const info = await lstat(target);
    if (!info.isFile()) throw new Error('UNREADABLE');
    if (info.size > SKILL_DOCUMENT_MAX_BYTES) throw new Error('TOO_LARGE');
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.packageId === undefined ? {} : { packageId: skill.packageId }),
      content: await readFile(target, 'utf8'),
    };
  }

  scan(folderPath: string): Promise<DetectedSkill[]> {
    return scanRoot(folderPath);
  }
  async import(skillPath: string, link = false): Promise<{ skill_name: string }> {
    const source = path.resolve(skillPath);
    const metadata = await this.info(source);
    const safeName = metadata.name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    if (!safeName) throw new Error('Skill name is invalid.');
    const destination = path.join(this.userRoot, safeName);
    await mkdir(this.userRoot, { recursive: true });
    await rm(destination, { recursive: true, force: true });
    if (link) await symlink(source, destination, 'junction');
    else await cp(source, destination, { recursive: true, errorOnExist: true });
    return { skill_name: metadata.name };
  }
  /** Installs an isolated, source-labeled copy without ever replacing a user or built-in skill. */
  async importPackage(packageId: string, connectionKey: string, source: string): Promise<{ skill_name: string }> {
    if (!SAFE_PACKAGE_ID.test(packageId) || !connectionKey.startsWith('skill:'))
      throw new Error('Invalid package skill.');
    const metadata = await this.info(source);
    const folder = path.join(this.userRoot, PACKAGE_DIR, packageId, packageSkillKey(connectionKey));
    const resolved = path.resolve(source);
    await inspectPackageSkillTree(resolved);
    const existing = (await this.list()).find(
      (item) =>
        item.name.toLowerCase() === metadata.name.toLowerCase() && path.resolve(item.location) !== path.resolve(folder)
    );
    if (existing) throw new Error(`Skill "${metadata.name}" already exists; choose whether to keep it or replace it.`);
    const previous = await lstat(folder).catch((): undefined => undefined);
    if (previous) {
      if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error('Invalid package skill destination.');
      await rm(folder, { recursive: true, force: true });
    }
    await mkdir(path.dirname(folder), { recursive: true });
    await cp(resolved, folder, { recursive: true, errorOnExist: true, force: false, dereference: false });
    return { skill_name: metadata.name };
  }

  async removePackageSkill(packageId: string, connectionKey: string): Promise<void> {
    if (!SAFE_PACKAGE_ID.test(packageId) || !connectionKey.startsWith('skill:')) return;
    const folder = path.join(this.userRoot, PACKAGE_DIR, packageId, packageSkillKey(connectionKey));
    const info = await lstat(folder).catch((): undefined => undefined);
    if (info?.isDirectory() && !info.isSymbolicLink()) await rm(folder, { recursive: true, force: true });
  }

  /** Reconcile only our dedicated package tree; never remove user or built-in skills. */
  async reconcilePackageSkills(keep: ReadonlySet<string>): Promise<void> {
    const root = path.join(this.userRoot, PACKAGE_DIR);
    const packages = await readdir(root, { withFileTypes: true }).catch((): import('node:fs').Dirent[] => []);
    for (const pkg of packages) {
      if (!pkg.isDirectory() || !SAFE_PACKAGE_ID.test(pkg.name)) continue;
      const dir = path.join(root, pkg.name);
      const valid = new Set(
        [...keep]
          .filter((key) => key.startsWith(`${pkg.name}\u0000skill:`))
          .map((key) => packageSkillKey(key.slice(pkg.name.length + 1)))
      );
      for (const folder of await readdir(dir, { withFileTypes: true })) {
        if (folder.isDirectory() && /^[0-9a-f]{32}$/u.test(folder.name) && !valid.has(folder.name))
          await rm(path.join(dir, folder.name), { recursive: true, force: true });
      }
    }
  }

  async remove(name: string): Promise<void> {
    const target = path.resolve(this.userRoot, name);
    const root = path.resolve(this.userRoot);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Skill name escapes the skill directory.');
    await rm(target, { recursive: true, force: true });
  }
  async materialize(
    conversationId: string,
    names: string[]
  ): Promise<{ skills: Array<{ name: string; source_path: string }> }> {
    const available = await this.list();
    const byName = new Map(available.map((skill) => [skill.name.toLowerCase(), skill]));
    const targetRoot = path.join(this.materializedRoot, conversationId.replace(/[^a-zA-Z0-9._-]/g, '_'));
    await rm(targetRoot, { recursive: true, force: true });
    await mkdir(targetRoot, { recursive: true });
    const skills: Array<{ name: string; source_path: string }> = [];
    for (const name of names) {
      const skill = byName.get(name.toLowerCase());
      if (!skill) continue;
      const destination = path.join(targetRoot, path.basename(skill.location));
      await cp(skill.location, destination, { recursive: true });
      skills.push({ name: skill.name, source_path: destination });
    }
    return { skills };
  }
  async getExternal(): Promise<Array<{ name: string; path: string }>> {
    try {
      const data = JSON.parse(await readFile(this.externalFile, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  async addExternal(item: { name: string; path: string }): Promise<void> {
    const values = (await this.getExternal()).filter((value) => path.resolve(value.path) !== path.resolve(item.path));
    values.push({ name: item.name.trim() || path.basename(item.path), path: path.resolve(item.path) });
    await mkdir(path.dirname(this.externalFile), { recursive: true });
    await writeFile(this.externalFile, JSON.stringify(values, null, 2), 'utf8');
  }
  async removeExternal(externalPath: string): Promise<void> {
    const values = (await this.getExternal()).filter(
      (value) => path.resolve(value.path) !== path.resolve(externalPath)
    );
    await writeFile(this.externalFile, JSON.stringify(values, null, 2), 'utf8');
  }
  async detectExternal(): Promise<Array<{ name: string; path: string; source: string; skills: DetectedSkill[] }>> {
    const values = await this.getExternal();
    return Promise.all(
      values.map(async (value) => ({ ...value, source: 'custom', skills: await scanRoot(value.path) }))
    );
  }
  async commonPaths(home: string): Promise<Array<{ name: string; path: string }>> {
    const candidates = [
      { name: 'Claude', path: path.join(home, '.claude', 'skills') },
      { name: 'Codex', path: path.join(home, '.codex', 'skills') },
      { name: 'Kiro', path: path.join(home, '.kiro', 'skills') },
    ];
    const result = [];
    for (const item of candidates) {
      try {
        if ((await lstat(item.path)).isDirectory()) result.push(item);
      } catch {}
    }
    return result;
  }
}
