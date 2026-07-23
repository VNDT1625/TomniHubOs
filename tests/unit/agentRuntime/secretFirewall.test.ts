import { describe, expect, it } from 'vitest';

import { redactSecretText } from '@process/agentRuntime/agentMesh/security';

describe('Secret Firewall', () => {
  it('redacts dotenv assignments selected by high-confidence key names', () => {
    const plaintext = 'plain-secret-value';
    const result = redactSecretText(`export PAYMENTS_API_KEY="${plaintext}"\nSAFE_MODE=true`);

    expect(result.text).toBe('export PAYMENTS_API_KEY="[REDACTED]"\nSAFE_MODE=true');
    expect(result.findings).toEqual([{ name: 'PAYMENTS_API_KEY', type: 'api-key', confidence: 'high' }]);
    expect(JSON.stringify(result)).not.toContain(plaintext);
  });

  it('redacts quoted JSON and unquoted YAML values while preserving syntax', () => {
    const result = redactSecretText('{"clientSecret":"json-value"}\npassword: yaml value # retained comment');

    expect(result.text).toBe('{"clientSecret":"[REDACTED]"}\npassword: [REDACTED] # retained comment');
    expect(result.findings).toEqual([
      { name: 'clientSecret', type: 'secret', confidence: 'high' },
      { name: 'password', type: 'password', confidence: 'high' },
    ]);
  });

  it('redacts PEM private-key bodies and JWTs without returning their plaintext', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature0123456789';
    const pemBody = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
    const input = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----\n${jwt}`;
    const result = redactSecretText(input);

    expect(result.text).toContain('-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----');
    expect(result.text).not.toContain(pemBody);
    expect(result.text).not.toContain(jwt);
    expect(result.findings).toEqual([
      { name: 'PRIVATE_KEY', type: 'pem-private-key', confidence: 'high' },
      { name: 'JWT', type: 'jwt', confidence: 'high' },
    ]);
  });

  it.each([
    ['AKIAIOSFODNN7EXAMPLE', 'AWS_ACCESS_KEY_ID', 'aws-access-key'],
    [`ghp_${'a'.repeat(36)}`, 'GITHUB_TOKEN', 'github-token'],
    [`glpat-${'b'.repeat(24)}`, 'GITLAB_TOKEN', 'gitlab-token'],
    ['xoxb-1234567890-abcdefghijklmnop', 'SLACK_TOKEN', 'slack-token'],
    [`sk_live_${'c'.repeat(24)}`, 'STRIPE_SECRET_KEY', 'stripe-secret-key'],
    [`sk-proj-${'d'.repeat(28)}`, 'OPENAI_API_KEY', 'openai-api-key'],
    [`AIza${'e'.repeat(35)}`, 'GOOGLE_API_KEY', 'google-api-key'],
    [`npm_${'f'.repeat(32)}`, 'NPM_TOKEN', 'npm-token'],
  ] as const)('redacts known token pattern %s', (token, name, type) => {
    const result = redactSecretText(`value=${token}`);

    expect(result.text).toBe('value=[REDACTED]');
    expect(result.findings).toEqual([{ name, type, confidence: 'high' }]);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('leaves already-masked values and opaque references unchanged while reporting safe metadata', () => {
    const input = 'API_KEY=[REDACTED]\nACCESS_TOKEN: ${TOKEN_FROM_VAULT}\nPRIVATE_KEY=secret://opaque-handle';
    const result = redactSecretText(input);

    expect(result.text).toBe(input);
    expect(result.redacted).toBe(false);
    expect(result.findings).toEqual([
      { name: 'API_KEY', type: 'already-masked', confidence: 'high' },
      { name: 'ACCESS_TOKEN', type: 'already-masked', confidence: 'high' },
      { name: 'PRIVATE_KEY', type: 'already-masked', confidence: 'high' },
    ]);
  });

  it('does not redact low-confidence keys or public-key material', () => {
    const input = 'token_count=42\npublic_key=public-value\nmode=development';

    expect(redactSecretText(input)).toEqual({ text: input, findings: [], redacted: false });
  });

  it('recognizes dotenv secrets in line-numbered file output', () => {
    const result = redactSecretText('12: API_TOKEN=line-numbered-secret');

    expect(result.text).toBe('12: API_TOKEN=[REDACTED]');
    expect(result.findings).toEqual([{ name: 'API_TOKEN', type: 'token', confidence: 'high' }]);
  });

  it('detects secrets split by ANSI escapes and zero-width characters', () => {
    const ansiSecret = 'terminal-secret-value';
    const githubToken = `ghp_${'z'.repeat(36)}`;
    const obfuscatedToken = `${githubToken.slice(0, 12)}\u200b${githubToken.slice(12)}`;
    const input = `API_\u001b[31mKEY\u001b[0m=\u001b[8m${ansiSecret}\u001b[0m\n${obfuscatedToken}`;
    const result = redactSecretText(input);

    expect(result.text).not.toContain(ansiSecret);
    expect(result.text).not.toContain(githubToken.slice(12));
    expect(result.text.match(/\[REDACTED\]/gu)).toHaveLength(2);
    expect(result.findings).toEqual([
      { name: 'API_KEY', type: 'api-key', confidence: 'high' },
      { name: 'GITHUB_TOKEN', type: 'github-token', confidence: 'high' },
    ]);
  });

  it('redacts credential query parameters and URL userinfo without hiding ordinary URLs', () => {
    const querySecret = 'oauth-access-secret';
    const password = 'url-password-secret';
    const input = [
      `callback=https://example.test/cb?state=public-state&access_token=${querySecret}`,
      `remote=https://deploy-user:${password}@git.example.test/repo.git`,
      'docs=https://example.test/guide?section=install',
    ].join('\n');
    const result = redactSecretText(input);

    expect(result.text).not.toContain(querySecret);
    expect(result.text).not.toContain(password);
    expect(result.text).toContain('state=public-state');
    expect(result.text).toContain('section=install');
    expect(result.findings).toEqual([
      { name: 'access_token', type: 'token', confidence: 'high' },
      { name: 'URL_PASSWORD', type: 'connection-string', confidence: 'high' },
    ]);
  });

  it('redacts cookie headers but preserves values explicitly masked by the host', () => {
    const result = redactSecretText('Cookie: session=browser-secret; theme=dark\nSet-Cookie: auth=****; Secure');

    expect(result.text).toBe('Cookie: [REDACTED]\nSet-Cookie: [REDACTED]');
    expect(result.text).not.toContain('browser-secret');
  });

  it('does not trust an opaque reference when it contains a query or fragment payload', () => {
    const input = 'API_KEY=secret://opaque-handle?access_token=plaintext-leak';
    const result = redactSecretText(input);

    expect(result.text).toBe('API_KEY=[REDACTED]');
    expect(result.text).not.toContain('plaintext-leak');
    expect(result.findings).toEqual([{ name: 'API_KEY', type: 'api-key', confidence: 'high' }]);
  });
});
