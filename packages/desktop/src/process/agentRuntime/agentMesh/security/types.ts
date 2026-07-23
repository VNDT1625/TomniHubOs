export type SecretConfidence = 'high' | 'medium';

export type SecretFindingType =
  | 'already-masked'
  | 'api-key'
  | 'aws-access-key'
  | 'connection-string'
  | 'github-token'
  | 'gitlab-token'
  | 'google-api-key'
  | 'jwt'
  | 'npm-token'
  | 'openai-api-key'
  | 'password'
  | 'pem-private-key'
  | 'private-key'
  | 'secret'
  | 'slack-token'
  | 'stripe-secret-key'
  | 'token';

/** Non-secret metadata describing one detected or already-protected value. */
export type SecretFinding = {
  name: string;
  type: SecretFindingType;
  confidence: SecretConfidence;
};

/** Result returned at an agent-visible text boundary. Never contains plaintext findings. */
export type SecretFirewallResult = {
  text: string;
  findings: SecretFinding[];
  redacted: boolean;
};
