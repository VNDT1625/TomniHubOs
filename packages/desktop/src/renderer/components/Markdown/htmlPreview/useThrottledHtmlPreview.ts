/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef, useState } from 'react';

/** First frame is immediate, incremental iframe reloads are capped during streaming.
 * A completed document flushes synchronously instead of waiting for another tick. */
export const useThrottledHtmlPreview = (source: string, streaming: boolean): string => {
  const [rendered, setRendered] = useState(source);
  const latest = useRef(source);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = source;
    if (!streaming) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setRendered(source);
      return;
    }
    if (timer.current === null) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setRendered(latest.current);
      }, 750);
    }
  }, [source, streaming]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );
  return rendered;
};
