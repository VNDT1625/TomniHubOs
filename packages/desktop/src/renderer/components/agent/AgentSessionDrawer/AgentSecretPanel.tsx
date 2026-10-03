/** Repository secret vault editor. Values are accepted only for Main-process encryption and never read back. */
import { Alert, Button, Empty, Input, Message, Modal, Popconfirm, Spin, Tag } from '@arco-design/web-react';
import { Delete, EditTwo, Lock, Plus, PreviewOpen, Refresh, Save } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  sessionMemoryClient,
  type RepoSecretCombo,
  type RepoSecretContext,
  type RepoSecretScopeSummary,
} from '@/renderer/services/sessionMemoryClient';
import { FolderOpen } from '@icon-park/react';

type AgentSecretPanelProps = { repository?: string | null; active: boolean };
type ComboVariable = {
  id: number;
  key: string;
  value: string;
  originalKey?: string;
  status?: 'set' | 'needs_value';
};

let comboVariableId = 0;
const createComboVariable = (key = '', existing?: { key: string; status: 'set' | 'needs_value' }): ComboVariable => ({
  id: ++comboVariableId,
  key,
  value: '',
  ...(existing ? { originalKey: existing.key, status: existing.status } : {}),
});

const normalizeComboKey = (key: string): string =>
  key
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const keepsStoredValue = (variable: ComboVariable): boolean =>
  variable.status === 'set' && normalizeComboKey(variable.key) === normalizeComboKey(variable.originalKey ?? '');

const normalizeRepositoryScope = (value?: string | null): string =>
  (value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();

const repositoryLabel = (value?: string | null): string => {
  const segments = (value ?? '').replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.at(-1) ?? (value || '');
};

const defaultComboVariables = (): ComboVariable[] => [createComboVariable('USERNAME'), createComboVariable('PASSWORD')];

export const AgentSecretPanel: React.FC<AgentSecretPanelProps> = ({ repository, active }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<RepoSecretContext[]>([]);
  const [combos, setCombos] = useState<RepoSecretCombo[]>([]);
  const [scopes, setScopes] = useState<RepoSecretScopeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alias, setAlias] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState('');
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [revealingAlias, setRevealingAlias] = useState<string | null>(null);
  const [comboVisible, setComboVisible] = useState(false);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [comboName, setComboName] = useState('');
  const [comboDescription, setComboDescription] = useState('');
  const [comboVariables, setComboVariables] = useState<ComboVariable[]>(defaultComboVariables);
  const refreshGeneration = useRef(0);

  const standaloneItems = useMemo(() => items.filter((item) => !item.comboId), [items]);
  const currentRepositoryKey = useMemo(() => normalizeRepositoryScope(repository), [repository]);
  const otherScopes = useMemo(
    () => scopes.filter((scope) => normalizeRepositoryScope(scope.repository) !== currentRepositoryKey),
    [currentRepositoryKey, scopes]
  );
  const otherSecretCount = useMemo(
    () => otherScopes.reduce((total, scope) => total + scope.secretCount, 0),
    [otherScopes]
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!repository) return;
    const generation = ++refreshGeneration.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setCombos([]);
    setScopes([]);
    setRevealedValues({});
    const [itemsResponse, combosResponse, scopesResponse] = await Promise.all([
      sessionMemoryClient.repoSecretList(repository).catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })),
      sessionMemoryClient.repoSecretComboList(repository).catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })),
      sessionMemoryClient.repoSecretScopes().catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })),
    ]);
    if (generation !== refreshGeneration.current) return;
    setLoading(false);
    if ('error' in itemsResponse) {
      setError(itemsResponse.error);
      return;
    }
    if ('error' in combosResponse) {
      setError(combosResponse.error);
      return;
    }
    if ('error' in scopesResponse) {
      setError(scopesResponse.error);
      return;
    }
    setError(null);
    setItems(itemsResponse.data);
    setCombos(combosResponse.data);
    setScopes(scopesResponse.data);
    setRevealedValues({});
  }, [repository]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const resetComboForm = (): void => {
    setEditingComboId(null);
    setComboName('');
    setComboDescription('');
    setComboVariables(defaultComboVariables());
  };

  const openCreateCombo = (): void => {
    resetComboForm();
    setComboVisible(true);
  };

  const openEditCombo = (combo: RepoSecretCombo): void => {
    setEditingComboId(combo.comboId);
    setComboName(combo.comboLabel);
    setComboDescription(combo.description);
    setComboVariables(combo.keys.map(({ key, status }) => createComboVariable(key, { key, status })));
    setComboVisible(true);
  };

  const save = async (): Promise<void> => {
    if (!alias.trim() || !description.trim() || !value.trim() || saving) return;
    setSaving(true);
    const response = await sessionMemoryClient
      .repoSecretSave(repository, alias, description, value)
      .catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    setSaving(false);
    if ('error' in response) {
      Message.error(response.error);
      return;
    }
    setAlias('');
    setDescription('');
    setValue('');
    Message.success(t('ide.memory.secret.saved'));
    await refresh();
  };

  const saveCombo = async (): Promise<void> => {
    const keys = comboVariables.map((variable) => ({
      key: variable.key.trim(),
      ...(variable.value.trim() ? { value: variable.value } : {}),
    }));
    const incomplete =
      !comboName.trim() ||
      !comboDescription.trim() ||
      comboVariables.some(
        (variable) => !variable.key.trim() || (!keepsStoredValue(variable) && !variable.value.trim())
      );
    if (incomplete) {
      Message.warning(t('ide.memory.secret.comboIncomplete'));
      return;
    }
    if (saving) return;
    setSaving(true);
    const wasEditing = editingComboId !== null;
    const response = await sessionMemoryClient
      .repoSecretComboSave(repository, {
        comboId: editingComboId ?? crypto.randomUUID(),
        comboLabel: comboName,
        description: comboDescription,
        keys,
      })
      .catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    setSaving(false);
    if ('error' in response) {
      Message.error(response.error);
      return;
    }
    setComboVisible(false);
    resetComboForm();
    Message.success(t(wasEditing ? 'ide.memory.secret.comboUpdated' : 'ide.memory.secret.comboSaved'));
    await refresh();
  };

  const remove = async (item: RepoSecretContext): Promise<void> => {
    const response = await sessionMemoryClient
      .repoSecretRemove(repository, item.alias)
      .catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    if ('error' in response) {
      Message.error(response.error);
      return;
    }
    Message.success(t('ide.memory.secret.removed'));
    await refresh();
  };

  const removeCombo = async (combo: RepoSecretCombo): Promise<void> => {
    const response = await sessionMemoryClient
      .repoSecretComboRemove(repository, combo.comboId)
      .catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    if ('error' in response) {
      Message.error(response.error);
      return;
    }
    Message.success(t('ide.memory.secret.comboRemoved'));
    await refresh();
  };

  const reveal = async (aliasToReveal: string): Promise<void> => {
    if (revealedValues[aliasToReveal] !== undefined) {
      setRevealedValues((current) => {
        const next = { ...current };
        delete next[aliasToReveal];
        return next;
      });
      return;
    }
    setRevealingAlias(aliasToReveal);
    const response = await sessionMemoryClient
      .repoSecretReveal(repository, aliasToReveal)
      .catch((cause): { ok: false; error: string } => ({
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    setRevealingAlias(null);
    if ('error' in response) {
      Message.error(response.error);
      return;
    }
    setRevealedValues((current) => ({ ...current, [aliasToReveal]: response.data }));
  };

  const statusTag = (status: 'set' | 'needs_value'): React.ReactNode => (
    <Tag size='small' color={status === 'set' ? 'green' : 'orange'}>
      {status === 'set' ? t('ide.memory.secret.set') : t('ide.memory.secret.needsValue')}
    </Tag>
  );

  if (!repository) {
    return (
      <div className='size-full flex flex-col items-center justify-center p-24px text-center gap-12px'>
        <div className='flex-center size-48px rd-full bg-fill-2 text-t-tertiary'>
          <FolderOpen theme='outline' size={24} />
        </div>
        <div className='flex flex-col gap-4px'>
          <span className='text-14px font-600 text-t-primary'>
            {t('ide.secret.noWorkspaceTitle', { defaultValue: 'No Workspace Bound' })}
          </span>
          <span className='text-12px text-t-secondary max-w-28px'>
            {t('ide.secret.noWorkspaceDesc', {
              defaultValue:
                'Secrets are scoped to a workspace folder. Open a workspace or choose a repository to configure credentials, accounts, and API keys.',
            })}
          </span>
        </div>
      </div>
    );
  }

  const revealButton = (secretAlias: string, status: 'set' | 'needs_value'): React.ReactNode =>
    status === 'set' ? (
      <Button
        size='mini'
        icon={<PreviewOpen theme='outline' size={13} />}
        loading={revealingAlias === secretAlias}
        onClick={() => void reveal(secretAlias)}
      >
        {revealedValues[secretAlias] !== undefined ? t('ide.memory.secret.hide') : t('ide.memory.secret.reveal')}
      </Button>
    ) : null;

  return (
    <div className='h-full min-h-0 flex flex-col gap-14px'>
      <div className='shrink-0 p-12px rd-12px bg-primary-light-1 border border-primary-light-3'>
        <div className='flex items-start gap-10px'>
          <span className='size-30px rd-9px flex-center bg-primary text-white shrink-0'>
            <Lock theme='outline' size={16} />
          </span>
          <div className='min-w-0 flex-1'>
            <div className='text-13px font-600 text-t-primary'>{t('ide.memory.secret.title')}</div>
            <div className='mt-2px text-11px leading-relaxed text-t-secondary'>{t('ide.memory.secret.hint')}</div>
            <div
              className='mt-6px flex min-w-0 items-center gap-6px text-10px text-t-tertiary'
              data-testid='repo-secret-current-scope'
              title={repository}
            >
              <span>{t('ide.memory.secret.currentWorkspace')}</span>
              <span className='min-w-0 truncate font-mono font-600 text-t-secondary'>
                {repositoryLabel(repository)}
              </span>
            </div>
          </div>
        </div>
      </div>
      {error ? <Alert type='error' content={error} /> : null}
      {!loading && items.length === 0 && combos.length === 0 && otherSecretCount > 0 ? (
        <Alert
          type='info'
          content={
            <div className='flex flex-col gap-5px' data-testid='repo-secret-other-scopes'>
              <span>
                {t('ide.memory.secret.otherWorkspaceNotice', {
                  count: otherSecretCount,
                  workspaces: otherScopes.length,
                })}
              </span>
              <div className='flex flex-wrap gap-5px'>
                {otherScopes.slice(0, 4).map((scope) => (
                  <Tag key={scope.repository} size='small' title={scope.repository}>
                    {t('ide.memory.secret.scopeSummary', {
                      workspace: repositoryLabel(scope.repository),
                      count: scope.secretCount,
                    })}
                  </Tag>
                ))}
              </div>
            </div>
          }
        />
      ) : null}
      <div className='shrink-0 grid grid-cols-2 gap-8px'>
        <Button type='outline' size='small' icon={<Plus size={14} />} onClick={openCreateCombo}>
          {t('ide.memory.secret.createCombo')}
        </Button>
        <Button
          type='primary'
          size='small'
          icon={<Save size={14} />}
          loading={saving}
          disabled={!alias.trim() || !description.trim() || !value.trim()}
          onClick={() => void save()}
        >
          {t('ide.memory.secret.add')}
        </Button>
        <Input value={alias} onChange={setAlias} placeholder={t('ide.memory.secret.aliasPlaceholder')} />
        <Input
          value={description}
          onChange={setDescription}
          placeholder={t('ide.memory.secret.descriptionPlaceholder')}
        />
        <Input.Password
          className='col-span-2'
          value={value}
          onChange={setValue}
          placeholder={t('ide.memory.secret.valuePlaceholder')}
        />
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto flex flex-col gap-10px pr-2px'>
        {loading ? <Spin /> : null}
        {!loading && combos.length === 0 && standaloneItems.length === 0 ? (
          <Empty description={t('ide.memory.secret.empty')} />
        ) : null}
        {combos.length > 0 ? (
          <div className='flex flex-col gap-7px'>
            <div className='text-11px font-600 uppercase tracking-wide text-t-tertiary'>
              {t('ide.memory.secret.comboSectionTitle')}
            </div>
            {combos.map((combo) => (
              <div key={combo.comboId} className='p-10px rd-10px bg-2 border border-primary-light-3'>
                <div className='flex items-start gap-8px'>
                  <Lock theme='outline' size={15} className='shrink-0 mt-2px text-primary' />
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-6px'>
                      <span className='text-12px font-600 text-t-primary'>{combo.comboLabel}</span>
                      <Tag size='small'>{t('ide.memory.secret.comboKeys', { count: combo.keys.length })}</Tag>
                    </div>
                    <div className='mt-3px text-11px leading-relaxed text-t-secondary'>{combo.description}</div>
                    <div className='mt-3px font-mono text-10px text-t-tertiary'>
                      {t('ide.memory.secret.comboId')}: {combo.comboId}
                    </div>
                    <div className='mt-8px flex flex-col gap-6px'>
                      {combo.keys.map((key) => (
                        <div key={key.key} className='flex items-center gap-6px p-7px rd-7px bg-1'>
                          <span className='font-mono text-11px font-600 text-t-primary'>{key.key}</span>
                          <span className='min-w-0 flex-1 truncate font-mono text-10px text-t-tertiary'>
                            {key.alias}
                          </span>
                          {statusTag(key.status)}
                          {revealButton(key.alias, key.status)}
                          {revealedValues[key.alias] !== undefined ? (
                            <Input
                              className='max-w-180px'
                              value={revealedValues[key.alias]}
                              readOnly
                              aria-label={key.alias}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button
                    size='mini'
                    type='text'
                    icon={<EditTwo size={13} />}
                    aria-label={t('ide.memory.secret.editCombo')}
                    onClick={() => openEditCombo(combo)}
                  />
                  <Popconfirm
                    focusLock
                    title={t('ide.memory.secret.comboDeleteConfirm')}
                    onOk={() => void removeCombo(combo)}
                  >
                    <Button
                      size='mini'
                      type='text'
                      status='danger'
                      icon={<Delete size={13} />}
                      aria-label={t('ide.memory.secret.deleteCombo')}
                    />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {standaloneItems.length > 0 ? (
          <div className='flex flex-col gap-7px'>
            <div className='text-11px font-600 uppercase tracking-wide text-t-tertiary'>
              {t('ide.memory.secret.singleSectionTitle')}
            </div>
            {standaloneItems.map((item) => (
              <div key={item.alias} className='flex items-start gap-8px p-10px rd-8px bg-2 border border-arco-2'>
                <Lock theme='outline' size={15} className='shrink-0 mt-2px text-t-tertiary' />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-6px'>
                    <span className='font-mono text-12px font-600 text-t-primary'>{item.alias}</span>
                    {statusTag(item.status)}
                  </div>
                  <div className='mt-3px text-11px leading-relaxed text-t-secondary'>{item.description}</div>
                  {revealedValues[item.alias] !== undefined ? (
                    <Input className='mt-7px' value={revealedValues[item.alias]} readOnly aria-label={item.alias} />
                  ) : null}
                </div>
                {revealButton(item.alias, item.status)}
                <Popconfirm focusLock title={t('ide.memory.secret.deleteConfirm')} onOk={() => void remove(item)}>
                  <Button
                    size='mini'
                    status='danger'
                    icon={<Delete size={13} />}
                    aria-label={t('ide.memory.secret.delete')}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className='shrink-0 flex items-center justify-between gap-8px border-t border-t-1 pt-8px'>
        <span className='text-11px text-t-tertiary leading-relaxed'>{t('ide.memory.secret.usage')}</span>
        <Button size='small' icon={<Refresh size={14} />} onClick={() => void refresh()}>
          {t('ide.memory.refresh')}
        </Button>
      </div>
      <Modal
        visible={comboVisible}
        title={t(editingComboId ? 'ide.memory.secret.editCombo' : 'ide.memory.secret.createCombo')}
        okText={t(editingComboId ? 'ide.memory.secret.updateCombo' : 'ide.memory.secret.saveCombo')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        onCancel={() => {
          if (!saving) {
            setComboVisible(false);
            resetComboForm();
          }
        }}
        onOk={() => void saveCombo()}
      >
        <div className='flex flex-col gap-10px'>
          <Input
            value={comboName}
            onChange={setComboName}
            aria-label={t('ide.memory.secret.comboNamePlaceholder')}
            placeholder={t('ide.memory.secret.comboNamePlaceholder')}
          />
          <Input
            value={comboDescription}
            onChange={setComboDescription}
            aria-label={t('ide.memory.secret.description')}
            placeholder={t('ide.memory.secret.descriptionPlaceholder')}
          />
          {editingComboId ? <Alert type='info' content={t('ide.memory.secret.comboSectionHint')} /> : null}
          {comboVariables.map((variable) => (
            <div key={variable.id} className='grid grid-cols-[1fr_1fr_auto] gap-6px'>
              <Input
                value={variable.key}
                aria-label={t('ide.memory.secret.comboKeyPlaceholder')}
                onChange={(key) =>
                  setComboVariables((current) =>
                    current.map((item) => (item.id === variable.id ? { ...item, key } : item))
                  )
                }
                placeholder={t('ide.memory.secret.comboKeyPlaceholder')}
              />
              <Input.Password
                value={variable.value}
                aria-label={t('ide.memory.secret.value')}
                onChange={(nextValue) =>
                  setComboVariables((current) =>
                    current.map((item) => (item.id === variable.id ? { ...item, value: nextValue } : item))
                  )
                }
                placeholder={t(
                  keepsStoredValue(variable)
                    ? 'ide.memory.secret.comboValueKeepPlaceholder'
                    : 'ide.memory.secret.valuePlaceholder'
                )}
              />
              <Button
                type='text'
                status='danger'
                icon={<Delete />}
                disabled={comboVariables.length === 1}
                aria-label={t('ide.memory.secret.deleteComboKey')}
                onClick={() => setComboVariables((current) => current.filter((item) => item.id !== variable.id))}
              />
            </div>
          ))}
          <Button
            size='small'
            type='outline'
            icon={<Plus />}
            onClick={() => setComboVariables((current) => [...current, createComboVariable()])}
          >
            {t('ide.memory.secret.addComboKey')}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default AgentSecretPanel;
