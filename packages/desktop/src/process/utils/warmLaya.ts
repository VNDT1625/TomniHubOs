/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

// Imported for its side effect, before the heavy bridge modules, so the Laya sidecar loads its model in a
// separate process while the rest of the app starts. Cold start takes tens of seconds; nothing waits for it.
import { LAYA_WARMUP } from '../services/chatPipeline/decisionTasks';
import { getSharedLayaSidecarClient } from '../services/security/layaSidecarClient';

const SKIP_FLAGS = ['--version', '-v', '--resetpass'];

if (process.env.TOMNY_LAYA_EAGER !== '0' && !process.argv.some((arg) => SKIP_FLAGS.includes(arg))) {
  const client = getSharedLayaSidecarClient();
  client.setWarmup(LAYA_WARMUP.state, LAYA_WARMUP.questions);
  client.start().catch(() => {
    // The chat pipeline falls back to its deterministic checks when Laya cannot start.
  });
}
