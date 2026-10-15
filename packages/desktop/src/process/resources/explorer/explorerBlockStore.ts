import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExplorerServiceError } from './pathGuard';

/**
 * Durable machine-local block list for the human Explorer.
 *
 * Blocking a folder protects every descendant, so a mutation is refused when its
 * canonical source or target path lies beneath any blocked entry. The store keys on
 * canonical absolute paths so a tree-rooted denial survives later renames of siblings.
 */
export class ExplorerBlockStore {
  private readonly blocked = new Set<string>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now
  ) {}

  private keyOf(value: string): string {
    return process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') this.blocked.add(this.keyOf(entry));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // A corrupt store must fail closed rather than silently unblock everything.
        throw new ExplorerServiceError('IO_ERROR');
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const target = `${this.filePath}.${this.now()}.tmp`;
    await writeFile(target, JSON.stringify([...this.blocked], null, 2), 'utf8');
    await rename(target, this.filePath);
  }

  /** Whether any of the given canonical absolute paths is inside a blocked tree. */
  async isBlocked(canonicalPaths: readonly string[]): Promise<boolean> {
    await this.load();
    for (const candidate of canonicalPaths) {
      if (this.isInside(this.keyOf(candidate))) return true;
    }
    return false;
  }

  /** Same check for a single already-canonical absolute path (used by the agent mutation seam). */
  async isBlockedAbsolute(canonicalPath: string): Promise<boolean> {
    await this.load();
    return this.isInside(this.keyOf(canonicalPath));
  }

  private isInside(key: string): boolean {
    for (const blocked of this.blocked) {
      const relation = path.relative(blocked, key);
      if (relation === '' || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation)))
        return true;
    }
    return false;
  }

  async block(canonicalPaths: readonly string[]): Promise<void> {
    await this.load();
    for (const entry of canonicalPaths) this.blocked.add(this.keyOf(entry));
    this.writeChain = this.writeChain.then(() => this.persist());
    await this.writeChain;
  }

  async unblock(canonicalPaths: readonly string[]): Promise<void> {
    await this.load();
    for (const entry of canonicalPaths) this.blocked.delete(this.keyOf(entry));
    this.writeChain = this.writeChain.then(() => this.persist());
    await this.writeChain;
  }

  /** Canonical absolute entries on the block list, for listing and display. */
  async entries(): Promise<string[]> {
    await this.load();
    return [...this.blocked];
  }
}
