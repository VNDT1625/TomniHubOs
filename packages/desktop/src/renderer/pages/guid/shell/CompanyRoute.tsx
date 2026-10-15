/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { CompanyCenter, type CompanyFocus } from '../HubHome/company/CompanyCenter';
import { useHubShell } from './hubShellContext';

const readCompanyFocus = (state: unknown): CompanyFocus | undefined => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const focus = (state as Record<string, unknown>).companyFocus;
  if (!focus || typeof focus !== 'object' || Array.isArray(focus)) return undefined;
  const { companyId, groupId, nonce } = focus as Record<string, unknown>;
  if (typeof nonce !== 'number') return undefined;
  return {
    nonce,
    ...(typeof companyId === 'string' ? { companyId } : {}),
    ...(typeof groupId === 'string' ? { groupId } : {}),
  };
};

/** `/company`: the company center rendered in the shell centre. */
const CompanyRoute: React.FC = () => {
  const location = useLocation();
  const shell = useHubShell();
  const focus = useMemo(() => readCompanyFocus(location.state), [location.state]);
  return (
    <CompanyCenter focus={focus} onOpenAgent={(companyId, roleId) => shell?.openCompanyAgent(companyId, roleId)} />
  );
};

export default CompanyRoute;
