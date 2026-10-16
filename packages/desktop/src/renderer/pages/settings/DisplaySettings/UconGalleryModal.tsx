import React, { useMemo, useState } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { UconBot, type UconBotState } from '@/renderer/components/agents/UconBot';
import {
  UCON_ARCHETYPES,
  UCON_SLOT_OPTIONS,
  encodeUconAvatar,
  resolveUconAppearance,
  type UconAppearance,
  type UconAppearanceOverride,
  type UconArchetype,
  type UconEyes,
} from '@/renderer/components/agents/uconBotConfig';
import { UCON_CLI_SKINS, encodeUconCliAvatar } from '@/renderer/components/agents/uconCliSkins';
import {
  encodePackageAvatar,
  useUconPackageSkins,
  type AvailableAvatarSkin,
} from '@/renderer/components/agents/uconPackageSkins';

type Category = 'all' | 'core' | 'cli' | 'package';
type Entry = {
  id: string;
  name: string;
  category: Exclude<Category, 'all'>;
  avatar: string;
  cliAgentId?: string;
  archetype?: UconArchetype;
  pkg?: AvailableAvatarSkin;
};
type Props = { visible: boolean; mode: 'gallery' | 'studio'; onClose: () => void };
const CORE_ENTRIES: readonly Entry[] = [
  { id: 'tomny', name: 'Tomny · Core', category: 'core', avatar: 'ucon:core', archetype: 'core' },
  ...UCON_ARCHETYPES.filter((id) => id !== 'core').map(
    (id): Entry => ({
      id: 'core:' + id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      category: 'core',
      avatar: encodeUconAvatar({ archetype: id, overrides: {} }),
      archetype: id,
    })
  ),
];
const CLI_ENTRIES: readonly Entry[] = UCON_CLI_SKINS.map((skin) => ({
  id: 'cli:' + skin.id,
  name: skin.name,
  category: 'cli' as const,
  avatar: encodeUconCliAvatar(skin.id),
  cliAgentId: skin.id,
}));
const STATES: readonly UconBotState[] = ['idle', 'working', 'needs_input', 'error', 'sleep'];
const GLYPHS: readonly UconEyes[] = ['dots', 'code', 'scan', 'terminal', 'chart', 'nodes', 'app'];

const UconGalleryModal: React.FC<Props> = ({ visible, mode, onClose }) => {
  const { t } = useTranslation();
  const packageSkins = useUconPackageSkins(visible);
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('tomny');
  const [previewState, setPreviewState] = useState<UconBotState>('idle');
  const [previewGlyph, setPreviewGlyph] = useState<UconEyes>('dots');
  const [overrides, setOverrides] = useState<UconAppearanceOverride>({});
  const [copied, setCopied] = useState(false);
  const entries = useMemo<readonly Entry[]>(
    () => [
      ...CORE_ENTRIES,
      ...CLI_ENTRIES,
      ...packageSkins.map(
        (skin): Entry => ({
          id: 'pkg:' + skin.packageId + ':' + skin.id,
          name: skin.name,
          category: 'package',
          avatar: encodePackageAvatar({ packageId: skin.packageId, skinId: skin.id, overrides: {} }),
          pkg: skin,
        })
      ),
    ],
    [packageSkins]
  );
  const visibleEntries = entries.filter(
    (entry) =>
      (category === 'all' || category === entry.category) &&
      entry.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const customBase = selected.archetype
    ? resolveUconAppearance(selected.archetype, overrides)
    : selected.pkg
      ? resolveUconAppearance(selected.pkg.archetype, { ...selected.pkg.appearance, ...overrides })
      : null;
  const marker =
    selected.category === 'core' && selected.archetype
      ? encodeUconAvatar({ archetype: selected.archetype, overrides })
      : selected.pkg
        ? encodePackageAvatar({ packageId: selected.pkg.packageId, skinId: selected.pkg.id, overrides })
        : selected.avatar;
  const updateSelection = (entry: Entry) => {
    setSelectedId(entry.id);
    setOverrides({});
    setCopied(false);
  };
  const copyMarker = async () => {
    try {
      await navigator.clipboard.writeText(marker);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      title={t('settings.ucon.galleryTitle', { defaultValue: 'UCON Gallery & Studio' })}
      className='ucon-gallery-modal'
      unmountOnExit
      style={{ width: 'min(1100px, 96vw)', maxWidth: '1100px' }}
    >
      <div className='ucon-gallery' data-testid='ucon-gallery'>
        <p className='ucon-gallery__hint'>
          {t('settings.ucon.galleryHint', {
            defaultValue:
              'Explore real Canvas skins. CLI identity is independent of the selected model; previews never change an agent.',
          })}
        </p>
        <div className='ucon-gallery__toolbar'>
          <label>
            {t('settings.ucon.filter', { defaultValue: 'Type' })}
            <select
              data-testid='ucon-filter'
              value={category}
              onChange={(event) => setCategory(event.target.value as Category)}
            >
              <option value='all'>{t('settings.ucon.all', { defaultValue: 'All' })}</option>
              <option value='core'>{t('settings.ucon.core', { defaultValue: 'Core' })}</option>
              <option value='cli'>{t('settings.ucon.cli', { defaultValue: 'CLI Agents' })}</option>
              <option value='package'>{t('settings.ucon.packages', { defaultValue: 'Installed packages' })}</option>
            </select>
          </label>
          <label>
            {t('settings.ucon.search', { defaultValue: 'Search skins' })}
            <input
              data-testid='ucon-search'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Claude, Grok, Tomny…'
            />
          </label>
          <span className='ucon-gallery__count'>
            {visibleEntries.length} / {entries.length}
          </span>
        </div>
        <div className='ucon-gallery__layout'>
          <div className='ucon-gallery__grid' data-testid='ucon-skin-grid'>
            {visibleEntries.map((entry) => (
              <button
                type='button'
                key={entry.id}
                className={'ucon-gallery__card' + (entry.id === selected.id ? ' is-selected' : '')}
                aria-pressed={entry.id === selected.id}
                onClick={() => updateSelection(entry)}
                data-testid={'ucon-skin-' + entry.id}
              >
                <UconBot
                  placement='gallery'
                  staticPreview
                  state='idle'
                  size='large'
                  label={entry.name}
                  avatar={entry.avatar}
                  cliAgentId={entry.cliAgentId}
                />
                <strong>{entry.name}</strong>
                <small>{entry.category === 'cli' ? 'CLI' : entry.category === 'core' ? 'Core' : 'Package'}</small>
              </button>
            ))}
            {visibleEntries.length === 0 && <p>{t('settings.ucon.empty', { defaultValue: 'No matching skins.' })}</p>}
          </div>
          <section
            className='ucon-gallery__detail'
            aria-label={t('settings.ucon.preview', { defaultValue: 'Live preview' })}
          >
            <h3>{selected.name}</h3>
            <div className='ucon-gallery__portrait' data-testid='ucon-selected-preview'>
              <UconBot
                placement='gallery'
                state={previewState}
                size='preview'
                label={selected.name}
                avatar={selected.category === 'cli' ? selected.avatar : marker}
                cliAgentId={selected.cliAgentId}
                taskGlyph={previewGlyph === 'dots' ? undefined : previewGlyph}
              />
              <UconBot
                placement='gallery'
                staticPreview
                state={previewState}
                size='mini'
                label={selected.name + ' mini'}
                avatar={selected.category === 'cli' ? selected.avatar : marker}
                cliAgentId={selected.cliAgentId}
                isSubagent
              />
            </div>
            <div className='ucon-gallery__controls'>
              <label>
                {t('settings.ucon.state', { defaultValue: 'Status' })}
                <select
                  data-testid='ucon-preview-state'
                  value={previewState}
                  onChange={(event) => setPreviewState(event.target.value as UconBotState)}
                >
                  {STATES.map((state) => (
                    <option value={state} key={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('settings.ucon.glyph', { defaultValue: 'Demo eyes / tool' })}
                <select
                  data-testid='ucon-preview-glyph'
                  value={previewGlyph}
                  onChange={(event) => setPreviewGlyph(event.target.value as UconEyes)}
                >
                  {GLYPHS.map((glyph) => (
                    <option value={glyph} key={glyph}>
                      {glyph}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {mode === 'studio' && customBase ? (
              <div className='ucon-gallery__slots' data-testid='ucon-studio-slots'>
                {Object.entries(UCON_SLOT_OPTIONS).map(([slot, options]) => (
                  <label key={slot}>
                    {t('settings.uconPart.' + slot, { defaultValue: slot })}
                    <select
                      data-testid={'ucon-studio-' + slot}
                      value={String(customBase[slot as keyof UconAppearance] ?? 'none')}
                      onChange={(event) => {
                        setOverrides((current) => ({ ...current, [slot]: event.target.value }));
                        setCopied(false);
                      }}
                    >
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <Button size='small' onClick={() => setOverrides({})}>
                  {t('settings.ucon.resetParts', { defaultValue: 'Reset accessories' })}
                </Button>
              </div>
            ) : mode === 'studio' ? (
              <p className='ucon-gallery__hint'>
                {t('settings.ucon.cliFixed', {
                  defaultValue:
                    'CLI brand skins retain their identity. Choose a Core or package skin to edit accessories.',
                })}
              </p>
            ) : null}
            <div className='ucon-gallery__marker'>
              <code data-testid='ucon-avatar-marker'>{marker}</code>
              <Button
                onClick={() => {
                  void copyMarker();
                }}
                size='small'
              >
                {copied
                  ? t('settings.ucon.copied', { defaultValue: 'Copied' })
                  : t('settings.ucon.copy', { defaultValue: 'Copy avatar code' })}
              </Button>
            </div>
            <p className='ucon-gallery__hint'>
              {t('settings.ucon.copyHint', {
                defaultValue:
                  'Preview only. Copy this avatar code for an Assistant; nothing is applied to running agents.',
              })}
            </p>
          </section>
        </div>
      </div>
    </Modal>
  );
};

export default UconGalleryModal;
