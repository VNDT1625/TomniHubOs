import { bridge } from '@office-ai/platform';
import '@/common/adapter/bridgeErrorWrapper';
import type {
  Assistant,
  CreateAssistantRequest,
  ImportAssistantsRequest,
  ImportAssistantsResult,
  SetAssistantStateRequest,
  UpdateAssistantRequest,
} from './assistantTypes';

export const assistantChannels = {
  list: bridge.buildProvider<Assistant[], void>('tomni-assistant.list'),
  create: bridge.buildProvider<Assistant, CreateAssistantRequest>('tomni-assistant.create'),
  update: bridge.buildProvider<Assistant, UpdateAssistantRequest>('tomni-assistant.update'),
  delete: bridge.buildProvider<void, { id: string }>('tomni-assistant.remove'),
  setState: bridge.buildProvider<Assistant, SetAssistantStateRequest>('tomni-assistant.set-state'),
  import: bridge.buildProvider<ImportAssistantsResult, ImportAssistantsRequest>('tomni-assistant.import'),
};
