/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { buildConversationOutline, type OutlineHeading, type OutlineTurn } from '@/renderer/utils/chat/outlineParser';
import styles from './MessageOutlineNavigator.module.css';

interface MessageOutlineNavigatorProps {
  items: Array<any>;
  scrollerElement?: HTMLDivElement | null;
}

const MessageOutlineNavigator: React.FC<MessageOutlineNavigatorProps> = ({ items, scrollerElement }) => {
  const turns = useMemo(() => buildConversationOutline(items), [items]);
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(0);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Clear hover timer
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Set hovered turn with delay support
  const handleMouseEnter = useCallback(
    (turnId: string) => {
      clearHoverTimer();
      setHoveredTurnId(turnId);
    },
    [clearHoverTimer]
  );

  const handleMouseLeave = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setHoveredTurnId(null);
    }, 250);
  }, [clearHoverTimer]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearHoverTimer();
  }, [clearHoverTimer]);

  // Detect which turn is currently active based on scroller position
  useEffect(() => {
    if (!scrollerElement || turns.length === 0) return;

    const handleScroll = () => {
      const scrollerRect = scrollerElement.getBoundingClientRect();
      const triggerY = scrollerRect.top + 100;

      let currentActive = 0;
      for (let i = 0; i < turns.length; i++) {
        const el = document.getElementById(`message-${turns[i].userMessageId}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= triggerY) {
            currentActive = i;
          }
        }
      }
      setActiveTurnIndex(currentActive);
    };

    scrollerElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollerElement.removeEventListener('scroll', handleScroll);
    };
  }, [scrollerElement, turns]);

  // Scroll to turn
  const handleScrollToTurn = useCallback((turn: OutlineTurn, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetEl = document.getElementById(`message-${turn.userMessageId}`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Scroll to specific heading inside assistant message
  const handleScrollToHeading = useCallback((heading: OutlineHeading, e: React.MouseEvent) => {
    e.stopPropagation();
    const messageEl = document.getElementById(`message-${heading.messageId}`);
    if (messageEl) {
      const shadow = messageEl.querySelector('.markdown-shadow')?.shadowRoot;
      const container = shadow || messageEl;
      const headings = container.querySelectorAll('h1, h2, h3');
      const targetHeading = headings[heading.headingIndex] as HTMLElement | undefined;
      if (targetHeading) {
        targetHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, []);

  // Don't render if there's nothing significant to navigate (less than 2 turns and 0 headings)
  if (turns.length === 0 || (turns.length < 2 && turns[0].headings.length === 0)) {
    return null;
  }

  return (
    <div className={styles.container} data-testid='outline-navigator'>
      {turns.map((turn, index) => {
        const isActive = activeTurnIndex === index;
        const isHovered = hoveredTurnId === turn.id;

        return (
          <div
            key={turn.id}
            className={styles.railItem}
            onMouseEnter={() => handleMouseEnter(turn.id)}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => handleScrollToTurn(turn, e)}
            title={`Turn ${turn.turnIndex}: ${turn.title}`}
          >
            {/* Level 1 Dash indicator */}
            <div
              className={classNames(styles.dashL1, {
                [styles.dashL1Active]: isActive,
              })}
            />

            {/* Flyout Card on hover */}
            {isHovered && (
              <div
                className={styles.flyoutCard}
                onMouseEnter={clearHoverTimer}
                onMouseLeave={handleMouseLeave}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Turn Header */}
                <div className={styles.turnHeader} onClick={(e) => handleScrollToTurn(turn, e)} title={turn.title}>
                  <span className={styles.turnBadge}>Turn {turn.turnIndex}</span>
                  <span className={styles.turnTitle}>{turn.title}</span>
                </div>

                {/* Headings List */}
                {turn.headings.length > 0 && (
                  <div className={styles.headingList}>
                    {turn.headings.map((heading) => (
                      <div
                        key={heading.id}
                        className={classNames(styles.headingItem, {
                          [styles.headingL2]: heading.level === 2,
                          [styles.headingL3]: heading.level === 3,
                        })}
                        onClick={(e) => handleScrollToHeading(heading, e)}
                        title={heading.title}
                      >
                        <div className={heading.level === 2 ? styles.dashL2 : styles.dashL3} />
                        <span className={styles.headingText}>{heading.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(MessageOutlineNavigator);
