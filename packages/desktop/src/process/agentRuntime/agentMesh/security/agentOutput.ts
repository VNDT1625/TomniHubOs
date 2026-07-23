import { redactSecretText } from './secretFirewall';
import type { SecretFinding } from './types';

export type ProtectedAgentText = {
  text: string;
  findings: SecretFinding[];
};

/** Sanitize one outbound text value and expose only non-secret detection metadata. */
export const protectAgentText = (input: string): ProtectedAgentText => {
  const result = redactSecretText(input);
  return { text: result.text, findings: result.findings };
};

/** Sanitize durable agent output and retain safe JSON metadata beside the redacted text. */
export const protectDurableAgentText = (input: string): string => {
  const protectedText = protectAgentText(input);
  return protectedText.findings.length === 0
    ? protectedText.text
    : `${protectedText.text}\n--- secret firewall ---\n${JSON.stringify({ findings: protectedText.findings }, null, 2)}`;
};

/** Build MCP text blocks without corrupting a structured first text payload. */
export const protectedMcpTextContent = (input: string): Array<{ type: 'text'; text: string }> => {
  const protectedText = protectAgentText(input);
  return [
    { type: 'text', text: protectedText.text },
    ...(protectedText.findings.length > 0
      ? [{ type: 'text' as const, text: JSON.stringify({ secretFirewall: { findings: protectedText.findings } }) }]
      : []),
  ];
};
