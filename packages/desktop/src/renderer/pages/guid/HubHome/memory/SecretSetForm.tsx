import { Button, Checkbox, Input } from '@arco-design/web-react';
import { Plus, Save, Trash2 } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SECRET_DESTINATIONS,
  SECRET_SET_LIMITS,
  type SecretDestinationId,
  type SecretSetInput,
} from '@/common/types/platform/sessionSecrets';

/** What the form starts from: a set being edited, or an agent request being fulfilled. */
export type SecretSetFormSeed = {
  handle?: string;
  requestId?: string;
  label: string;
  note?: string;
  fields: string[];
  destinations: SecretDestinationId[];
  hosts?: string[];
};

type SecretSetFormProps = {
  seed: SecretSetFormSeed | null;
  busy: boolean;
  /** Resolves true when the set was saved, so the form can close. */
  onSubmit: (input: SecretSetInput) => Promise<boolean>;
  onCancel: () => void;
};

type Variable = { id: number; name: string; value: string };

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const splitHosts = (text: string): string[] =>
  text
    .split(/[\s,;]+/u)
    .map((host) => host.trim())
    .filter(Boolean);

/** Create or edit one secret set. Stored values are never shown: every value is typed again to replace a set. */
export const SecretSetForm: React.FC<SecretSetFormProps> = ({ seed, busy, onSubmit, onCancel }) => {
  const { t } = useTranslation();
  const key = (name: string) => t(`guid.hubHome.secrets.${name}`);
  const sequence = useRef(0);
  const variable = (name = ''): Variable => ({ id: ++sequence.current, name, value: '' });
  const [label, setLabel] = useState(seed?.label ?? '');
  const [note, setNote] = useState(seed?.note ?? '');
  const [destinations, setDestinations] = useState<SecretDestinationId[]>(seed?.destinations ?? ['process']);
  const [hosts, setHosts] = useState((seed?.hosts ?? []).join(', '));
  const [variables, setVariables] = useState<Variable[]>(() =>
    seed && seed.fields.length > 0 ? seed.fields.map((name) => variable(name)) : [variable()]
  );
  const [incomplete, setIncomplete] = useState(false);
  const mode = seed?.handle ? 'edit' : seed?.requestId ? 'fulfil' : 'create';

  const toggle = (destination: SecretDestinationId, on: boolean): void =>
    setDestinations((current) =>
      on ? [...new Set([...current, destination])] : current.filter((item) => item !== destination)
    );
  const update = (id: number, patch: Partial<Variable>): void =>
    setVariables((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const submit = async (): Promise<void> => {
    const names = variables.map((item) => item.name.trim());
    const hostList = splitHosts(hosts);
    const invalid =
      !label.trim() ||
      destinations.length === 0 ||
      (destinations.includes('browser') && hostList.length === 0) ||
      variables.length === 0 ||
      names.some((name) => !NAME.test(name)) ||
      new Set(names).size !== names.length ||
      variables.some((item) => !item.value.trim());
    setIncomplete(invalid);
    if (invalid || busy) return;
    const saved = await onSubmit({
      ...(seed?.handle ? { handle: seed.handle } : {}),
      ...(seed?.requestId ? { requestId: seed.requestId } : {}),
      label: label.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
      destinations,
      ...(destinations.includes('browser') ? { hosts: hostList } : {}),
      variables: variables.map((item) => ({ name: item.name.trim(), value: item.value })),
    });
    // Plaintext never lingers in the form after a failed attempt.
    if (!saved) setVariables((current) => current.map((item) => ({ ...item, value: '' })));
  };

  return (
    <form
      className='hub-secret-combo-form'
      aria-label={key(mode === 'edit' ? 'formEdit' : mode === 'fulfil' ? 'formFulfil' : 'formCreate')}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <strong>{key(mode === 'edit' ? 'formEdit' : mode === 'fulfil' ? 'formFulfil' : 'formCreate')}</strong>
      <Input
        size='mini'
        aria-label={key('name')}
        placeholder={key('namePlaceholder')}
        value={label}
        maxLength={SECRET_SET_LIMITS.maxLabelChars}
        onChange={setLabel}
        disabled={busy}
      />
      <Input
        size='mini'
        aria-label={key('note')}
        placeholder={key('notePlaceholder')}
        value={note}
        maxLength={SECRET_SET_LIMITS.maxNoteChars}
        onChange={setNote}
        disabled={busy}
      />
      <fieldset className='hub-secret-destinations'>
        <legend>{key('destinations')}</legend>
        {SECRET_DESTINATIONS.map((destination) => (
          <Checkbox
            key={destination}
            checked={destinations.includes(destination)}
            disabled={busy}
            onChange={(checked) => toggle(destination, checked)}
          >
            {key(`destination.${destination}`)}
          </Checkbox>
        ))}
      </fieldset>
      {destinations.includes('browser') && (
        <Input
          size='mini'
          aria-label={key('hosts')}
          placeholder={key('hostsPlaceholder')}
          value={hosts}
          onChange={setHosts}
          disabled={busy}
        />
      )}
      {mode === 'edit' && <p className='hub-secret-boundary'>{key('retypeHint')}</p>}
      {variables.map((item, index) => (
        <div className='hub-secret-combo-key' key={item.id}>
          <Input
            size='mini'
            aria-label={`${key('variableName')} ${index + 1}`}
            placeholder={key('variableName')}
            value={item.name}
            maxLength={SECRET_SET_LIMITS.maxNameChars}
            onChange={(value) => update(item.id, { name: value })}
            disabled={busy}
          />
          <Input.Password
            size='mini'
            aria-label={`${key('variableValue')} ${index + 1}`}
            placeholder={key('variableValue')}
            value={item.value}
            maxLength={SECRET_SET_LIMITS.maxValueChars}
            onChange={(value) => update(item.id, { value })}
            disabled={busy}
          />
          <Button
            size='mini'
            type='text'
            aria-label={`${key('removeVariable')} ${index + 1}`}
            disabled={busy || variables.length <= 1}
            onClick={() => setVariables((current) => current.filter((entry) => entry.id !== item.id))}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button
        size='mini'
        type='text'
        disabled={busy || variables.length >= SECRET_SET_LIMITS.maxVariables}
        onClick={() => setVariables((current) => [...current, variable()])}
      >
        <Plus size={14} /> {key('addVariable')}
      </Button>
      {incomplete && (
        <p className='hub-secret-boundary' role='alert'>
          {key('incomplete')}
        </p>
      )}
      <div className='hub-secret-actions'>
        <Button size='small' onClick={onCancel} disabled={busy}>
          {key('cancel')}
        </Button>
        <Button size='small' type='primary' htmlType='submit' loading={busy}>
          <Save size={14} /> {key('save')}
        </Button>
      </div>
    </form>
  );
};
