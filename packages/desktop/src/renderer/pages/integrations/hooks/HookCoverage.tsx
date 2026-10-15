/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { HookSettingsCoverageRow } from '@/common/integrations/hooks/hookSettings';

type HookCoverageProps = { coverage: HookSettingsCoverageRow[] };

/**
 * States, per kind of agent, whether a tool hook can stop its tools. The rows come from the same table the runtime
 * uses, so this page cannot claim more than the runtime does.
 */
const HookCoverage: React.FC<HookCoverageProps> = ({ coverage }) => {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section className='hooks-section hooks-coverage' aria-labelledby={headingId} data-testid='hook-coverage'>
      <h3 id={headingId} className='hooks-section-title'>
        {t('settings.hooks.coverage.title')}
      </h3>
      <p className='hooks-hint'>{t('settings.hooks.coverage.summary')}</p>
      <ul className='hooks-coverage-list'>
        {coverage.map((row) => (
          <li key={row.agent} className='hooks-coverage-row' data-agent={row.agent} data-pre={row.preToolUse}>
            <strong>{t(`settings.hooks.coverage.agent.${row.agent}`)}</strong>
            <span className='hooks-coverage-pre' data-level={row.preToolUse}>
              {t('settings.hooks.coverage.preLabel')}: {t(`settings.hooks.coverage.pre.${row.preToolUse}`)}
            </span>
            <span className='hooks-coverage-post'>
              {t('settings.hooks.coverage.postLabel')}: {t(`settings.hooks.coverage.post.${row.postToolUse}`)}
            </span>
          </li>
        ))}
      </ul>
      <p className='hooks-hint'>{t('settings.hooks.coverage.ownHooks')}</p>
    </section>
  );
};

export default HookCoverage;
