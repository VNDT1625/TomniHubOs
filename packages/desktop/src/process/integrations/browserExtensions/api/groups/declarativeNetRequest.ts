/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `declarativeNetRequest` static rulesets (docs/platform/repotopackage-design.md sections 12.3 and 12.8, spike S-3).
 *
 * Electron 37 blocks with dynamic rules but never switches on the static rulesets of a manifest
 * (`getEnabledRulesets()` is empty). The worker preload therefore asks Main, once per worker start, which rulesets to
 * enable, then calls the extension's own `updateEnabledRulesets`. The list comes from the
 * `declarative_net_request.rule_resources` of the extension that Main resolved from the worker scope, so a ruleset
 * id can never be enabled on a different extension. Only a service worker may ask, and only an extension whose
 * approved manifest holds `declarativeNetRequest` (or `declarativeNetRequestWithHostAccess`).
 *
 * `redirect` rules still need `host_permissions` and `block` rules do not; that is enforced by the browser, not here.
 */

import { z } from 'zod';
import { INTERNAL_DNR_PLAN_METHOD } from '@process/integrations/browserExtensions/api/contract';
import { defineApiMethod, type ApiMethod } from '@process/integrations/browserExtensions/api/types';

export const DNR_PERMISSIONS: readonly string[] = ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess'];

export const createDeclarativeNetRequestApi = (): readonly ApiMethod[] => [
  defineApiMethod({
    name: INTERNAL_DNR_PLAN_METHOD,
    callers: ['service-worker'],
    requires: DNR_PERMISSIONS,
    args: z.tuple([]),
    handle: (context) => ({
      enableRulesetIds: context.grants.staticRulesets.filter((ruleset) => ruleset.enabled).map((ruleset) => ruleset.id),
    }),
  }),
];
