/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from '@office-ai/platform';
import { initAllBridges } from '../bridge';
import { createKeyedSecretIndex } from '../services/security/keyedSecretIndex';

logger.config({ print: true });

initAllBridges({
  keyedSecretIndex: createKeyedSecretIndex('startup'),
  isTelegramExternalAuthorityGranted: () => true,
});
