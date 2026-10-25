import {useMutation} from '@tanstack/react-query';
import {Braces, ListPlus, Plus, Trash2, WandSparkles} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {api, ApiError, collPath, errorMessage} from '../lib/api';
import {useConnection} from '../lib/connection';
import {
  idToText,
  prettyJson,
  type WireDocument,
  type WireValue,
} from '../lib/wire';
import {JsonEditor} from './json-editor';
import {Button} from './ui/button';
import {Modal} from './ui/dialog';
import {ErrorState} from './ui/empty-state';
import {Input, Select} from './ui/input';
import {Segmented} from './ui/segmented';

type Mode = 'create' | 'edit' | 'duplicate';
type FieldType =
  | 'string'
  | 'int'
  | 'double'
  | 'long'
  | 'decimal'
  | 'bool'
  | 'date'
  | 'objectId'
  | 'null'
  | 'json';

interface FormRow {
  id: number;
  name: string;
  type: FieldType;
  value: string;
}

const TYPE_LABELS: Record<FieldType, string> = {
  string: 'String',
  int: 'Int32',
  double: 'Double',
  long: 'Int64',
  decimal: 'Decimal128',
  bool: 'Boolean',
  date: 'Date',
  objectId: 'ObjectId',
  null: 'Null',
  json: 'Objet / tableau',
};

let rowId = 0;

function newRow(): FormRow {
  rowId++;
  return {id: rowId, name: '', type: 'string', value: ''};
}

function rowToText(row: FormRow): string {
  const raw = row.value.trim();
  switch (row.type) {
    case 'string':
      return JSON.stringify(row.value);
    case 'int':
      if (!/^-?\d+$/.test(raw)) {
        throw new Error(`« ${row.name} » : entier attendu`);
      }
      return `NumberInt(${raw})`;
    case 'double':
      if (raw === '' || Number.isNaN(Number(raw))) {
        throw new Error(`« ${row.name} » : nombre attendu`);
      }
      return `Double(${JSON.stringify(raw)})`;
    case 'long':
      if (!/^-?\d+$/.test(raw)) {
        throw new Error(`« ${row.name} » : entier attendu`);
      }
      return `NumberLong(${JSON.stringify(raw)})`;
    case 'decimal':
      return `NumberDecimal(${JSON.stringify(raw || '0')})`;
    case 'bool':
      return raw === 'true' ? 'true' : 'false';
    case 'date': {
      const date = new Date(raw);
      if (!raw || Number.isNaN(date.getTime())) {
        throw new Error(`« ${row.name} » : date invalide`);
      }
      return `ISODate(${JSON.stringify(date.toISOString())})`;
    }
    case 'objectId':
      return raw ? `ObjectId(${JSON.stringify(raw)})` : 'ObjectId()';
    case 'null':
      return 'null';
    case 'json':
      return raw || '{}';
  }
}

function formToText(rows: FormRow[]): string {
  const used = rows.filter(row => row.name.trim());
  const names = new Set<string>();
  const lines = used.map(row => {
    const name = row.name.trim();
    if (names.has(name)) {
      throw new Error(`Le champ « ${name} » apparaît deux fois`);
    }
    names.add(name);
    return `  ${JSON.stringify(name)}: ${rowToText(row)}`;
  });
  return lines.length ? `{\n${lines.join(',\n')}\n}` : '{}';
}

function FormBuilder({
  rows,
  onChange,
}: {
  rows: FormRow[];
  onChange: (rows: FormRow[]) => void;
}) {
  const update = (id: number, patch: Partial<FormRow>) =>
    onChange(rows.map(row => (row.id === id ? {...row, ...patch} : row)));
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_150px_1.4fr_32px] gap-2 px-0.5 text-xs font-medium text-muted sm:grid">
        <span>Champ</span>
        <span>Type</span>
        <span>Valeur</span>
      </div>
      {rows.map(row => (
        <div
          key={row.id}
          className="grid grid-cols-[1fr_32px] gap-2 rounded border border-line p-2 sm:grid-cols-[1fr_150px_1.4fr_32px] sm:border-0 sm:p-0"
        >
          <Input
            value={row.name}
            onChange={event => update(row.id, {name: event.target.value})}
            placeholder="nom"
            aria-label="Nom du champ"
            className="font-mono"
            spellCheck={false}
          />
          <Button
            variant="ghost"
            size="icon"
            className="sm:order-last"
            onClick={() => onChange(rows.filter(item => item.id !== row.id))}
            aria-label="Retirer le champ"
          >
            <Trash2 />
          </Button>
          <Select
            value={row.type}
            onChange={event =>
              update(row.id, {
                type: event.target.value as FieldType,
                value: event.target.value === 'bool' ? 'true' : row.value,
              })
            }
            aria-label="Type"
            className="col-span-2 sm:col-span-1"
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <div className="col-span-2 sm:col-span-1">
            {row.type === 'bool' ? (
              <Select
                value={row.value}
                onChange={event => update(row.id, {value: event.target.value})}
                aria-label="Valeur"
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </Select>
            ) : row.type === 'null' ? (
              <Input disabled value="null" aria-label="Valeur" />
            ) : row.type === 'date' ? (
              <Input
                type="datetime-local"
                step="1"
                value={row.value}
                onChange={event => update(row.id, {value: event.target.value})}
                aria-label="Valeur"
              />
            ) : (
              <Input
                value={row.value}
                onChange={event => update(row.id, {value: event.target.value})}
                placeholder={
                  row.type === 'objectId'
                    ? 'vide = généré automatiquement'
                    : row.type === 'json'
                      ? '{"a": 1} ou [1, 2]'
                      : ''
                }
                aria-label="Valeur"
                className={row.type === 'string' ? '' : 'font-mono'}
                spellCheck={false}
              />
            )}
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, newRow()])}
      >
        <Plus />
        Ajouter un champ
      </Button>
    </div>
  );
}

export function DocumentEditor({
  db,
  coll,
  mode,
  document,
  open,
  onOpenChange,
  onSaved,
  fields,
}: {
  db: string;
  coll: string;
  mode: Mode;
  document?: WireDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  fields: string[];
}) {
  const {conn} = useConnection();
  const [tab, setTab] = useState<'json' | 'form'>('json');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<FormRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    if (mode === 'create') {
      setTab('form');
      setRows([newRow(), newRow()]);
      setText('{\n  \n}');
    } else {
      setTab('json');
      setText(prettyJson(document ?? {}));
    }
  }, [open, mode, document]);

  const currentText = () => (tab === 'form' ? formToText(rows) : text);

  const save = useMutation({
    mutationFn: async () => {
      const body = currentText();
      const base = collPath(conn!, db, coll);
      if (mode === 'edit') {
        return api('PUT', `${base}/documents`, {
          id: idToText(document?._id as WireValue),
          document: body,
        });
      }
      return api('POST', `${base}/documents`, {document: body});
    },
    onSuccess: () => {
      toast.success(
        mode === 'edit' ? 'Document enregistré' : 'Document ajouté',
      );
      onSaved();
      onOpenChange(false);
    },
    onError: caught => setError(errorMessage(caught)),
  });

  const format = async () => {
    try {
      const result = await api<{text: string}>('POST', '/tools/format', {text});
      setText(result.text);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : errorMessage(caught),
      );
    }
  };

  const switchTab = (next: 'json' | 'form') => {
    if (next === 'json' && tab === 'form') {
      try {
        setText(formToText(rows));
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
        return;
      }
    }
    setTab(next);
  };

  const submit = () => {
    setError(null);
    try {
      currentText();
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    save.mutate();
  };

  const titles: Record<Mode, string> = {
    create: 'Nouveau document',
    edit: 'Modifier le document',
    duplicate: 'Dupliquer le document',
  };

  const subtitle = (
    <span className="font-mono text-xs">
      {db}.{coll}
      {mode === 'edit' ? ` · _id ${JSON.stringify(document?._id)}` : ''}
    </span>
  );
  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-faint sm:block">
        Types BSON : ObjectId(), ISODate(), NumberLong(), NumberDecimal() ou
        Extended JSON.
      </span>
      <Button variant="ghost" onClick={() => onOpenChange(false)}>
        Annuler
      </Button>
      <Button variant="primary" loading={save.isPending} onClick={submit}>
        {mode === 'edit' ? 'Enregistrer' : 'Insérer'}
      </Button>
    </>
  );
  const body = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mode === 'create' ? (
          <Segmented
            label="Mode d’édition"
            value={tab}
            onChange={switchTab}
            options={[
              {value: 'form', label: 'Formulaire', icon: <ListPlus />},
              {value: 'json', label: 'JSON', icon: <Braces />},
            ]}
          />
        ) : (
          <span className="text-xs text-muted">
            {mode === 'duplicate'
              ? 'Le champ _id a été retiré : un nouvel identifiant sera généré.'
              : 'Le champ _id ne peut pas être modifié.'}
          </span>
        )}
        {tab === 'json' ? (
          <Button variant="ghost" size="sm" onClick={() => void format()}>
            <WandSparkles />
            Formater
          </Button>
        ) : null}
      </div>
      {tab === 'form' ? (
        <FormBuilder rows={rows} onChange={setRows} />
      ) : (
        <JsonEditor
          value={text}
          onChange={setText}
          onRun={submit}
          mode="document"
          fields={fields}
          minHeight="320px"
          maxHeight="56vh"
          autoFocus
          ariaLabel="Document JSON"
        />
      )}
      {error ? <ErrorState message={error} /> : null}
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={titles[mode]}
      subtitle={subtitle}
      footer={footer}
    >
      {body}
    </Modal>
  );
}
