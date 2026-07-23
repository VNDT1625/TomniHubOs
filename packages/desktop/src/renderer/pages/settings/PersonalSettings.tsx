import { ipcBridge } from '@/common';
import type { PersonalSecretSetSaveRequest } from '@/common/adapter/ipcBridge';
import type { ContextFact, PersonalContext, SecretDescriptor } from '@process/agentRuntime/contextTypes';
import {
  Button,
  Empty,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Tabs,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import {
  Brain,
  Briefcase,
  Delete,
  Edit,
  GraphicDesign,
  History,
  Key,
  Like,
  Lock,
  People,
  PersonalPrivacy,
  Plus,
  Save,
  User,
} from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

type PersonalTab = 'profile' | 'secrets';
type StructuredProfile = PersonalContext['structuredProfile'];
type ProfileCategoryKey = keyof StructuredProfile;
type SecretVariableDraft = { id: string; name: string; value: string };
type SecretEditorState = {
  visible: boolean;
  saving: boolean;
  handle?: string;
  name: string;
  note: string;
  targets: string[];
  variables: SecretVariableDraft[];
};

const PROFILE_CATEGORY_KEYS = [
  'personalInformation',
  'psychology',
  'personality',
  'interests',
  'profession',
  'aestheticTaste',
  'pastContext',
] as const satisfies readonly ProfileCategoryKey[];

const PROFILE_CATEGORY_DEFINITIONS = {
  personalInformation: {
    icon: <User size={18} />,
    titleKey: 'settings.personalProfile.categories.personalInformation.title',
    descriptionKey: 'settings.personalProfile.categories.personalInformation.description',
    suggestions: [
      { key: 'displayName', labelKey: 'settings.personalProfile.suggestions.displayName' },
      { key: 'location', labelKey: 'settings.personalProfile.suggestions.location' },
      { key: 'languages', labelKey: 'settings.personalProfile.suggestions.languages' },
    ],
  },
  psychology: {
    icon: <Brain size={18} />,
    titleKey: 'settings.personalProfile.categories.psychology.title',
    descriptionKey: 'settings.personalProfile.categories.psychology.description',
    suggestions: [
      { key: 'motivation', labelKey: 'settings.personalProfile.suggestions.motivation' },
      { key: 'learningStyle', labelKey: 'settings.personalProfile.suggestions.learningStyle' },
      { key: 'stressTriggers', labelKey: 'settings.personalProfile.suggestions.stressTriggers' },
    ],
  },
  personality: {
    icon: <People size={18} />,
    titleKey: 'settings.personalProfile.categories.personality.title',
    descriptionKey: 'settings.personalProfile.categories.personality.description',
    suggestions: [
      { key: 'coreTraits', labelKey: 'settings.personalProfile.suggestions.coreTraits' },
      { key: 'collaborationStyle', labelKey: 'settings.personalProfile.suggestions.collaborationStyle' },
      { key: 'feedbackPreference', labelKey: 'settings.personalProfile.suggestions.feedbackPreference' },
    ],
  },
  interests: {
    icon: <Like size={18} />,
    titleKey: 'settings.personalProfile.categories.interests.title',
    descriptionKey: 'settings.personalProfile.categories.interests.description',
    suggestions: [
      { key: 'favoriteTopics', labelKey: 'settings.personalProfile.suggestions.favoriteTopics' },
      { key: 'hobbies', labelKey: 'settings.personalProfile.suggestions.hobbies' },
      { key: 'causes', labelKey: 'settings.personalProfile.suggestions.causes' },
    ],
  },
  profession: {
    icon: <Briefcase size={18} />,
    titleKey: 'settings.personalProfile.categories.profession.title',
    descriptionKey: 'settings.personalProfile.categories.profession.description',
    suggestions: [
      { key: 'role', labelKey: 'settings.personalProfile.suggestions.role' },
      { key: 'industry', labelKey: 'settings.personalProfile.suggestions.industry' },
      { key: 'experienceLevel', labelKey: 'settings.personalProfile.suggestions.experienceLevel' },
    ],
  },
  aestheticTaste: {
    icon: <GraphicDesign size={18} />,
    titleKey: 'settings.personalProfile.categories.aestheticTaste.title',
    descriptionKey: 'settings.personalProfile.categories.aestheticTaste.description',
    suggestions: [
      { key: 'visualStyle', labelKey: 'settings.personalProfile.suggestions.visualStyle' },
      { key: 'colorPreference', labelKey: 'settings.personalProfile.suggestions.colorPreference' },
      { key: 'densityPreference', labelKey: 'settings.personalProfile.suggestions.densityPreference' },
    ],
  },
  pastContext: {
    icon: <History size={18} />,
    titleKey: 'settings.personalProfile.categories.pastContext.title',
    descriptionKey: 'settings.personalProfile.categories.pastContext.description',
    suggestions: [
      { key: 'pastProjects', labelKey: 'settings.personalProfile.suggestions.pastProjects' },
      { key: 'lessonsLearned', labelKey: 'settings.personalProfile.suggestions.lessonsLearned' },
      { key: 'recurringConstraints', labelKey: 'settings.personalProfile.suggestions.recurringConstraints' },
    ],
  },
} as const satisfies Record<
  ProfileCategoryKey,
  {
    icon: React.ReactNode;
    titleKey: string;
    descriptionKey: string;
    suggestions: readonly { key: string; labelKey: string }[];
  }
>;

type FactSuggestion = (typeof PROFILE_CATEGORY_DEFINITIONS)[ProfileCategoryKey]['suggestions'][number];

const FACT_SOURCE_KEYS = {
  user: 'settings.personalProfile.facts.source.user',
  observed: 'settings.personalProfile.facts.source.observed',
  imported: 'settings.personalProfile.facts.source.imported',
  inferred: 'settings.personalProfile.facts.source.inferred',
} as const satisfies Record<ContextFact['source'], string>;

let variableSequence = 0;
const EXACT_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_SECRET_TARGETS = 20;
const createVariable = (name = '', value = ''): SecretVariableDraft => ({
  id: `secret-variable-${Date.now()}-${++variableSequence}`,
  name,
  value,
});

const createFact = (key = ''): ContextFact => ({
  key,
  value: '',
  confidence: 1,
  source: 'user',
  learnedAt: Date.now(),
  lastConfirmedAt: Date.now(),
  scope: { kind: 'global' },
  sensitivity: 'normal',
  userLocked: true,
});

const createStructuredProfile = (): StructuredProfile => ({
  personalInformation: [],
  psychology: [],
  personality: [],
  interests: [],
  profession: [],
  aestheticTaste: [],
  pastContext: [],
});

const resolveStructuredProfile = (profile: PersonalContext): StructuredProfile =>
  profile.structuredProfile ?? createStructuredProfile();

const normalizeFacts = (facts: ContextFact[]): ContextFact[] =>
  facts
    .map((fact) => ({
      ...fact,
      key: fact.key.trim(),
      value: fact.value.trim(),
    }))
    .filter((fact) => fact.key && fact.value);

const normalizeStructuredProfile = (profile: StructuredProfile): StructuredProfile => ({
  personalInformation: normalizeFacts(profile.personalInformation),
  psychology: normalizeFacts(profile.psychology),
  personality: normalizeFacts(profile.personality),
  interests: normalizeFacts(profile.interests),
  profession: normalizeFacts(profile.profession),
  aestheticTaste: normalizeFacts(profile.aestheticTaste),
  pastContext: normalizeFacts(profile.pastContext),
});

const formatUpdatedAt = (value: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
};

const formatConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
};

const SectionCard: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, description, action, children }) => (
  <section className='rd-14px border border-solid border-border-2 bg-bg-2 p-18px md:p-22px'>
    <div className='mb-16px flex items-start justify-between gap-16px'>
      <div className='min-w-0'>
        <h2 className='m-0 text-16px font-600 text-t-primary'>{title}</h2>
        {description ? <p className='m-0 mt-5px text-13px leading-20px text-t-secondary'>{description}</p> : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const FactListEditor: React.FC<{
  title: string;
  description: string;
  values: ContextFact[];
  suggestions?: readonly FactSuggestion[];
  onChange: (next: ContextFact[]) => void;
}> = ({ title, description, values, suggestions = [], onChange }) => {
  const { t } = useTranslation();
  const availableSuggestions = suggestions.filter(
    (suggestion) => !values.some((value) => value.key === suggestion.key)
  );

  const update = (index: number, patch: Partial<ContextFact>) => {
    onChange(values.map((value, itemIndex) => (itemIndex === index ? { ...value, ...patch } : value)));
  };

  const updateContent = (index: number, patch: Pick<ContextFact, 'key'> | Pick<ContextFact, 'value'>) => {
    update(index, {
      ...patch,
      source: 'user',
      confidence: 1,
      userLocked: true,
      lastConfirmedAt: Date.now(),
    });
  };

  return (
    <SectionCard
      title={title}
      description={description}
      action={
        <Button size='small' icon={<Plus />} onClick={() => onChange([...values, createFact()])}>
          {t('settings.personalProfile.actions.add')}
        </Button>
      }
    >
      {availableSuggestions.length > 0 ? (
        <div className='mb-12px flex flex-wrap items-center gap-6px'>
          <span className='mr-2px text-12px text-t-tertiary'>{t('settings.personalProfile.facts.quickAdd')}</span>
          {availableSuggestions.map((suggestion) => (
            <Button
              key={suggestion.key}
              type='outline'
              size='mini'
              icon={<Plus size={12} />}
              onClick={() => onChange([...values, createFact(suggestion.key)])}
            >
              {t(suggestion.labelKey)}
            </Button>
          ))}
        </div>
      ) : null}

      <div className='flex flex-col gap-10px'>
        {values.length === 0 ? (
          <Button
            type='dashed'
            long
            className='!h-auto min-h-72px rd-10px text-13px text-t-tertiary'
            onClick={() => onChange([createFact()])}
          >
            <span className='flex items-center justify-center gap-7px'>
              <Plus />
              {t('settings.personalProfile.actions.addFirst')}
            </span>
          </Button>
        ) : (
          values.map((value, index) => {
            const agentVisible = value.sensitivity === 'normal';
            return (
              <div
                key={`${value.learnedAt}-${index}`}
                className='rd-12px border border-solid border-border-1 bg-fill-1 p-12px'
              >
                <div className='grid grid-cols-[1fr_auto] gap-8px md:grid-cols-[minmax(160px,0.55fr)_minmax(260px,1fr)_auto]'>
                  <Input
                    value={value.key}
                    aria-label={t('settings.personalProfile.facts.keyPlaceholder')}
                    placeholder={t('settings.personalProfile.facts.keyPlaceholder')}
                    maxLength={200}
                    onChange={(key) => updateContent(index, { key })}
                  />
                  <Input.TextArea
                    className='col-span-1'
                    value={value.value}
                    aria-label={t('settings.personalProfile.facts.valuePlaceholder')}
                    placeholder={t('settings.personalProfile.facts.valuePlaceholder')}
                    maxLength={2_000}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    onChange={(factValue) => updateContent(index, { value: factValue })}
                  />
                  <Button
                    type='text'
                    status='danger'
                    icon={<Delete />}
                    aria-label={t('settings.personalProfile.facts.removeAria')}
                    onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
                  />
                </div>

                <div className='mt-9px flex flex-wrap items-center justify-between gap-8px'>
                  <Tooltip
                    content={t(
                      agentVisible
                        ? 'settings.personalProfile.facts.agentVisibleDescription'
                        : 'settings.personalProfile.facts.localOnlyDescription'
                    )}
                  >
                    <span className='flex items-center gap-7px text-12px text-t-secondary'>
                      <Switch
                        size='small'
                        checked={agentVisible}
                        aria-label={t(
                          agentVisible
                            ? 'settings.personalProfile.facts.agentVisible'
                            : 'settings.personalProfile.facts.localOnly'
                        )}
                        onChange={(checked) => update(index, { sensitivity: checked ? 'normal' : 'private' })}
                      />
                      {t(
                        agentVisible
                          ? 'settings.personalProfile.facts.agentVisible'
                          : 'settings.personalProfile.facts.localOnly'
                      )}
                    </span>
                  </Tooltip>

                  <div className='flex flex-wrap items-center justify-end gap-6px text-11px text-t-tertiary'>
                    <Tag bordered>{t(FACT_SOURCE_KEYS[value.source])}</Tag>
                    <span>
                      {t('settings.personalProfile.facts.confidence', {
                        value: formatConfidence(value.confidence),
                      })}
                    </span>
                    {value.userLocked ? <Tag bordered>{t('settings.personalProfile.facts.confirmed')}</Tag> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </SectionCard>
  );
};

const PersonalSettings: React.FC = () => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage();
  const [activeTab, setActiveTab] = useState<PersonalTab>('profile');
  const [activeCategory, setActiveCategory] = useState<ProfileCategoryKey>('personalInformation');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profile, setProfile] = useState<PersonalContext | null>(null);
  const [secrets, setSecrets] = useState<SecretDescriptor[]>([]);
  const [secretEditor, setSecretEditor] = useState<SecretEditorState>({
    visible: false,
    saving: false,
    name: '',
    note: '',
    targets: [],
    variables: [createVariable('USERNAME'), createVariable('PASSWORD')],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProfile, nextSecrets] = await Promise.all([
        ipcBridge.personal.get.invoke(),
        ipcBridge.personal.listSecrets.invoke(),
      ]);
      setProfile({
        ...nextProfile,
        structuredProfile: resolveStructuredProfile(nextProfile),
      });
      setSecrets(nextSecrets.toSorted((left, right) => right.updatedAt - left.updatedAt));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('settings.personalProfile.messages.loadError'));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateProfile = (patch: Partial<PersonalContext>) => {
    setProfile((current) => (current ? { ...current, ...patch } : current));
  };

  const updateStructuredCategory = (category: ProfileCategoryKey, values: ContextFact[]) => {
    setProfile((current) => {
      if (!current) return current;
      return {
        ...current,
        structuredProfile: {
          ...resolveStructuredProfile(current),
          [category]: values,
        },
      };
    });
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      const nextProfile: PersonalContext = {
        ...profile,
        facts: normalizeFacts(profile.facts),
        preferences: normalizeFacts(profile.preferences),
        habits: normalizeFacts(profile.habits),
        structuredProfile: normalizeStructuredProfile(resolveStructuredProfile(profile)),
        communication: {
          ...profile.communication,
          language: profile.communication.language?.trim() || undefined,
          tone: profile.communication.tone?.trim() || undefined,
          vocabulary: profile.communication.vocabulary.map((item) => item.trim()).filter(Boolean),
          writingGuidance: profile.communication.writingGuidance.map((item) => item.trim()).filter(Boolean),
        },
        updatedAt: Date.now(),
      };
      const saved = await ipcBridge.personal.save.invoke({ profile: nextProfile });
      setProfile({
        ...saved,
        structuredProfile: resolveStructuredProfile(saved),
      });
      message.success(t('settings.personalProfile.messages.saveSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('settings.personalProfile.messages.saveError'));
    } finally {
      setSavingProfile(false);
    }
  };

  const openCreateSecret = () => {
    setSecretEditor({
      visible: true,
      saving: false,
      name: '',
      note: '',
      targets: [],
      variables: [createVariable('USERNAME'), createVariable('PASSWORD')],
    });
  };

  const openEditSecret = (secret: SecretDescriptor) => {
    setSecretEditor({
      visible: true,
      saving: false,
      handle: secret.handle,
      name: secret.label,
      note: secret.note ?? '',
      targets: secret.binding.targets ?? [],
      // Values are intentionally never returned. Replacing a set requires re-entry.
      variables: secret.fields.map((field) => createVariable(field)),
    });
  };

  const closeSecretEditor = () => {
    if (secretEditor.saving) return;
    setSecretEditor((current) => ({ ...current, visible: false }));
  };

  const updateSecretVariable = (id: string, patch: Partial<SecretVariableDraft>) => {
    setSecretEditor((current) => ({
      ...current,
      variables: current.variables.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
    }));
  };

  const saveSecretSet = async () => {
    const name = secretEditor.name.trim();
    const variables = secretEditor.variables.map((variable) => ({
      name: variable.name.trim(),
      value: variable.value,
    }));
    const targets = secretEditor.targets.map((target) => target.trim().toLowerCase()).filter(Boolean);
    const invalidName = variables.some((variable) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(variable.name));
    const duplicateNames = new Set(variables.map((variable) => variable.name)).size !== variables.length;
    const invalidTargets =
      targets.length === 0 ||
      targets.length > MAX_SECRET_TARGETS ||
      new Set(targets).size !== targets.length ||
      targets.some((target) => !EXACT_HOSTNAME.test(target));
    if (!name) {
      message.warning(t('settings.personalSecrets.nameRequired'));
      return;
    }
    if (variables.length === 0 || invalidName || duplicateNames || variables.some((variable) => !variable.value)) {
      message.warning(t('settings.personalSecrets.variablesInvalid'));
      return;
    }
    if (invalidTargets) {
      message.warning(t('settings.personalSecrets.allowedHostnamesInvalid'));
      return;
    }
    setSecretEditor((current) => ({ ...current, saving: true }));
    try {
      const input: PersonalSecretSetSaveRequest = {
        handle: secretEditor.handle,
        name,
        note: secretEditor.note.trim() || undefined,
        targets,
        variables,
      };
      await ipcBridge.personal.saveSecretSet.invoke(input);
      const nextSecrets = await ipcBridge.personal.listSecrets.invoke();
      setSecrets(nextSecrets.toSorted((left, right) => right.updatedAt - left.updatedAt));
      setSecretEditor((current) => ({ ...current, visible: false, saving: false }));
      message.success(
        t(secretEditor.handle ? 'settings.personalSecrets.replacedSuccess' : 'settings.personalSecrets.createdSuccess')
      );
    } catch (error) {
      setSecretEditor((current) => ({ ...current, saving: false }));
      message.error(error instanceof Error ? error.message : t('settings.personalSecrets.saveError'));
    }
  };

  const removeSecretSet = async (handle: string) => {
    try {
      await ipcBridge.personal.removeSecretSet.invoke({ handle });
      setSecrets((current) => current.filter((secret) => secret.handle !== handle));
      message.success(t('settings.personalSecrets.removedSuccess'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('settings.personalSecrets.removeError'));
    }
  };

  const secretCountLabel = useMemo(
    () =>
      t('settings.personalSecrets.countSummary', {
        setCount: secrets.length,
        variableCount: secrets.reduce((total, secret) => total + secret.fields.length, 0),
      }),
    [secrets, t]
  );
  const structuredProfile = profile ? resolveStructuredProfile(profile) : null;
  const structuredFactCount = structuredProfile
    ? PROFILE_CATEGORY_KEYS.reduce((total, category) => total + structuredProfile[category].length, 0)
    : 0;
  const activeCategoryDefinition = PROFILE_CATEGORY_DEFINITIONS[activeCategory];
  const activeCategoryFacts = structuredProfile?.[activeCategory] ?? [];

  return (
    <SettingsPageWrapper contentClassName='max-w-1100px'>
      {messageContext}
      <div className='mb-22px flex flex-wrap items-start justify-between gap-14px'>
        <div>
          <h1 className='m-0 text-24px font-650 text-t-primary'>{t('settings.personalProfile.title')}</h1>
          <p className='m-0 mt-6px max-w-720px text-14px leading-22px text-t-secondary'>
            {t('settings.personalProfile.description')}
          </p>
        </div>
        {activeTab === 'profile' ? (
          <Button type='primary' icon={<Save />} loading={savingProfile} disabled={!profile} onClick={saveProfile}>
            {t('settings.personalProfile.actions.save')}
          </Button>
        ) : (
          <Button type='primary' icon={<Plus />} onClick={openCreateSecret}>
            {t('settings.personalProfile.actions.addSecret')}
          </Button>
        )}
      </div>

      <Tabs
        activeTab={activeTab}
        type='line'
        className='[&>.arco-tabs-content]:pt-18px'
        onChange={(key) => setActiveTab(key as PersonalTab)}
      >
        <Tabs.TabPane key='profile' title={t('settings.personalProfile.tabs.profile')}>
          <Spin loading={loading} className='w-full'>
            {profile && structuredProfile ? (
              <div className='flex flex-col gap-14px'>
                <div className='grid grid-cols-1 gap-10px md:grid-cols-2'>
                  <div className='flex gap-10px rd-12px border border-solid border-border-2 bg-fill-1 px-14px py-12px'>
                    <span className='mt-1px flex size-30px shrink-0 items-center justify-center rd-9px bg-fill-2 text-t-primary'>
                      <PersonalPrivacy size={16} />
                    </span>
                    <p className='m-0 text-12px leading-19px text-t-secondary'>
                      {t('settings.personalProfile.safety.noSecrets')}
                    </p>
                  </div>
                  <div className='flex gap-10px rd-12px border border-solid border-border-2 bg-fill-1 px-14px py-12px'>
                    <span className='mt-1px flex size-30px shrink-0 items-center justify-center rd-9px bg-fill-2 text-t-primary'>
                      <Brain size={16} />
                    </span>
                    <p className='m-0 text-12px leading-19px text-t-secondary'>
                      {t('settings.personalProfile.safety.selfDescribed')}
                    </p>
                  </div>
                </div>

                <SectionCard
                  title={t('settings.personalProfile.structured.title')}
                  description={t('settings.personalProfile.structured.description')}
                  action={
                    <Tag bordered>
                      {t('settings.personalProfile.structured.summary', {
                        count: structuredFactCount,
                      })}
                    </Tag>
                  }
                >
                  <div className='grid grid-cols-1 gap-8px sm:grid-cols-2 lg:grid-cols-4'>
                    {PROFILE_CATEGORY_KEYS.map((category) => {
                      const definition = PROFILE_CATEGORY_DEFINITIONS[category];
                      const selected = category === activeCategory;
                      return (
                        <Button
                          key={category}
                          type={selected ? 'secondary' : 'outline'}
                          className={`!h-auto !justify-start rd-12px px-12px py-11px text-left ${
                            selected ? 'border-brand bg-fill-2' : 'border-border-1 bg-bg-1'
                          }`}
                          aria-pressed={selected}
                          onClick={() => setActiveCategory(category)}
                        >
                          <span className='flex w-full items-center gap-9px'>
                            <span className='flex size-32px shrink-0 items-center justify-center rd-9px bg-fill-2 text-t-primary'>
                              {definition.icon}
                            </span>
                            <span className='min-w-0 flex-1 truncate text-12px font-550 text-t-primary'>
                              {t(definition.titleKey)}
                            </span>
                            <span className='shrink-0 text-11px tabular-nums text-t-tertiary'>
                              {structuredProfile[category].length}
                            </span>
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                  <div className='mt-12px text-right text-11px text-t-tertiary'>
                    {t('settings.personalProfile.structured.updatedAt', {
                      date: formatUpdatedAt(profile.updatedAt),
                    })}
                  </div>
                </SectionCard>

                <FactListEditor
                  title={t(activeCategoryDefinition.titleKey)}
                  description={t(activeCategoryDefinition.descriptionKey)}
                  values={activeCategoryFacts}
                  suggestions={activeCategoryDefinition.suggestions}
                  onChange={(values) => updateStructuredCategory(activeCategory, values)}
                />

                <SectionCard
                  title={t('settings.personalProfile.communication.title')}
                  description={t('settings.personalProfile.communication.description')}
                >
                  <div className='grid grid-cols-1 gap-12px md:grid-cols-3'>
                    <label className='flex flex-col gap-6px text-13px text-t-secondary'>
                      {t('settings.personalProfile.communication.languageLabel')}
                      <Input
                        value={profile.communication.language ?? ''}
                        placeholder={t('settings.personalProfile.communication.languagePlaceholder')}
                        onChange={(language) =>
                          updateProfile({ communication: { ...profile.communication, language } })
                        }
                      />
                    </label>
                    <label className='flex flex-col gap-6px text-13px text-t-secondary'>
                      {t('settings.personalProfile.communication.toneLabel')}
                      <Input
                        value={profile.communication.tone ?? ''}
                        placeholder={t('settings.personalProfile.communication.tonePlaceholder')}
                        onChange={(tone) => updateProfile({ communication: { ...profile.communication, tone } })}
                      />
                    </label>
                    <label className='flex flex-col gap-6px text-13px text-t-secondary'>
                      {t('settings.personalProfile.communication.verbosityLabel')}
                      <Select
                        value={profile.communication.verbosity ?? 'balanced'}
                        options={[
                          {
                            label: t('settings.personalProfile.communication.verbosity.concise'),
                            value: 'concise',
                          },
                          {
                            label: t('settings.personalProfile.communication.verbosity.balanced'),
                            value: 'balanced',
                          },
                          {
                            label: t('settings.personalProfile.communication.verbosity.detailed'),
                            value: 'detailed',
                          },
                        ]}
                        onChange={(verbosity) =>
                          updateProfile({
                            communication: {
                              ...profile.communication,
                              verbosity: verbosity as PersonalContext['communication']['verbosity'],
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                </SectionCard>

                <section className='pt-4px'>
                  <h2 className='m-0 text-17px font-600 text-t-primary'>
                    {t('settings.personalProfile.additional.title')}
                  </h2>
                  <p className='m-0 mt-5px text-13px leading-20px text-t-secondary'>
                    {t('settings.personalProfile.additional.description')}
                  </p>
                  <div className='mt-12px flex flex-col gap-12px'>
                    <FactListEditor
                      title={t('settings.personalProfile.additional.facts.title')}
                      description={t('settings.personalProfile.additional.facts.description')}
                      values={profile.facts}
                      onChange={(facts) => updateProfile({ facts })}
                    />
                    <FactListEditor
                      title={t('settings.personalProfile.additional.preferences.title')}
                      description={t('settings.personalProfile.additional.preferences.description')}
                      values={profile.preferences}
                      onChange={(preferences) => updateProfile({ preferences })}
                    />
                    <FactListEditor
                      title={t('settings.personalProfile.additional.habits.title')}
                      description={t('settings.personalProfile.additional.habits.description')}
                      values={profile.habits}
                      onChange={(habits) => updateProfile({ habits })}
                    />
                  </div>
                </section>
              </div>
            ) : null}
          </Spin>
        </Tabs.TabPane>

        <Tabs.TabPane
          key='secrets'
          title={t('settings.personalProfile.tabs.secrets', {
            count: secrets.length,
          })}
        >
          <Spin loading={loading} className='w-full'>
            <div className='flex flex-col gap-14px'>
              <div className='flex gap-12px rd-12px border border-solid border-border-2 bg-fill-1 px-16px py-14px'>
                <span className='mt-1px flex size-32px shrink-0 items-center justify-center rd-9px bg-fill-3 text-t-primary'>
                  <Lock size={17} />
                </span>
                <div className='min-w-0'>
                  <div className='text-14px font-600 text-t-primary'>{t('settings.personalSecrets.securityTitle')}</div>
                  <div className='mt-3px text-13px leading-20px text-t-secondary'>
                    {t('settings.personalSecrets.securityDescription')}
                  </div>
                </div>
              </div>

              <div className='flex items-center justify-between text-13px text-t-secondary'>
                <span>{secretCountLabel}</span>
                <span>{t('settings.personalSecrets.keychainProtected')}</span>
              </div>

              {secrets.length === 0 ? (
                <div className='rd-14px border border-dashed border-border-3 bg-bg-2 py-50px'>
                  <Empty description={t('settings.personalSecrets.empty')} />
                  <div className='mt-14px flex justify-center'>
                    <Button type='primary' icon={<Plus />} onClick={openCreateSecret}>
                      {t('settings.personalSecrets.createFirst')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className='grid grid-cols-1 gap-12px lg:grid-cols-2'>
                  {secrets.map((secret) => (
                    <article key={secret.handle} className='rd-14px border border-solid border-border-2 bg-bg-2 p-18px'>
                      <div className='flex items-start justify-between gap-12px'>
                        <div className='flex min-w-0 gap-10px'>
                          <span className='flex size-34px shrink-0 items-center justify-center rd-10px bg-fill-2 text-t-primary'>
                            <Key size={17} />
                          </span>
                          <div className='min-w-0'>
                            <h3 className='m-0 truncate text-15px font-600 text-t-primary'>{secret.label}</h3>
                            <p className='m-0 mt-4px line-clamp-2 min-h-20px text-12px leading-18px text-t-secondary'>
                              {secret.note || t('settings.personalSecrets.noNote')}
                            </p>
                          </div>
                        </div>
                        <div className='flex shrink-0 gap-2px'>
                          <Button
                            type='text'
                            icon={<Edit />}
                            aria-label={t('settings.personalSecrets.editAria')}
                            onClick={() => openEditSecret(secret)}
                          />
                          <Popconfirm
                            title={t('settings.personalSecrets.deleteConfirmTitle')}
                            content={t('settings.personalSecrets.deleteConfirmContent')}
                            onOk={() => removeSecretSet(secret.handle)}
                          >
                            <Button
                              type='text'
                              status='danger'
                              icon={<Delete />}
                              aria-label={t('settings.personalSecrets.deleteAria')}
                            />
                          </Popconfirm>
                        </div>
                      </div>
                      <div className='mt-14px flex flex-wrap gap-6px'>
                        {secret.fields.map((field) => (
                          <Tag key={field} bordered>
                            {field}
                          </Tag>
                        ))}
                      </div>
                      <div className='mt-10px flex flex-wrap items-center gap-6px'>
                        <span className='mr-2px text-11px text-t-tertiary'>
                          {t('settings.personalSecrets.allowedHostnamesTagLabel')}
                        </span>
                        {secret.binding.targets?.length ? (
                          secret.binding.targets.map((target) => (
                            <Tag key={target} bordered>
                              {target}
                            </Tag>
                          ))
                        ) : (
                          <Tag bordered>{t('settings.personalSecrets.legacyTargetsMissing')}</Tag>
                        )}
                      </div>
                      <div className='mt-14px border-0 border-t border-solid border-border-1 pt-10px text-11px text-t-tertiary'>
                        {t('settings.personalSecrets.updatedAt', {
                          date: formatUpdatedAt(secret.updatedAt),
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </Spin>
        </Tabs.TabPane>
      </Tabs>

      <Modal
        visible={secretEditor.visible}
        title={t(
          secretEditor.handle ? 'settings.personalSecrets.replaceTitle' : 'settings.personalSecrets.createTitle'
        )}
        okText={t(
          secretEditor.handle ? 'settings.personalSecrets.replaceAction' : 'settings.personalSecrets.createAction'
        )}
        cancelText={t('settings.personalSecrets.cancel')}
        confirmLoading={secretEditor.saving}
        onCancel={closeSecretEditor}
        onOk={saveSecretSet}
        unmountOnExit
        style={{ width: 680 }}
      >
        <div className='flex flex-col gap-14px'>
          {secretEditor.handle ? (
            <div className='rd-10px bg-fill-1 px-13px py-10px text-12px leading-18px text-t-secondary'>
              {t('settings.personalSecrets.replaceWarning')}
            </div>
          ) : null}
          <label className='flex flex-col gap-6px text-13px text-t-secondary'>
            {t('settings.personalSecrets.setNameLabel')}
            <Input
              value={secretEditor.name}
              placeholder={t('settings.personalSecrets.setNamePlaceholder')}
              maxLength={120}
              onChange={(name) => setSecretEditor((current) => ({ ...current, name }))}
            />
          </label>
          <label className='flex flex-col gap-6px text-13px text-t-secondary'>
            {t('settings.personalSecrets.noteLabel')}
            <Input.TextArea
              value={secretEditor.note}
              placeholder={t('settings.personalSecrets.notePlaceholder')}
              maxLength={1_000}
              autoSize={{ minRows: 2, maxRows: 4 }}
              onChange={(note) => setSecretEditor((current) => ({ ...current, note }))}
            />
          </label>
          <label className='flex flex-col gap-6px text-13px text-t-secondary'>
            {t('settings.personalSecrets.allowedHostnamesLabel')}
            <Select
              mode='multiple'
              allowCreate
              showSearch
              value={secretEditor.targets}
              options={secretEditor.targets.map((target) => ({ label: target, value: target }))}
              placeholder={t('settings.personalSecrets.allowedHostnamesPlaceholder')}
              onChange={(targets) =>
                setSecretEditor((current) => ({
                  ...current,
                  targets: (Array.isArray(targets) ? targets : [targets]).map(String).slice(0, MAX_SECRET_TARGETS),
                }))
              }
            />
            <span className='text-12px leading-18px text-t-tertiary'>
              {t('settings.personalSecrets.allowedHostnamesDescription')}
            </span>
          </label>

          <div>
            <div className='mb-8px flex items-center justify-between'>
              <div>
                <div className='text-13px font-600 text-t-primary'>{t('settings.personalSecrets.variablesTitle')}</div>
                <div className='mt-2px text-12px text-t-tertiary'>
                  {t('settings.personalSecrets.variablesDescription')}
                </div>
              </div>
              <Button
                size='small'
                icon={<Plus />}
                onClick={() =>
                  setSecretEditor((current) => ({ ...current, variables: [...current.variables, createVariable()] }))
                }
              >
                {t('settings.personalSecrets.addVariable')}
              </Button>
            </div>
            <div className='flex max-h-330px flex-col gap-9px overflow-y-auto pr-2px'>
              {secretEditor.variables.map((variable) => (
                <div key={variable.id} className='grid grid-cols-[1fr_auto] gap-8px md:grid-cols-[210px_1fr_auto]'>
                  <Input
                    value={variable.name}
                    placeholder={t('settings.personalSecrets.variableNamePlaceholder')}
                    onChange={(name) => updateSecretVariable(variable.id, { name })}
                  />
                  <Input.Password
                    value={variable.value}
                    placeholder={t('settings.personalSecrets.variableValuePlaceholder')}
                    onChange={(value) => updateSecretVariable(variable.id, { value })}
                  />
                  <Button
                    type='text'
                    status='danger'
                    icon={<Delete />}
                    aria-label={t('settings.personalSecrets.removeVariableAria')}
                    disabled={secretEditor.variables.length === 1}
                    onClick={() =>
                      setSecretEditor((current) => ({
                        ...current,
                        variables: current.variables.filter((item) => item.id !== variable.id),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </SettingsPageWrapper>
  );
};

export default PersonalSettings;
