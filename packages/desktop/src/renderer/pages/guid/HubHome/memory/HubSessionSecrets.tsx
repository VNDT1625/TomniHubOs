import React, { useMemo } from 'react';
import { sessionSecretSets } from '@/renderer/services/secretSetsClient';
import { SecretSetsPanel } from './SecretSetsPanel';

type HubSessionSecretsProps = {
  /** Native conversation id. Main resolves its session identity; the renderer never supplies one. */
  sessionId?: string | null;
  active: boolean;
};

/** "Khóa bí mật" in the Hub rail: the temporary secret sets of the selected conversation. */
export const HubSessionSecrets: React.FC<HubSessionSecretsProps> = ({ sessionId = null, active }) => {
  const api = useMemo(() => (sessionId ? sessionSecretSets(sessionId) : null), [sessionId]);
  return <SecretSetsPanel api={api} scope='session' active={active} />;
};
