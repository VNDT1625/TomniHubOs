/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BuildingTwo } from '@icon-park/react';
import { CalendarDays, MessagesSquare, Plus, Sparkles, type LucideIcon } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { flattenRoles } from './companyGroups';
import { useCompanyTree } from './useCompanyTree';

type CompanyListProps = {
  onAdd: () => void;
  onOpen: (companyId: string) => void;
};

const FEATURES: readonly { key: 'design' | 'chat' | 'schedule'; icon: LucideIcon }[] = [
  { key: 'design', icon: Sparkles },
  { key: 'chat', icon: MessagesSquare },
  { key: 'schedule', icon: CalendarDays },
];

/** Decorative org chart: a Boss node wired to a lead and its agents. */
const OrgChartArt: React.FC = () => (
  <svg className='hub-company-empty-art' viewBox='0 0 280 170' width='260' height='158' aria-hidden='true'>
    <defs>
      <radialGradient id='hub-company-empty-glow' cx='50%' cy='45%' r='55%'>
        <stop offset='0%' stopColor='currentColor' stopOpacity='0.14' />
        <stop offset='100%' stopColor='currentColor' stopOpacity='0' />
      </radialGradient>
    </defs>
    <ellipse cx='140' cy='80' rx='140' ry='85' fill='url(#hub-company-empty-glow)' />
    <g fill='none' stroke='currentColor' strokeOpacity='0.35' strokeWidth='1.5' strokeDasharray='3 4'>
      <path d='M140 52 V74 M60 74 H220 M60 74 V98 M140 74 V98 M220 74 V98' />
      <path d='M140 128 V140 M110 140 H170 M110 140 V150 M170 140 V150' />
    </g>
    <g className='hub-company-empty-node hub-company-empty-node--boss' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <rect x='108' y='14' width='64' height='38' rx='12' />
      <path d='M128 40 l3 -12 l6 6 l3 -9 l3 9 l6 -6 l3 12 z' />
    </g>
    {[60, 140, 220].map((x) => (
      <g key={x} className='hub-company-empty-node' fill='none' stroke='currentColor' strokeWidth='1.5'>
        <rect x={x - 26} y='98' width='52' height='30' rx='10' />
        <circle cx={x} cy='109' r='4.5' />
        <path d={`M${x - 8} 121 q8 -8 16 0`} />
      </g>
    ))}
    {[110, 170].map((x) => (
      <g key={x} className='hub-company-empty-node hub-company-empty-node--small' fill='none' stroke='currentColor' strokeWidth='1.5'>
        <circle cx={x} cy='157' r='8' />
      </g>
    ))}
  </svg>
);

/** All known companies as cards, plus the entry point to add a new one. */
export const CompanyList: React.FC<CompanyListProps> = ({ onAdd, onOpen }) => {
  const { t } = useTranslation();
  const companies = useCompanyTree(true);

  if (companies.length === 0) {
    return (
      <section className='hub-company hub-company-empty' data-testid='hub-company-list'>
        <div className='hub-company-empty-inner'>
          <OrgChartArt />
          <h2>{t('company.center.emptyState.title')}</h2>
          <p>{t('company.center.emptyState.body')}</p>
          <button
            type='button'
            className='hub-q-btn hub-q-btn--primary hub-company-empty-cta'
            data-testid='hub-company-add'
            onClick={onAdd}
          >
            <Plus size={14} strokeWidth={2} aria-hidden='true' /> {t('company.center.emptyState.cta')}
          </button>
          <ul className='hub-company-empty-features'>
            {FEATURES.map(({ key, icon: Icon }) => (
              <li key={key}>
                <span className='hub-company-card-icon' aria-hidden='true'>
                  <Icon size={15} strokeWidth={1.75} />
                </span>
                <strong>{t(`company.center.emptyState.${key}.title`)}</strong>
                <small>{t(`company.center.emptyState.${key}.body`)}</small>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section className='hub-company' data-testid='hub-company-list'>
      <header className='hub-company-header'>
        <h2>{t('company.center.title')}</h2>
        <button
          type='button'
          className='hub-q-btn hub-q-btn--primary hub-company-header-end'
          data-testid='hub-company-add'
          onClick={onAdd}
        >
          <Plus size={12} strokeWidth={2} aria-hidden='true' /> {t('company.center.add')}
        </button>
      </header>
      <div className='hub-launcher-grid'>
        {companies.map(({ companyId, structure }) => (
          <button
            key={companyId}
            type='button'
            className='hub-app-card'
            data-testid={`hub-company-card-${companyId}`}
            onClick={() => onOpen(companyId)}
          >
            <span className='hub-app-card-icon'>
              <BuildingTwo theme='outline' size={16} fill='currentColor' />
            </span>
            <strong>{companyId}</strong>
            <small>
              {structure
                ? t('company.center.members', { count: flattenRoles(structure.root).length })
                : t('company.center.settings.loading')}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
};
