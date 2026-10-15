/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `agent-plugins` detector (design section 7.3). It finds plugin folders of Claude Code, Codex, Copilot and
 * agent-plugins.org (by manifest, or by a local `source` in one of the three `marketplace.json` locations) and turns
 * each folder into connections by the standard plugin layout. It makes one set of connections per folder and per
 * host; merging the same plugin across hosts is left to `mergeResults`.
 *
 * Boundaries: pure, reads only `inventory.text()`, never throws, never fetches a plugin that lives in another
 * repository, and never copies a literal header or environment value into its output.
 */

import type { Detector, DetectorResult, RepoInventory } from '@/common/integrations/detectors/types';
import { readPlugin } from './plugin/components';
import { discoverRoots } from './plugin/roots';
import { createContext, plain, report } from './plugin/support';

const detect = (inventory: RepoInventory): DetectorResult => {
  const context = createContext(inventory);
  try {
    for (const root of discoverRoots(context)) {
      try {
        const count = readPlugin(context, root);
        context.reasons.push(
          `Plugin "${plain(root.path === '' ? '(gốc repo)' : root.path, 100)}" (${root.origin}): ${count} kết nối`
        );
      } catch {
        report(context, 'unrecognized', 'Gặp lỗi không mong đợi khi đọc một plugin; plugin này bị bỏ', {
          path: root.manifestFile,
        });
      }
    }
  } catch {
    report(context, 'unrecognized', 'Bộ nhận diện agent-plugins gặp lỗi không mong đợi khi tìm plugin');
  }
  return {
    connections: context.connections,
    openItems: context.openItems,
    reasons: context.reasons,
    claimed: [...context.claimed].toSorted(),
  };
};

export const agentPlugins: Detector = { id: 'agent-plugins', version: 1, detect };
