/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useRef, useState } from 'react';

type FrameIndex = 0 | 1;

/**
 * A srcDoc navigation clears the iframe before its new page paints.
 * Keep the current opaque-origin sandbox visible while the other iframe loads.
 * Swap only after the staged document has completed loading.
 *
 * No iframe is granted allow-same-origin, no direct DOM access and no HTML
 * leaves its sandbox. At most two frames exist at a time.
 */
const SeamlessHtmlFrame: React.FC<{ documentHtml: string }> = ({ documentHtml }) => {
  const [front, setFront] = useState<FrameIndex>(0);
  const [documents, setDocuments] = useState<readonly [string | null, string | null]>(() => [documentHtml, null]);
  const latest = useRef(documentHtml);
  latest.current = documentHtml;

  useEffect(() => {
    const back = front === 0 ? 1 : 0;
    if (documents[front] === documentHtml) {
      // Release the old sandbox after the new one is visible: no hidden
      // background animations or JavaScript keep consuming resources.
      if (documents[back] !== null) {
        setDocuments((current) => (back === 0 ? [null, current[1]] : [current[0], null]));
      }
      return;
    }
    // Switching back to an already-loaded document needs no new navigation.
    if (documents[back] === documentHtml) {
      setFront(back);
      return;
    }
    setDocuments((current) => (back === 0 ? [documentHtml, current[1]] : [current[0], documentHtml]));
  }, [documentHtml, documents, front]);

  const onFrameLoad = (index: FrameIndex) => {
    if (index !== front && documents[index] === latest.current) setFront(index);
  };

  return (
    <div className='tomni-html-live-stage' data-testid='html-live-stage'>
      {documents.map((html, index) =>
        html === null ? null : (
          <iframe
            key={index}
            title='HTML interactive preview'
            className={index === front ? 'tomni-html-live-frame--front' : 'tomni-html-live-frame--back'}
            data-testid={index === front ? 'html-live-frame' : 'html-live-frame-buffer'}
            sandbox='allow-scripts'
            referrerPolicy='no-referrer'
            srcDoc={html}
            aria-hidden={index !== front}
            tabIndex={index === front ? 0 : -1}
            onLoad={() => onFrameLoad(index as FrameIndex)}
          />
        )
      )}
    </div>
  );
};

export default SeamlessHtmlFrame;
