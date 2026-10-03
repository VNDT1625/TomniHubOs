/**
 * Vietnamese text normalization and abbreviation expander for security pre-flight.
 * Expands common abbreviations (e.g. mk -> mật khẩu, stk -> số tài khoản)
 * and cleans teencode/leetspeak obfuscations so that downstream semantic
 * models (such as Laya) evaluate canonical vocabulary.
 */

const INVISIBLE_CHARS_REGEX = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;

/**
 * Seed dictionary mapping common Vietnamese abbreviations and security terms
 * to canonical forms.
 */
export const VIETNAMESE_SECURITY_SEEDS: Readonly<Record<string, string>> = Object.freeze({
  // Credentials
  mk: 'mật khẩu',
  matkhau: 'mật khẩu',
  matma: 'mật mã',
  pass: 'mật khẩu',
  passwd: 'mật khẩu',
  pw: 'mật khẩu',
  mapin: 'mã pin',
  otp: 'mã OTP',

  // Accounts
  tk: 'tài khoản',
  taikhoan: 'tài khoản',
  stk: 'số tài khoản',
  acc: 'tài khoản',

  // PII / Identification
  cccd: 'căn cước công dân',
  cmnd: 'chứng minh nhân dân',
  sdt: 'số điện thoại',

  // Common platforms
  zalo: 'Zalo',
  fb: 'Facebook',
  tele: 'Telegram',
  vcb: 'Vietcombank',
});

// Matches standalone security tokens surrounded by start/end or natural delimiters,
// excluding dot (.) or slash (/) to prevent matching file extensions (e.g. Makefile.mk) or paths.
const SEED_KEYS_REGEX = new RegExp(
  `(?<=^|[\\s,;:'"\`()\\[\\]{}!?=])(${Object.keys(VIETNAMESE_SECURITY_SEEDS).join('|')})(?=$|[\\s,;:'"\`()\\[\\]{}!?=])`,
  'giu'
);

/**
 * Normalizes teencode, obfuscated characters, and leetspeak without corrupting URLs or code.
 */
export const cleanTeencode = (text: string): string => {
  if (!text) return text;
  // 1. Strip invisible Unicode zero-width characters
  let cleaned = text.replace(INVISIBLE_CHARS_REGEX, '');

  // 2. Normalize single letter obfuscations separated by dots, dashes, or underscores:
  // e.g. "m.k" -> "mk", "z.a.l.o" -> "zalo", "p_a_s_s" -> "pass"
  cleaned = cleaned.replace(/(?<=\b[a-zA-Z])[._-]+(?=[a-zA-Z]\b)/gu, '');

  // 3. Normalize leetspeak @ inside words: e.g. "z@lo" -> "zalo", "p@ss" -> "pass"
  cleaned = cleaned.replace(/(?<=[a-zA-Z])@(?=[a-zA-Z])/gu, 'a');

  return cleaned;
};

/**
 * Expands Vietnamese abbreviations (e.g. mk -> mật khẩu, tk -> tài khoản)
 * using natural word boundaries to avoid replacing file extensions or code words.
 */
export const normalizeVietnameseSlang = (text: string): string => {
  if (!text) return text;
  return text.replace(SEED_KEYS_REGEX, (matched) => {
    const canonical = VIETNAMESE_SECURITY_SEEDS[matched.toLowerCase()];
    return canonical ?? matched;
  });
};

/**
 * Full pre-flight normalization: cleans teencode and expands Vietnamese slang.
 */
export const normalizeOutboundText = (text: string): string => {
  if (!text) return text;
  const cleaned = cleanTeencode(text);
  return normalizeVietnameseSlang(cleaned);
};

const PLATFORMS =
  '(?:zalo|fb|facebook|gmail|google|vcb|vietcombank|techcombank|mbbank|bank|ngân\\s*hàng|wifi|acc|tài\\s*khoản|máy|icloud|email)';
const COLLOQUIAL_EXCLUSIONS = '(?!\\b(?:cái|con|thằng|đứa|này|kia|đó|quá|thật|rồi|chán|bực|sao|sao\\s*mà|lag|đơ)\\b)';

const CREDENTIAL_REGEX = new RegExp(
  `(\\b(?:mật\\s*khẩu|mk|matkhau|pass(?:word)?|pw|mã\\s*pin|otp|token|api[_-]?key)\\b(?:\\s+(?:tài\\s*khoản|acc|wifi|email|fb|zalo|gmail|của\\s+(?:tôi|em|anh|mình)|${PLATFORMS}))*(?:\\s*(?:là|la|:|:=|=)\\s*|\\s+))(${COLLOQUIAL_EXCLUSIONS}[a-zA-Z0-9!@#$%^&*_+~.-]{4,})`,
  'giu'
);

const PII_NUMBERS_REGEX = /(?<=\b(?:số\s*tài\s*khoản|stk|cccd|cmnd)\b[^\r\n:=làla]*[:=làla\s]+)[0-9]{8,16}/giu;

export type DetectedSecretFinding = Readonly<{
  label: string;
  category: 'credential' | 'identity';
  value: string;
  start: number;
  end: number;
}>;

/**
 * Finds all credential or PII occurrences with their exact character offsets and values.
 */
export const findVietnameseCredentials = (text: string): DetectedSecretFinding[] => {
  if (!text) return [];
  const findings: DetectedSecretFinding[] = [];

  // Match credentials
  const credRegex = new RegExp(CREDENTIAL_REGEX.source, 'giu');
  let match: RegExpExecArray | null;
  while ((match = credRegex.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const secretValue = match[2];
    if (secretValue) {
      const start = match.index + prefix.length;
      const end = start + secretValue.length;
      findings.push({
        label: 'password',
        category: 'credential',
        value: secretValue,
        start,
        end,
      });
    }
  }

  // Match PII numbers
  const piiRegex = new RegExp(PII_NUMBERS_REGEX.source, 'giu');
  while ((match = piiRegex.exec(text)) !== null) {
    const value = match[0];
    if (value) {
      findings.push({
        label: 'identity_number',
        category: 'identity',
        value,
        start: match.index,
        end: match.index + value.length,
      });
    }
  }

  return findings.sort((a, b) => a.start - b.start);
};

/**
 * Mask credentials or PII patterns in natural language prompts when Laya detects a leak.
 */
export const redactVietnameseCredentials = (text: string): string => {
  if (!text) return text;
  return text.replace(CREDENTIAL_REGEX, '$1[REDACTED]').replace(PII_NUMBERS_REGEX, '[REDACTED]');
};
