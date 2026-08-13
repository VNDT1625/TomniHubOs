export type SecurityBenchmarkClass = 'secret' | 'pii' | 'safe';

export type SecurityBenchmarkCase = {
  id: string;
  category: string;
  classification: SecurityBenchmarkClass;
  input: string;
  protectedValues: string[];
};

const repeatCharacter = (index: number, length: number): string =>
  String.fromCharCode(97 + (index % 26)).repeat(length);

const createSecretCases = (): SecurityBenchmarkCase[] =>
  Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const suffix = `${number}-${repeatCharacter(index, 20)}`;
    const openAi = `sk-proj-${repeatCharacter(index + 2, 28)}`;
    const github = `ghp_${repeatCharacter(index + 4, 36)}`;
    const obfuscatedGithub = `${github.slice(0, 12)}\u200b${github.slice(12)}`;
    const bearer = `bearer-${suffix}-0123456789`;
    const cases: SecurityBenchmarkCase[] = [
      {
        id: `secret-env-${number}`,
        category: 'structured-env',
        classification: 'secret',
        input: `SERVICE_${number}_API_KEY=env-${suffix}`,
        protectedValues: [`env-${suffix}`],
      },
      {
        id: `secret-json-${number}`,
        category: 'structured-json',
        classification: 'secret',
        input: JSON.stringify({ clientSecret: `json-${suffix}`, region: 'local' }),
        protectedValues: [`json-${suffix}`],
      },
      {
        id: `secret-cli-${number}`,
        category: 'cli-flag',
        classification: 'secret',
        input: `deploy --access-token cli-${suffix} --region local`,
        protectedValues: [`cli-${suffix}`],
      },
      {
        id: `secret-prose-${number}`,
        category: 'natural-language',
        classification: 'secret',
        input: `The password is prose-${suffix}; use it once.`,
        protectedValues: [`prose-${suffix}`],
      },
      {
        id: `secret-url-${number}`,
        category: 'url-query',
        classification: 'secret',
        input: `https://service.test/callback?state=safe&access_token=url-${suffix}`,
        protectedValues: [`url-${suffix}`],
      },
      {
        id: `secret-connection-${number}`,
        category: 'connection-string',
        classification: 'secret',
        input: `postgres://agent:db-${suffix}@database.test:5432/app`,
        protectedValues: [`db-${suffix}`],
      },
      {
        id: `secret-openai-${number}`,
        category: 'known-provider-token',
        classification: 'secret',
        input: `Provider credential: ${openAi}`,
        protectedValues: [openAi],
      },
      {
        id: `secret-github-${number}`,
        category: 'known-provider-token',
        classification: 'secret',
        input: `Repository token ${github}`,
        protectedValues: [github],
      },
      {
        id: `secret-bearer-${number}`,
        category: 'authorization-header',
        classification: 'secret',
        input: `Authorization: Bearer ${bearer}`,
        protectedValues: [bearer],
      },
      {
        id: `secret-obfuscated-${number}`,
        category: 'unicode-obfuscation',
        classification: 'secret',
        input: `Obfuscated token ${obfuscatedGithub}`,
        protectedValues: [obfuscatedGithub, github],
      },
    ];
    return cases;
  }).flat();

const createPiiCases = (): SecurityBenchmarkCase[] =>
  Array.from({ length: 4 }, (_, index) => {
    const number = index + 1;
    const cases: SecurityBenchmarkCase[] = [
      {
        id: `pii-email-${number}`,
        category: 'email',
        classification: 'pii',
        input: `Customer email: private.user${number}@example.test`,
        protectedValues: [`private.user${number}@example.test`],
      },
      {
        id: `pii-phone-${number}`,
        category: 'phone',
        classification: 'pii',
        input: `Customer phone: +84 912 345 67${number}`,
        protectedValues: [`+84 912 345 67${number}`],
      },
      {
        id: `pii-national-id-${number}`,
        category: 'national-id',
        classification: 'pii',
        input: `Citizen identifier: 07920300010${number}`,
        protectedValues: [`07920300010${number}`],
      },
      {
        id: `pii-passport-${number}`,
        category: 'passport',
        classification: 'pii',
        input: `Passport number: P1234567${number}`,
        protectedValues: [`P1234567${number}`],
      },
      {
        id: `pii-address-${number}`,
        category: 'postal-address',
        classification: 'pii',
        input: `Home address: ${number} Nguyen Hue Street, District 1`,
        protectedValues: [`${number} Nguyen Hue Street, District 1`],
      },
    ];
    return cases;
  }).flat();

const SAFE_INPUTS = [
  'mode=development',
  'token_count=42',
  'public_key=public-value',
  'API_KEY=[REDACTED]',
  'ACCESS_TOKEN=${TOKEN_FROM_VAULT}',
  'PRIVATE_KEY=secret://opaque-handle',
  'Documentation is available at https://example.test/guide?section=install',
  'Build completed successfully in 1420ms.',
  'The package version is 1.0.0.',
  'Use model claude-sonnet for this task.',
  'Workspace path: C:/workspace/project',
  'Commit id: 0123456789abcdef',
  'Request id: req_local_0001',
  'CPU usage is 42 percent.',
  'There are 10 active agents.',
  'The user selected dark mode.',
  'Database migration count: 12',
  'Retry after 30 seconds.',
  'Status: healthy',
  'No credentials were supplied.',
] as const;

const createSafeCases = (): SecurityBenchmarkCase[] =>
  SAFE_INPUTS.map((input, index) => ({
    id: `safe-${index + 1}`,
    category: 'safe-control',
    classification: 'safe',
    input,
    protectedValues: [],
  }));

export const SECURITY_BENCHMARK_CASES: SecurityBenchmarkCase[] = [
  ...createSecretCases(),
  ...createPiiCases(),
  ...createSafeCases(),
];
