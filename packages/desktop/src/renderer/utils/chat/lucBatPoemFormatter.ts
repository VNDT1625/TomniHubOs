/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Counts words (syllables) in a line of Vietnamese text.
 */
export function countWords(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Checks if a block of lines constitutes a Vietnamese Luc-Bat (6-8) poem.
 * A Luc-Bat section has alternating 6-word and 8-word lines (at least 2 lines).
 */
export function isLucBatSequence(lines: string[]): boolean {
  const nonEmptyLines = lines.map((l) => l.trim()).filter(Boolean);
  if (nonEmptyLines.length < 2) return false;

  let matches = 0;
  for (let i = 0; i < nonEmptyLines.length - 1; i += 2) {
    const count6 = countWords(nonEmptyLines[i]);
    const count8 = countWords(nonEmptyLines[i + 1]);
    if (count6 === 6 && count8 === 8) {
      matches += 2;
    }
  }

  return matches >= 2 && matches >= nonEmptyLines.length * 0.75;
}

/**
 * Formats a Luc-Bat poem with canonical Vietnamese typography:
 * - 6-syllable lines are indented by 4 spaces.
 * - 8-syllable lines are aligned to margin.
 * - Stanzas (every 4 lines / 2 pairs) are separated by a clean paragraph break.
 */
export function formatLucBatPoem(text: string): string {
  if (!text || typeof text !== 'string') return '';

  const rawLines = text.split('\n');
  const nonEmptyLines = rawLines.map((l) => l.trim()).filter(Boolean);

  if (!isLucBatSequence(nonEmptyLines)) {
    return text;
  }

  const formatted: string[] = [];
  let pairCount = 0;

  for (let i = 0; i < nonEmptyLines.length; i++) {
    const line = nonEmptyLines[i];
    const words = countWords(line);

    if (words === 6) {
      formatted.push('    ' + line);
    } else if (words === 8) {
      formatted.push(line);
      pairCount++;
      // Add a stanza break every 2 pairs (4 lines)
      if (pairCount % 2 === 0 && i < nonEmptyLines.length - 1) {
        formatted.push('');
      }
    } else {
      formatted.push(line);
    }
  }

  return formatted.join('\n');
}
