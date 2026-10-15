import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeConversationRepository } from '@process/services/database/nativeConversation/repository';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3 })));
});

const message = (id: string, content: Record<string, unknown>) => ({
  id,
  msg_id: id,
  type: 'text',
  position: 'left',
  conversation_id: 'c1',
  created_at: 1,
  content,
});

describe('a /repotopackage run cut off by an app restart', () => {
  it('shows the progress it had saved with an interruption notice, and leaves a finished run unchanged', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-repo-run-'));
    dirs.push(dir);
    const file = path.join(dir, 'conversations.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        conversations: [],
        messages: [
          message('running', { content: 'clone ok', replace: true, repoRun: 'running' }),
          message('done', { content: 'finished', replace: true, repoRun: 'done' }),
        ],
      }),
      'utf8'
    );

    const messages = await new NativeConversationRepository(file).listMessages('c1');
    const running = messages.find((item) => item.id === 'running')?.content as { content: string; repoRun: string };
    expect(running.repoRun).toBe('interrupted');
    expect(running.content).toContain('clone ok');
    expect(running.content).toContain('gián đoạn');
    expect(messages.find((item) => item.id === 'done')?.content).toMatchObject({
      content: 'finished',
      repoRun: 'done',
    });
  });
});
