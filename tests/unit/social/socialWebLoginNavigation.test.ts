import { describe, expect, it } from 'vitest';
import { isApprovedSocialLoginNavigation } from '@/process/services/social/socialBridge';

describe('Social Web login top-level navigation policy', () => {
  it('allows provider-owned HTTPS login and its trusted cross-domain identity pages', () => {
    expect(isApprovedSocialLoginNavigation('facebook', 'https://www.facebook.com/login')).toBe(true);
    expect(isApprovedSocialLoginNavigation('facebook', 'https://accountscenter.facebook.com/')).toBe(true);
    expect(isApprovedSocialLoginNavigation('facebook', 'https://www.instagram.com/accounts/login/')).toBe(true);
    expect(isApprovedSocialLoginNavigation('x', 'https://api.x.com/i/flow/login')).toBe(true);
    expect(isApprovedSocialLoginNavigation('reddit', 'https://www.reddit.com/login')).toBe(true);
    expect(isApprovedSocialLoginNavigation('youtube', 'https://accounts.google.com/o/oauth2/')).toBe(true);
    expect(isApprovedSocialLoginNavigation('threads', 'https://www.threads.net/login')).toBe(true);
  });

  it('rejects schemeless, localhost, file, javascript and lookalike phishing URLs', () => {
    for (const url of [
      'https://facebook.com.evil.example/login',
      'http://www.facebook.com/login',
      'file:///C:/Windows/System32/drivers/etc/hosts',
      'javascript:alert(1)',
      'data:text/html,fake',
      'https://localhost/login',
      'https://www.evil.example/',
      'https://facebook.com@attacker.example/path',
      'https://user:pass@facebook.com/login',
      'https://facebook.com.invalid/',
      'not-a-url',
    ]) {
      expect(isApprovedSocialLoginNavigation('facebook', url), url).toBe(false);
    }
    expect(isApprovedSocialLoginNavigation('tiktok', 'https://accounts.google.com/signin')).toBe(false);
    expect(isApprovedSocialLoginNavigation('reddit', 'https://www.x.com/login')).toBe(false);
  });
});
