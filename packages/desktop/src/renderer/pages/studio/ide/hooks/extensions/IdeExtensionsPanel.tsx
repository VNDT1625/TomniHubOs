import { Button, Empty, Spin, Tag } from '@arco-design/web-react';
import { Attention, Code, Download, Left, PlayOne, Puzzle, Refresh, Right, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PackageContributionDiagnosticCode, PackageIdeActivityGroupId } from '@/common/packages';
import { PackageAppHost } from '@renderer/pages/hub/PackageAppHost';
import { packageClient } from '@renderer/pages/hub/packageClient';
import { presentIdeExtensions, type IdeExtensionSubtab } from './ideExtensionsPresenter';
import { useIdeExtensions } from './useIdeExtensions';

export type IdeExtensionsPanelProps = {
  onOpenStore?: (packageId?: string) => void;
};

type PendingFocus =
  | { type: 'subtab'; key: string }
  | { type: 'group'; id: PackageIdeActivityGroupId }
  | { type: 'open' };

type RuntimePolicyStatus = 'checking' | 'allowed' | 'blocked-sandboxed-web' | 'blocked-unsupported';

type ActiveExtensionRuntime = {
  key: string;
  packageId: string;
  moduleId: string;
  title: string;
  policy: RuntimePolicyStatus;
};

const defaultOpenStore = (packageId?: string): void => {
  window.location.hash = packageId ? `/store/package/${encodeURIComponent(packageId)}` : '/store';
};

const IdeExtensionsPanel: React.FC<IdeExtensionsPanelProps> = ({ onOpenStore = defaultOpenStore }) => {
  const { t } = useTranslation();
  const { state, loading, failed, refresh } = useIdeExtensions();
  const presentation = useMemo(() => (state ? presentIdeExtensions(state) : null), [state]);
  const [activeGroup, setActiveGroup] = useState<PackageIdeActivityGroupId>('codebase');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeRuntime, setActiveRuntime] = useState<ActiveExtensionRuntime | null>(null);
  const subtabButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const groupButtonRefs = useRef(new Map<PackageIdeActivityGroupId, HTMLButtonElement>());
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const policyRequestRef = useRef(0);
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  const active = presentation?.groups.find((group) => group.id === activeGroup);
  const allSubtabs = useMemo(() => presentation?.groups.flatMap((group) => group.subtabs) ?? [], [presentation]);
  const selected = allSubtabs.find((subtab) => subtab.key === selectedKey) ?? null;

  const subtabTitle = useCallback(
    (subtab: IdeExtensionSubtab): string =>
      subtab.titleKey ? t(subtab.titleKey, { defaultValue: subtab.title }) : subtab.title,
    [t]
  );

  useEffect(() => {
    if (selectedKey && active?.subtabs.some((subtab) => subtab.key === selectedKey)) return;
    const nextKey = active?.subtabs[0]?.key ?? null;
    if (selectedKey !== null) {
      pendingFocusRef.current = nextKey ? { type: 'subtab', key: nextKey } : { type: 'group', id: activeGroup };
    }
    setSelectedKey(nextKey);
  }, [active?.subtabs, activeGroup, selectedKey]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target =
      pending.type === 'subtab'
        ? subtabButtonRefs.current.get(pending.key)
        : pending.type === 'group'
          ? groupButtonRefs.current.get(pending.id)
          : openButtonRef.current;
    target?.focus();
    pendingFocusRef.current = null;
  }, [activeRuntime, presentation, selectedKey]);

  useEffect(() => {
    if (!activeRuntime || allSubtabs.some((subtab) => subtab.key === activeRuntime.key)) return;
    policyRequestRef.current += 1;
    const fallbackKey = active?.subtabs[0]?.key;
    pendingFocusRef.current = fallbackKey ? { type: 'subtab', key: fallbackKey } : { type: 'group', id: activeGroup };
    setActiveRuntime(null);
  }, [active?.subtabs, activeGroup, activeRuntime, allSubtabs]);

  const closeRuntime = useCallback((): void => {
    policyRequestRef.current += 1;
    pendingFocusRef.current = { type: 'open' };
    setActiveRuntime(null);
  }, []);

  const openRuntime = useCallback(async (subtab: IdeExtensionSubtab, title: string): Promise<void> => {
    const requestId = policyRequestRef.current + 1;
    policyRequestRef.current = requestId;
    const runtime = {
      key: subtab.key,
      packageId: subtab.packageId,
      moduleId: subtab.moduleId,
      title,
    };
    setActiveRuntime({ ...runtime, policy: 'checking' });
    let policy: RuntimePolicyStatus = 'blocked-unsupported';
    try {
      const listings = await packageClient.list({ installedOnly: true });
      const listing = listings.find((item) => item.installedManifest?.id === subtab.packageId);
      const manifest = listing?.state === 'installed' ? listing.installedManifest : undefined;
      const module = manifest?.modules.find((candidate) => candidate.id === subtab.moduleId);
      if (module?.runtime === 'sandboxed-web') {
        policy = 'blocked-sandboxed-web';
      } else if (
        listing?.state === 'installed' &&
        listing.enabled &&
        listing.delivery !== 'bundled-legacy' &&
        listing.installedTrust === 'signed-first-party' &&
        listing.installedManifest?.publisherId === 'com.tomni' &&
        module?.runtime === 'trusted-react' &&
        module.entrypoint?.toLocaleLowerCase().endsWith('.js')
      ) {
        policy = 'allowed';
      }
    } catch {
      policy = 'blocked-unsupported';
    }
    if (policyRequestRef.current !== requestId) return;
    setActiveRuntime((current) => (current?.key === runtime.key ? { ...runtime, policy } : current));
  }, []);

  const groupLabel = (group: PackageIdeActivityGroupId): string =>
    group === 'codebase' ? t('ide.extensions.groups.codebase') : t('ide.extensions.groups.agentOps');

  const diagnosticLabel = (code: PackageContributionDiagnosticCode): string => {
    switch (code) {
      case 'invalid-package':
        return t('ide.extensions.diagnostics.invalidPackage');
      case 'protected-namespace':
        return t('ide.extensions.diagnostics.protectedNamespace');
      case 'dependency-unavailable':
        return t('ide.extensions.diagnostics.dependencyUnavailable');
      case 'host-api-incompatible':
        return t('ide.extensions.diagnostics.hostApiIncompatible');
      case 'contribution-collision':
        return t('ide.extensions.diagnostics.contributionCollision');
      case 'dangling-reference':
        return t('ide.extensions.diagnostics.danglingReference');
    }
  };

  if (loading && !presentation) {
    return (
      <div
        className='h-full flex-center bg-1'
        role='status'
        aria-live='polite'
        aria-label={t('ide.extensions.loading')}
      >
        <Spin dot />
      </div>
    );
  }

  if (failed && !presentation) {
    return (
      <div className='h-full flex-center bg-1 px-24px' role='alert' aria-live='assertive'>
        <div className='flex flex-col items-center gap-10px'>
          <Empty description={t('ide.extensions.loadFailed')} />
          <Button icon={<Refresh theme='outline' />} onClick={() => void refresh()}>
            {t('ide.extensions.retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (activeRuntime) {
    return (
      <section
        className='h-full min-h-0 flex flex-col bg-1'
        aria-label={t('ide.extensions.runtime.title', { name: activeRuntime.title })}
        data-testid='ide-extension-runtime'
      >
        <header className='shrink-0 flex items-center justify-between gap-16px px-20px py-12px border-b border-b-1 bg-2'>
          <div className='min-w-0 flex items-center gap-12px'>
            <Button
              type='text'
              icon={<Left theme='outline' />}
              aria-label={t('ide.extensions.runtime.back')}
              onClick={closeRuntime}
            >
              {t('ide.extensions.runtime.back')}
            </Button>
            <div className='min-w-0'>
              <h2 className='m-0 text-15px font-650 text-t-primary truncate'>{activeRuntime.title}</h2>
              <p className='m-0 mt-2px text-11px text-t-tertiary font-mono truncate'>
                {activeRuntime.packageId} / {activeRuntime.moduleId}
              </p>
            </div>
          </div>
        </header>
        <div className='shrink-0 flex items-start gap-8px px-20px py-9px border-b border-b-1 bg-warning-light-1 text-11px text-t-secondary'>
          <Attention theme='outline' size={14} className='mt-1px shrink-0 text-warning' />
          <span>{t('ide.extensions.runtime.policyHint')}</span>
        </div>
        <div className='flex-1 min-h-0 overflow-auto p-12px'>
          {activeRuntime.policy === 'checking' ? (
            <div
              className='h-full flex-center'
              role='status'
              aria-live='polite'
              aria-label={t('ide.extensions.runtime.checking')}
            >
              <Spin dot />
            </div>
          ) : activeRuntime.policy === 'allowed' ? (
            <PackageAppHost
              packageId={activeRuntime.packageId}
              moduleId={activeRuntime.moduleId}
              onBack={closeRuntime}
              allowSandboxedWeb={false}
            />
          ) : (
            <div className='h-full flex-center px-24px' role='alert' aria-live='assertive'>
              <div className='max-w-560px rd-12px border border-warning bg-warning-light-1 p-18px text-center'>
                <Attention theme='outline' size={24} className='text-warning' />
                <h3 className='m-0 mt-8px text-14px font-650 text-t-primary'>
                  {t('ide.extensions.runtime.blockedTitle')}
                </h3>
                <p className='m-0 mt-6px text-12px text-t-secondary'>
                  {t(
                    activeRuntime.policy === 'blocked-sandboxed-web'
                      ? 'ide.extensions.runtime.sandboxedWebBlocked'
                      : 'ide.extensions.runtime.unsupportedBlocked'
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className='h-full min-h-0 flex flex-col bg-1' aria-label={t('ide.extensions.title')}>
      <header className='shrink-0 flex items-center justify-between gap-16px px-20px py-14px border-b border-b-1'>
        <div className='min-w-0 flex items-center gap-12px'>
          <span className='size-36px shrink-0 flex-center rd-11px bg-primary-light-1 text-primary'>
            <Puzzle theme='outline' size={20} />
          </span>
          <div className='min-w-0'>
            <div className='flex items-center gap-8px'>
              <h2 className='m-0 text-15px font-650 text-t-primary'>{t('ide.extensions.title')}</h2>
              <Tag size='small'>{t('ide.extensions.installedCount', { count: presentation?.installedCount ?? 0 })}</Tag>
            </div>
            <p className='m-0 mt-2px text-12px text-t-tertiary truncate'>{t('ide.extensions.subtitle')}</p>
          </div>
        </div>
        <div className='shrink-0 flex items-center gap-8px'>
          <Button type='text' icon={<Refresh theme='outline' />} loading={loading} onClick={() => void refresh()}>
            {t('ide.extensions.refresh')}
          </Button>
          <Button type='primary' icon={<Download theme='outline' />} onClick={() => onOpenStore()}>
            {t('ide.extensions.browseStore')}
          </Button>
        </div>
      </header>

      <div className='flex-1 min-h-0 flex'>
        <aside className='w-210px shrink-0 p-12px border-r border-b-1 bg-fill-1'>
          <p className='m-0 mb-8px px-8px text-10px font-700 tracking-wide uppercase text-t-tertiary'>
            {t('ide.extensions.activityGroups')}
          </p>
          <div className='flex flex-col gap-6px'>
            {presentation?.groups.map((group) => {
              const isActive = group.id === activeGroup;
              const Icon = group.id === 'codebase' ? Code : Robot;
              return (
                <Button
                  key={group.id}
                  ref={(node) => {
                    if (node instanceof HTMLButtonElement) groupButtonRefs.current.set(group.id, node);
                    else groupButtonRefs.current.delete(group.id);
                  }}
                  type='text'
                  long
                  aria-pressed={isActive}
                  className={`!h-auto !justify-start !px-10px !py-9px !rd-9px ${
                    isActive ? '!bg-primary-light-1 !text-primary' : '!text-t-secondary hover:!bg-fill-2'
                  }`}
                  onClick={() => {
                    setActiveGroup(group.id);
                    setSelectedKey(group.subtabs[0]?.key ?? null);
                  }}
                >
                  <span className='w-full flex items-center gap-9px'>
                    <Icon theme='outline' size={16} />
                    <span className='min-w-0 flex-1 text-left'>
                      <span className='block text-12px font-600 truncate'>{groupLabel(group.id)}</span>
                      <code className='block text-10px opacity-70'>{group.id}</code>
                    </span>
                    <Tag size='small'>{group.subtabs.length}</Tag>
                  </span>
                </Button>
              );
            })}
          </div>
        </aside>

        <div className='w-300px shrink-0 min-h-0 flex flex-col border-r border-b-1'>
          <div className='shrink-0 px-14px py-11px border-b border-b-1'>
            <p className='m-0 text-12px font-650 text-t-primary'>{groupLabel(activeGroup)}</p>
            <p className='m-0 mt-2px text-11px text-t-tertiary'>{t('ide.extensions.installedSubtabs')}</p>
          </div>
          <div className='flex-1 min-h-0 overflow-auto p-10px'>
            {active?.subtabs.length ? (
              <div className='flex flex-col gap-6px'>
                {active.subtabs.map((subtab) => (
                  <ContributionButton
                    key={subtab.key}
                    buttonRef={(node) => {
                      if (node) subtabButtonRefs.current.set(subtab.key, node);
                      else subtabButtonRefs.current.delete(subtab.key);
                    }}
                    subtab={subtab}
                    title={subtabTitle(subtab)}
                    active={subtab.key === selected?.key}
                    onSelect={() => setSelectedKey(subtab.key)}
                  />
                ))}
              </div>
            ) : (
              <div className='flex flex-col items-center gap-8px py-16px'>
                <Empty description={t('ide.extensions.groupEmpty')} />
                <Button size='small' onClick={() => onOpenStore()}>
                  {t('ide.extensions.findExtensions')}
                </Button>
              </div>
            )}
          </div>
        </div>

        <main className='flex-1 min-w-0 min-h-0 overflow-auto p-20px'>
          {selected ? (
            <SelectedContribution
              subtab={selected}
              title={subtabTitle(selected)}
              openButtonRef={(node) => {
                openButtonRef.current = node instanceof HTMLButtonElement ? node : null;
              }}
              onOpenRuntime={() => void openRuntime(selected, subtabTitle(selected))}
              onOpenStore={onOpenStore}
            />
          ) : (
            <div className='h-full flex-center'>
              <div className='flex flex-col items-center gap-10px'>
                <Empty description={t('ide.extensions.emptyHint')} />
                <Button type='primary' icon={<Download theme='outline' />} onClick={() => onOpenStore()}>
                  {t('ide.extensions.browseStore')}
                </Button>
              </div>
            </div>
          )}

          {presentation?.diagnostics.length ? (
            <aside
              className='mt-18px rd-12px border border-warning bg-warning-light-1 p-12px'
              role='status'
              aria-live='polite'
              aria-label={t('ide.extensions.diagnostics.title')}
            >
              <p className='m-0 flex items-center gap-7px text-12px font-650 text-t-primary'>
                <Attention theme='outline' size={15} className='text-warning' />
                {t('ide.extensions.diagnostics.title')}
              </p>
              <p className='m-0 mt-4px text-11px text-t-secondary'>{t('ide.extensions.diagnostics.redactedHint')}</p>
              <div className='mt-9px flex flex-wrap gap-6px'>
                {presentation.diagnostics.map((diagnostic) => (
                  <Tag key={diagnostic.code} className='!bg-warning-light-1 !text-warning'>
                    {diagnosticLabel(diagnostic.code)} &middot; {diagnostic.count}
                  </Tag>
                ))}
              </div>
            </aside>
          ) : null}
        </main>
      </div>
    </section>
  );
};

const ContributionButton: React.FC<{
  subtab: IdeExtensionSubtab;
  title: string;
  active: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onSelect: () => void;
}> = ({ subtab, title, active, buttonRef, onSelect }) => (
  <Button
    ref={buttonRef}
    type='text'
    long
    aria-current={active ? 'page' : undefined}
    className={`!h-auto !justify-start !px-11px !py-10px !rd-9px ${
      active ? '!bg-primary-light-1 !text-primary' : '!text-t-secondary hover:!bg-fill-2'
    }`}
    onClick={onSelect}
  >
    <span className='w-full min-w-0 flex items-center gap-9px'>
      <Puzzle theme='outline' size={15} className='shrink-0' />
      <span className='min-w-0 flex-1 text-left'>
        <span className='block text-12px font-600 truncate'>{title}</span>
        <span className='block text-10px opacity-70 truncate'>{subtab.packageId}</span>
      </span>
      <Right theme='outline' size={12} className='shrink-0 opacity-60' />
    </span>
  </Button>
);

const SelectedContribution: React.FC<{
  subtab: IdeExtensionSubtab;
  title: string;
  openButtonRef: (node: unknown) => void;
  onOpenRuntime: () => void;
  onOpenStore: (packageId?: string) => void;
}> = ({ subtab, title, openButtonRef, onOpenRuntime, onOpenStore }) => {
  const { t } = useTranslation();
  const activation =
    subtab.activation === 'on-open' ? t('ide.extensions.activation.onOpen') : t('ide.extensions.activation.onStartup');
  return (
    <article className='max-w-720px rd-14px border border-b-1 bg-2 p-18px'>
      <div className='flex items-start justify-between gap-16px'>
        <div className='min-w-0'>
          <Tag className='!bg-primary-light-1 !text-primary'>{t('ide.extensions.selected')}</Tag>
          <h3 className='m-0 mt-10px text-18px font-650 text-t-primary truncate'>{title}</h3>
          <p className='m-0 mt-5px text-12px text-t-secondary'>{t('ide.extensions.selectedHint')}</p>
        </div>
        <div className='shrink-0 flex items-center gap-8px'>
          <Button icon={<Download theme='outline' />} onClick={() => onOpenStore(subtab.packageId)}>
            {t('ide.extensions.openPackage')}
          </Button>
          <Button ref={openButtonRef} type='primary' icon={<PlayOne theme='outline' />} onClick={onOpenRuntime}>
            {t('ide.extensions.runtime.open')}
          </Button>
        </div>
      </div>
      <dl className='m-0 mt-18px grid grid-cols-[120px_minmax(0,1fr)] gap-x-12px gap-y-10px text-12px'>
        <dt className='text-t-tertiary'>{t('ide.extensions.packageLabel')}</dt>
        <dd className='m-0 text-t-primary font-mono truncate'>{subtab.packageId}</dd>
        <dt className='text-t-tertiary'>{t('ide.extensions.moduleLabel')}</dt>
        <dd className='m-0 text-t-primary font-mono truncate'>{subtab.moduleId}</dd>
        <dt className='text-t-tertiary'>{t('ide.extensions.activationLabel')}</dt>
        <dd className='m-0 text-t-primary'>{activation}</dd>
      </dl>
    </article>
  );
};

export default IdeExtensionsPanel;
