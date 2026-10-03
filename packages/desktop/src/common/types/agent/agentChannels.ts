import { bridge } from '@office-ai/platform';
import '@/common/adapter/bridgeErrorWrapper';
import type { AgentHealthResult, AgentMetadata, CustomAgentRequest } from './agentMetadata';

export const agentChannels = {
  getAvailableAgents: bridge.buildProvider<AgentMetadata[], void>('tomni-agent.list'),
  refreshCustomAgents: bridge.buildProvider<void, void>('tomni-agent.refresh'),
  testCustomAgent: bridge.buildProvider<
    { step: 'success' } | { step: 'fail_cli'; error: string } | { step: 'fail_acp'; error: string },
    Pick<CustomAgentRequest, 'command'> & { acp_args?: string[]; env?: Record<string, string> }
  >('tomni-agent.test'),
  createCustomAgent: bridge.buildProvider<AgentMetadata, CustomAgentRequest>('tomni-agent.create'),
  updateCustomAgent: bridge.buildProvider<AgentMetadata, CustomAgentRequest & { id: string }>('tomni-agent.update'),
  deleteCustomAgent: bridge.buildProvider<{ deleted: boolean }, { id: string }>('tomni-agent.remove'),
  setAgentEnabled: bridge.buildProvider<AgentMetadata, { id: string; enabled: boolean }>('tomni-agent.set-enabled'),
  checkAgentHealth: bridge.buildProvider<AgentHealthResult, { backend: string }>('tomni-agent.health'),
};
