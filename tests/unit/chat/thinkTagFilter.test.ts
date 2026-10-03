import { describe, expect, it } from 'vitest';
import { extractThinkingAndContent, hasThinkTags, stripThinkTags } from '@renderer/utils/chat/thinkTagFilter';

describe('thinkTagFilter', () => {
  describe('hasThinkTags', () => {
    it('detects standard <think> tags', () => {
      expect(hasThinkTags('<think>pondering</think>Hello')).toBe(true);
      expect(hasThinkTags('Just text')).toBe(false);
    });

    it('detects <thinking> tags', () => {
      expect(hasThinkTags('<thinking>pondering</thinking>Hello')).toBe(true);
    });

    it('detects unclosed <think> tag during streaming', () => {
      expect(hasThinkTags('<think>currently thinking...')).toBe(true);
    });

    it('detects orphaned </think> tag', () => {
      expect(hasThinkTags('thinking content</think>response')).toBe(true);
    });
  });

  describe('stripThinkTags', () => {
    it('removes complete think blocks and collapses newlines', () => {
      const input = '<think>internal reflection</think>\n\nFinal answer';
      expect(stripThinkTags(input)).toBe('Final answer');
    });

    it('removes MiniMax-style prefix before orphaned </think>', () => {
      const input = 'pre-think\n</think>\nReal answer';
      expect(stripThinkTags(input)).toBe('Real answer');
    });
  });

  describe('extractThinkingAndContent', () => {
    it('extracts complete think block and clean content', () => {
      const raw = '<think>I need to sort this array</think>\nHere is the sorted array: [1, 2, 3]';
      const result = extractThinkingAndContent(raw);
      expect(result.thinking).toBe('I need to sort this array');
      expect(result.content).toBe('Here is the sorted array: [1, 2, 3]');
      expect(result.isThinking).toBe(false);
    });

    it('extracts actively streaming open think block', () => {
      const raw = '<think>Let me consider the edge cases first...';
      const result = extractThinkingAndContent(raw);
      expect(result.thinking).toBe('Let me consider the edge cases first...');
      expect(result.isThinking).toBe(true);
    });

    it('extracts MiniMax style thinking format', () => {
      const raw = 'Evaluating user intent...\n</think>\nHello! How can I help?';
      const result = extractThinkingAndContent(raw);
      expect(result.thinking).toBe('Evaluating user intent...');
      expect(result.content).toBe('Hello! How can I help?');
      expect(result.isThinking).toBe(false);
    });

    it('returns original content when no think tags are present', () => {
      const raw = 'Just a normal response.';
      const result = extractThinkingAndContent(raw);
      expect(result.thinking).toBe('');
      expect(result.content).toBe('Just a normal response.');
      expect(result.isThinking).toBe(false);
    });
  });
});
