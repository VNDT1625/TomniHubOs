/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Frontend think tag filter and extractor.
 * Filters or extracts think tags from message content for rendering and streaming.
 */

export interface ExtractedThinkingResult {
  /** Extracted thinking content, stripped of <think> tags */
  thinking: string;
  /** Clean response content without thinking blocks */
  content: string;
  /** Whether the stream is currently inside an open <think> block */
  isThinking: boolean;
}

/**
 * Strip think tags from content
 * @param content - The content to filter
 * @returns Filtered content without think tags
 */
export function stripThinkTags(content: string): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  if (!hasThinkTags(content)) {
    return content;
  }

  return (
    content
      // Step 1: Remove complete <think>...</think> blocks (with optional spaces in tags)
      .replace(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/gi, '')
      // Step 2: Remove complete <thinking>...</thinking> blocks (with optional spaces in tags)
      .replace(/<\s*thinking\s*>([\s\S]*?)<\s*\/\s*thinking\s*>/gi, '')
      // Step 3: Handle MiniMax-style format: content before the FIRST orphaned </think>
      // Models like MiniMax M2.5 omit the opening tag: "thinking content...\n</think>\nresponse"
      .replace(/^[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/i, '')
      // Step 4: Remove any remaining orphaned closing tags (just the tags, preserve surrounding content)
      // When text gets concatenated across tool calls, there may be additional </think> tags
      .replace(/<\s*\/\s*think(?:ing)?\s*>/gi, '')
      // Step 5: Remove any remaining orphaned opening tags
      .replace(/<\s*think(?:ing)?\s*>/gi, '')
      // Step 6: Collapse multiple newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Check if content contains think tags (opening or closing)
 * Also detects orphaned closing tags like </think> without opening <think>
 * @param content - The content to check
 * @returns True if think tags are present
 */
export function hasThinkTags(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return /<\s*\/?\s*think(?:ing)?\s*>/i.test(content);
}

/**
 * Extract thinking content and clean response content from raw text.
 * Handles both complete blocks and actively streaming open blocks.
 */
export function extractThinkingAndContent(raw: string): ExtractedThinkingResult {
  if (!raw || typeof raw !== 'string') {
    return { thinking: '', content: raw ?? '', isThinking: false };
  }

  if (!hasThinkTags(raw)) {
    return { thinking: '', content: raw, isThinking: false };
  }

  const thinkBlocks: string[] = [];

  // Match complete <think>...</think> or <thinking>...</thinking> blocks
  const completeRegex = /<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = completeRegex.exec(raw)) !== null) {
    if (match[1]?.trim()) {
      thinkBlocks.push(match[1].trim());
    }
  }

  // Check for actively streaming open <think> tag without closing tag
  const openTagMatch = /<\s*think(?:ing)?\s*>([\s\S]*)$/i.exec(raw);
  const isOpenStreaming = !!openTagMatch && !/<\s*\/\s*think(?:ing)?\s*>/i.test(openTagMatch[1]);
  if (isOpenStreaming && openTagMatch && openTagMatch[1]?.trim()) {
    thinkBlocks.push(openTagMatch[1].trim());
  }

  // Handle MiniMax-style format: orphaned </think> with text before it
  if (thinkBlocks.length === 0) {
    const orphanedMatch = /^([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/i.exec(raw);
    if (orphanedMatch && orphanedMatch[1]?.trim()) {
      thinkBlocks.push(orphanedMatch[1].trim());
    }
  }

  const thinking = thinkBlocks.join('\n\n').trim();
  const content = stripThinkTags(raw).trim();

  return {
    thinking,
    content,
    isThinking: isOpenStreaming,
  };
}

/**
 * Filter think tags from message content object
 * Handles various message content structures
 * @param content - The message content (string or object)
 * @returns Filtered content
 */
export function filterMessageContent(content: any): any {
  // Handle string content
  if (typeof content === 'string') {
    return hasThinkTags(content) ? stripThinkTags(content) : content;
  }

  // Handle object with content property
  if (content && typeof content === 'object' && 'content' in content) {
    const innerContent = content.content;
    if (typeof innerContent === 'string' && hasThinkTags(innerContent)) {
      return {
        ...content,
        content: stripThinkTags(innerContent),
      };
    }
  }

  return content;
}
