import { describe, expect, it } from 'vitest';
import { getPasswordStrength, initialsFromName, isValidEmail, slugifyOrganization } from '../src/core';

describe('account validation', () => {
  it('accepts a password only when every strength requirement is met', () => {
    expect(getPasswordStrength('Tomni@2026').valid).toBe(true);
  });

  it('rejects a password that misses a symbol', () => {
    expect(getPasswordStrength('Tomni2026AA').valid).toBe(false);
  });

  it('normalizes an organization name into a stable slug', () => {
    expect(slugifyOrganization('  Công ty Tomni AI  ')).toBe('cong-ty-tomni-ai');
  });

  it('returns a safe fallback initial for an empty name', () => {
    expect(initialsFromName('')).toBe('T');
  });

  it('rejects malformed email input', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
  });
});
