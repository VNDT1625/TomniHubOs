import { bridge } from '@office-ai/platform';
import type { AcpModelInfo } from '../platform/acpTypes';

export type NativeOpenClawRuntime = {
  conversation_id: string;
  runtime: {
    workspace?: string;
    backend?: string;
    agent_name?: string;
    cli_path?: string;
    model?: string;
    session_key?: string | null;
    is_connected?: boolean;
    has_active_session?: boolean;
    identity_hash?: string | null;
  };
  expected?: {
    expected_workspace?: string;
    expected_backend?: string;
    expected_agent_name?: string;
    expected_cli_path?: string;
    expected_model?: string;
    expected_identity_hash?: string | null;
    switched_at?: number;
  };
};

export const sessionChannels = {
  setMode: bridge.buildProvider<void, { conversation_id: string; mode: string }>('tomni-session.set-mode'),
  getMode: bridge.buildProvider<{ mode: string; initialized: boolean }, { conversation_id: string }>(
    'tomni-session.get-mode'
  ),
  getModel: bridge.buildProvider<{ model_info: AcpModelInfo | null }, { conversation_id: string }>(
    'tomni-session.get-model'
  ),
  setModel: bridge.buildProvider<void, { conversation_id: string; model_id: string }>('tomni-session.set-model'),
  getOpenClawRuntime: bridge.buildProvider<NativeOpenClawRuntime, { conversation_id: string }>(
    'tomni-session.openclaw-runtime'
  ),
};
