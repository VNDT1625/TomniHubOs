import { Button, Input, Message, Tag } from '@arco-design/web-react';
import { Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SecretSetView } from '@/common/types/platform/sessionSecrets';
import type { SecretSetsApi } from '@/renderer/services/secretSetsClient';
import { LegacyImportNotice } from './LegacyImportNotice';
import { SecretSetForm, type SecretSetFormSeed } from './SecretSetForm';
import { revealKey, useSecretSets } from './useSecretSets';

type SecretSetsPanelProps = {
  /** The scope's operations; must stay the same object while the scope is the same. Null shows nothing. */
  api: SecretSetsApi | null;
  /** `session`: temporary sets of one conversation. `company`: permanent sets of one company group chat. */
  scope: 'session' | 'company' | 'package';
  active: boolean;
  /** Only variable names from Main; pre-fills a package secret form without exposing any values. */
  initialFields?: readonly string[];
  onChanged?: () => void;
};

/** The texts that differ by scope: a conversation, a company group chat or a Package App. */
const SCOPE_KEYS = {
  session: { title: 'titleSession', usage: 'usageSession', empty: 'emptySession', section: 'sectionSession' },
  company: { title: 'titleCompany', usage: 'usageCompany', empty: 'emptyCompany', section: 'sectionCompany' },
  package: { title: 'titlePackage', usage: 'usagePackage', empty: 'emptyPackage', section: 'sectionPackage' },
} as const;

const seedOf = (set: SecretSetView): SecretSetFormSeed => ({
  handle: set.handle,
  label: set.label,
  ...(set.note ? { note: set.note } : {}),
  fields: set.fields,
  destinations: set.destinations,
  ...(set.hosts ? { hosts: set.hosts } : {}),
});

/**
 * The secret sets of one scope: add, edit, remove, reveal. Values are written here and encrypted by Main; an agent
 * only sees a label, variable names and where each set can be typed (through the `tomny_secret_*` tools).
 */
export const SecretSetsPanel: React.FC<SecretSetsPanelProps> = ({ api, scope, active, initialFields, onChanged }) => {
  const { t } = useTranslation();
  const key = (name: string) => t(`guid.hubHome.secrets.${name}`);
  const secrets = useSecretSets(api, active);
  const [form, setForm] = useState<{ seed: SecretSetFormSeed | null } | null>(null);

  const own = secrets.sets.filter((set) => set.scope === scope);
  const shared = secrets.sets.filter((set) => set.scope === 'app');
  const empty = !secrets.loading && own.length === 0 && secrets.requests.length === 0;

  const destinationTags = (set: { destinations: string[]; hosts?: string[] }) => (
    <span className='hub-secret-tags'>
      {set.destinations.map((destination) => (
        <Tag key={destination} size='small'>
          {key(`destination.${destination}`)}
        </Tag>
      ))}
      {set.hosts?.map((host) => (
        <Tag key={host} size='small' title={host}>
          {host}
        </Tag>
      ))}
    </span>
  );

  const fields = (set: SecretSetView, canReveal: boolean) =>
    set.fields.map((field) => {
      const id = revealKey(set.handle, field);
      return (
        <div className='hub-secret-key-row' key={field}>
          <code>{field}</code>
          {canReveal && (
            <Button
              size='mini'
              type='text'
              aria-label={`${key(secrets.revealed[id] === undefined ? 'reveal' : 'hide')}: ${field}`}
              loading={secrets.revealing === id}
              disabled={secrets.busy}
              onClick={() => void secrets.toggleReveal(set.handle, field)}
            >
              {secrets.revealed[id] === undefined ? <Eye size={14} /> : <EyeOff size={14} />}
            </Button>
          )}
          {secrets.revealed[id] !== undefined && (
            <Input size='mini' readOnly aria-label={field} value={secrets.revealed[id]} />
          )}
        </div>
      );
    });

  if (!api) {
    return (
      <div className='hub-session-secrets hub-session-secrets--empty'>
        <KeyRound size={24} aria-hidden='true' />
        <span>{key('selectAgent')}</span>
      </div>
    );
  }

  return (
    <section className='hub-session-secrets' aria-label={key('title')} aria-busy={secrets.loading || secrets.busy}>
      <header className='hub-secret-intro'>
        <KeyRound size={18} aria-hidden='true' />
        <div>
          <strong>{key(SCOPE_KEYS[scope].title)}</strong>
          <p className='hub-secret-boundary'>{key('boundary')}</p>
          <p className='hub-secret-boundary' data-testid='hub-secret-scope-note'>
            {key(SCOPE_KEYS[scope].usage)}
          </p>
        </div>
        <Button
          size='mini'
          type='text'
          aria-label={key('refresh')}
          onClick={() => void secrets.refresh()}
          loading={secrets.loading}
        >
          <RefreshCw size={14} />
        </Button>
      </header>

      {(secrets.error === 'keychain' || (scope !== 'session' && !secrets.keychainAvailable)) && (
        <div className='hub-memory-error' role='alert'>
          {key('keychainUnavailable')}
        </div>
      )}
      {api?.legacy && (
        <LegacyImportNotice legacy={api.legacy} active={active} onImported={() => void secrets.refresh()} />
      )}
      {secrets.error === 'failed' && (
        <div className='hub-memory-error' role='alert'>
          {key('error')}
        </div>
      )}

      {secrets.requests.length > 0 && (
        <section className='hub-secret-section' aria-label={key('requestsTitle')}>
          <h4>{key('requestsTitle')}</h4>
          <p className='hub-secret-boundary'>{key('requestsHint')}</p>
          {secrets.requests.map((request) => (
            <article className='hub-secret-combo' key={request.id} data-testid={`hub-secret-request-${request.id}`}>
              <div className='hub-secret-combo-head'>
                <KeyRound size={14} aria-hidden='true' />
                <div>
                  <strong>{request.label}</strong>
                  <span>{request.note}</span>
                </div>
              </div>
              <div className='hub-secret-key-row'>
                {request.fields.map((field) => (
                  <code key={field}>{field}</code>
                ))}
              </div>
              {destinationTags(request)}
              <div className='hub-secret-actions'>
                <Button
                  size='small'
                  disabled={secrets.busy}
                  aria-label={`${key('fulfil')}: ${request.label}`}
                  onClick={() =>
                    setForm({
                      seed: {
                        requestId: request.id,
                        label: request.label,
                        note: request.note,
                        fields: request.fields,
                        destinations: request.destinations,
                        ...(request.hosts ? { hosts: request.hosts } : {}),
                      },
                    })
                  }
                >
                  {key('fulfil')}
                </Button>
                <Button
                  size='small'
                  disabled={secrets.busy}
                  aria-label={`${key('dismiss')}: ${request.label}`}
                  onClick={() => void secrets.dismissRequest(request.id)}
                >
                  {key('dismiss')}
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}

      <div className='hub-secret-actions'>
        <Button
          size='small'
          type='primary'
          disabled={secrets.busy}
          onClick={() =>
            setForm((current) =>
              current
                ? null
                : {
                    seed:
                      scope === 'package' && initialFields?.length
                        ? { label: key('titlePackage'), fields: [...initialFields], destinations: ['process'] }
                        : null,
                  }
            )
          }
        >
          <Plus size={14} /> {key('add')}
        </Button>
      </div>

      {form && (
        <SecretSetForm
          key={form.seed?.handle ?? form.seed?.requestId ?? 'new'}
          seed={form.seed}
          busy={secrets.busy}
          onCancel={() => setForm(null)}
          onSubmit={async (input) => {
            const outcome = await secrets.save(input);
            if (outcome.ok) {
              setForm(null);
              Message.success(key('saved'));
              onChanged?.();
            }
            return outcome.ok;
          }}
        />
      )}

      <div className='hub-secret-list'>
        {empty && <p className='hub-secret-empty'>{key(SCOPE_KEYS[scope].empty)}</p>}

        {own.length > 0 && (
          <section className='hub-secret-section' aria-label={key(SCOPE_KEYS[scope].section)}>
            <h4>{key(SCOPE_KEYS[scope].section)}</h4>
            {own.map((set) => (
              <article className='hub-secret-combo' key={set.handle} data-testid={`hub-secret-set-${set.label}`}>
                <div className='hub-secret-combo-head'>
                  <KeyRound size={14} aria-hidden='true' />
                  <div>
                    <strong>{set.label}</strong>
                    {set.note && <span>{set.note}</span>}
                  </div>
                  <Button
                    size='mini'
                    type='text'
                    aria-label={`${key('edit')}: ${set.label}`}
                    disabled={secrets.busy}
                    onClick={() => setForm({ seed: seedOf(set) })}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    aria-label={`${key('remove')}: ${set.label}`}
                    disabled={secrets.busy}
                    onClick={() => void secrets.remove(set.handle).then(() => onChanged?.())}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
                {destinationTags(set)}
                {fields(set, true)}
              </article>
            ))}
          </section>
        )}

        {shared.length > 0 && (
          <section className='hub-secret-section' aria-label={key('sharedTitle')}>
            <h4>{key('sharedTitle')}</h4>
            <p className='hub-secret-boundary'>{key('sharedHint')}</p>
            {shared.map((set) => (
              <article className='hub-secret-combo' key={set.handle} data-testid={`hub-secret-shared-${set.label}`}>
                <div className='hub-secret-combo-head'>
                  <KeyRound size={14} aria-hidden='true' />
                  <div>
                    <strong>{set.label}</strong>
                    {set.note && <span>{set.note}</span>}
                  </div>
                </div>
                {destinationTags(set)}
                {fields(set, false)}
              </article>
            ))}
          </section>
        )}
      </div>
    </section>
  );
};
