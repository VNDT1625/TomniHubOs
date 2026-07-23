import type { IChannelPluginStatus, IChannelSession } from '@/common/types/channel/channel';

export type NativeChannelTestResult = { success: boolean; bot_username?: string; error?: string };
export type NativeChannelAdapter = {
  readonly id: string;
  status: () => Promise<IChannelPluginStatus>;
  test: (token: string) => Promise<NativeChannelTestResult>;
  enable: (config: Record<string, unknown>) => Promise<void>;
  disable: () => Promise<void>;
  sessions: () => Promise<IChannelSession[]>;
};

export class NativeChannelRegistry {
  private readonly adapters = new Map<string, NativeChannelAdapter>();

  public register(adapter: NativeChannelAdapter): void {
    if (!adapter.id.trim()) throw new Error('Channel adapter id is required.');
    if (this.adapters.has(adapter.id)) throw new Error(`Channel adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  public require(id: string): NativeChannelAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown native channel: ${id}`);
    return adapter;
  }

  public async statuses(): Promise<IChannelPluginStatus[]> {
    return Promise.all([...this.adapters.values()].map((adapter) => adapter.status()));
  }

  public ids(): string[] {
    return [...this.adapters.keys()].toSorted();
  }
}
