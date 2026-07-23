import { TomniRemoteEventBroker } from './eventBroker';
import { startTomniRemoteGateway, type TomniRemoteGatewayHost } from './server';
import type { TomniRemoteConversationPort, TomniRemoteEventPayload } from './types';

const events = new TomniRemoteEventBroker();
let conversations: TomniRemoteConversationPort | undefined;
let host: TomniRemoteGatewayHost | undefined;
let startPromise: Promise<TomniRemoteGatewayHost> | undefined;

export const registerTomniRemoteConversations = (port: TomniRemoteConversationPort): void => {
  conversations = port;
};

export const publishTomniRemoteEvent = (event: TomniRemoteEventPayload): void => {
  events.publish(event);
};

export const subscribeTomniRemoteEvents = (
  listener: Parameters<TomniRemoteEventBroker['subscribe']>[0]
): (() => void) => events.subscribe(listener);

export const startRegisteredTomniRemoteGateway = async (input: {
  secret: string;
  language?: string;
}): Promise<TomniRemoteGatewayHost> => {
  if (host) {
    host.configure({ language: input.language });
    return host;
  }
  if (!conversations) throw new Error('Tomni native conversations are not registered.');
  startPromise ??= startTomniRemoteGateway({
    secret: input.secret,
    conversations,
    events,
    language: input.language,
  })
    .then((started) => {
      host = started;
      return started;
    })
    .finally(() => {
      startPromise = undefined;
    });
  return startPromise;
};

export const configureRegisteredTomniRemoteGateway = (input: { language?: string; publicUrl?: string }): boolean => {
  if (!host) return false;
  host.configure(input);
  return true;
};

export const stopRegisteredTomniRemoteGateway = async (): Promise<void> => {
  const current = host;
  host = undefined;
  startPromise = undefined;
  await current?.close();
};
