import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ExplorerServiceError } from './pathGuard';

/**
 * Durable machine-local folder-grant list for the human Explorer.
 *
 * A grant is given once, in a native consent dialog, and then covers the folder plus every
 * path beneath it for the rest of this install — including after an app restart. Keying on
 * canonical absolute paths keeps that promise stable across sibling renames and across the
 * many places that ask to open a folder (agent workspaces, the composer picker, the default
 * work directory), which previously re-prompted for a folder the user had already approved.
 *
 * A corrupt store fails closed: it must never silently read as "everything granted".
 */
export class ExplorerGrantStore {
  private readonly granted = new Set<string>();
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
          if (typeof entry === 'string') this.granted.add(this.keyOf(entry));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ExplorerServiceError('IO_ERROR');
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const target = `${this.filePath}.${this.now()}.tmp`;
    await writeFile(target, JSON.stringify([...this.granted], null, 2), 'utf8');
    await rename(target, this.filePath);
  }

  /** Whether every given canonical absolute path already sits inside a granted folder. */
  async covers(canonicalPaths: readonly string[]): Promise<boolean> {
    if (canonicalPaths.length === 0) return false;
    await this.load();
    return canonicalPaths.every((candidate) => this.isInside(this.keyOf(candidate)));
  }

  private isInside(key: string): boolean {
    for (const root of this.granted) {
      const relation = path.relative(root, key);
      if (relation === '' || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation)))
        return true;
    }
    return false;
  }

  /** Record a consented folder (native picker, default work dir, or an approved dialog). */
  async grant(root: string): Promise<void> {
    await this.load();
    this.granted.add(this.keyOf(root));
    this.writeChain = this.writeChain.then(() => this.persist());
    await this.writeChain;
  }

  /** Canonical absolute entries on the grant list, for listing and display. */
  async entries(): Promise<string[]> {
    await this.load();
    return [...this.granted];
  }
}
