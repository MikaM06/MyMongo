import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {KeyRound, Lock, Plus, Trash2, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {useOutletContext, useParams} from 'react-router';
import {toast} from 'sonner';
import {JsonEditor} from '../components/json-editor';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Card, CardHeader} from '../components/ui/card';
import {ConfirmDialog} from '../components/ui/confirm-dialog';
import {Modal} from '../components/ui/dialog';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {Checkbox, Field, Input, Select} from '../components/ui/input';
import {LoadingBlock} from '../components/ui/spinner';
import {api, collPath, enc, errorMessage} from '../lib/api';
import {useAuth} from '../lib/auth';
import {useConnection} from '../lib/connection';
import {formatBytes, formatDateTime, formatNumber} from '../lib/format';
import {keys, useSchema} from '../lib/queries';
import type {WireValue} from '../lib/wire';
import type {CollectionContext} from './collection-layout';

interface IndexInfo {
  name: string;
  key: Record<string, WireValue>;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  expireAfterSeconds: number | null;
  partialFilterExpression: WireValue | null;
  size: number | null;
  usage: {ops: number; since: string | null} | null;
  protected: boolean;
}

type KeyType = '1' | '-1' | 'text' | '2dsphere' | 'hashed';

const KEY_TYPES: {value: KeyType; label: string}[] = [
  {value: '1', label: 'Ascendant (1)'},
  {value: '-1', label: 'Descendant (-1)'},
  {value: 'text', label: 'Texte'},
  {value: '2dsphere', label: 'Géospatial (2dsphere)'},
  {value: 'hashed', label: 'Haché'},
];

function keyLabel(value: WireValue): string {
  if (value === 1) {
    return 'asc';
  }
  if (value === -1) {
    return 'desc';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function CreateIndexDialog({
  open,
  onOpenChange,
  db,
  coll,
  fields,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: string;
  coll: string;
  fields: string[];
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const [keyRows, setKeyRows] = useState<{field: string; type: KeyType}[]>([
    {field: '', type: '1'},
  ]);
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ttl, setTtl] = useState('');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKeyRows([{field: '', type: '1'}]);
      setName('');
      setUnique(false);
      setSparse(false);
      setHidden(false);
      setTtl('');
      setPartial('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api<{name: string}>('POST', `${collPath(conn!, db, coll)}/indexes`, {
        keys: keyRows.filter(row => row.field.trim()),
        ...(name.trim() ? {name: name.trim()} : {}),
        unique,
        sparse,
        hidden,
        ...(ttl ? {expireAfterSeconds: Number(ttl)} : {}),
        ...(partial.trim() ? {partialFilterExpression: partial} : {}),
      }),
    onSuccess: async data => {
      toast.success(`Index « ${data.name} » créé`);
      await client.invalidateQueries({queryKey: keys.indexes(conn!, db, coll)});
      await client.invalidateQueries({queryKey: keys.collections(conn!, db)});
      onOpenChange(false);
    },
    onError: caught => setError(errorMessage(caught)),
  });

  const validKeys = keyRows.some(row => row.field.trim());
  const ttlAllowed = keyRows.filter(row => row.field.trim()).length === 1;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Créer un index"
      subtitle="Un index accélère les requêtes mais consomme de l’espace et ralentit légèrement les écritures."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!validKeys}
            loading={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            Créer l’index
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted">
            Champs {keyRows.length > 1 ? '(index composé, l’ordre compte)' : ''}
          </span>
          <datalist id="index-fields">
            {fields.map(field => (
              <option key={field} value={field} />
            ))}
          </datalist>
          {keyRows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <Input
                list="index-fields"
                value={row.field}
                onChange={event =>
                  setKeyRows(
                    keyRows.map((item, i) =>
                      i === index ? {...item, field: event.target.value} : item,
                    ),
                  )
                }
                placeholder="nom.du.champ"
                aria-label={`Champ ${index + 1}`}
                className="font-mono"
                spellCheck={false}
              />
              <Select
                value={row.type}
                onChange={event =>
                  setKeyRows(
                    keyRows.map((item, i) =>
                      i === index
                        ? {...item, type: event.target.value as KeyType}
                        : item,
                    ),
                  )
                }
                aria-label={`Type du champ ${index + 1}`}
                className="w-52 shrink-0"
              >
                {KEY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                size="icon"
                disabled={keyRows.length === 1}
                onClick={() =>
                  setKeyRows(keyRows.filter((_, i) => i !== index))
                }
                aria-label="Retirer ce champ"
              >
                <X />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setKeyRows([...keyRows, {field: '', type: '1'}])}
            disabled={keyRows.length >= 32}
          >
            <Plus />
            Ajouter un champ
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nom de l’index"
            htmlFor="index-name"
            hint="Optionnel : généré automatiquement."
          >
            <Input
              id="index-name"
              value={name}
              onChange={event => setName(event.target.value)}
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          <Field
            label="Expiration TTL (secondes)"
            htmlFor="index-ttl"
            hint={
              ttlAllowed
                ? 'Champ de type Date uniquement.'
                : 'Disponible pour un index sur un seul champ.'
            }
          >
            <Input
              id="index-ttl"
              type="number"
              min={0}
              value={ttl}
              onChange={event => setTtl(event.target.value)}
              disabled={!ttlAllowed}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Checkbox
            checked={unique}
            onChange={setUnique}
            label="Unique"
            hint="Refuse les doublons"
          />
          <Checkbox
            checked={sparse}
            onChange={setSparse}
            label="Sparse"
            hint="Ignore les documents sans le champ"
          />
          <Checkbox
            checked={hidden}
            onChange={setHidden}
            label="Masqué"
            hint="Non utilisé par le planificateur"
          />
        </div>
        <Field
          label="Filtre partiel (partialFilterExpression)"
          hint="Optionnel : n’indexe que les documents correspondants."
        >
          <JsonEditor
            value={partial}
            onChange={setPartial}
            fields={fields}
            minHeight="38px"
            placeholder='{ "status": "active" }'
            ariaLabel="Filtre partiel"
          />
        </Field>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}

export function IndexesPage() {
  const {db = '', coll = ''} = useParams();
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const {info} = useOutletContext<CollectionContext>();
  const client = useQueryClient();
  const schema = useSchema(conn!, db, coll);
  const [creating, setCreating] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);
  const isView = info?.type === 'view';

  const indexes = useQuery({
    queryKey: keys.indexes(conn!, db, coll),
    queryFn: () =>
      api<{indexes: IndexInfo[]}>(
        'GET',
        `${collPath(conn!, db, coll)}/indexes`,
      ),
    enabled: !isView,
    select: data => data.indexes,
  });

  const drop = useMutation({
    mutationFn: (name: string) =>
      api('DELETE', `${collPath(conn!, db, coll)}/indexes/${enc(name)}`),
    onSuccess: async () => {
      toast.success(`Index « ${dropping} » supprimé`);
      setDropping(null);
      await client.invalidateQueries({queryKey: keys.indexes(conn!, db, coll)});
    },
    onError: error => toast.error(errorMessage(error)),
  });

  if (isView) {
    return (
      <EmptyState
        icon={<KeyRound />}
        title="Les vues n’ont pas d’index propres"
      >
        Les requêtes sur une vue utilisent les index de la collection source
        {info?.viewOn ? ` « ${info.viewOn} »` : ''}.
      </EmptyState>
    );
  }

  return (
    <div className="p-3 sm:p-5">
      <Card>
        <CardHeader
          icon={<KeyRound />}
          title={`Index${indexes.data ? ` (${indexes.data.length})` : ''}`}
          actions={
            isAdmin ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreating(true)}
              >
                <Plus />
                Créer un index
              </Button>
            ) : null
          }
        />
        {indexes.isLoading ? (
          <LoadingBlock />
        ) : indexes.isError ? (
          <div className="p-4">
            <ErrorState
              message={errorMessage(indexes.error)}
              onRetry={() => void indexes.refetch()}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Nom</th>
                  <th className="px-4 py-2.5 font-medium">Champs</th>
                  <th className="px-4 py-2.5 font-medium">Propriétés</th>
                  <th className="px-4 py-2.5 text-right font-medium">Taille</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">
                    Utilisations
                  </th>
                  <th className="w-12" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {indexes.data?.map(index => (
                  <tr key={index.name} className="hover:bg-hover/50">
                    <td className="px-4 py-2.5 font-mono text-[12.5px] font-medium">
                      {index.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(index.key).map(([field, value]) => (
                          <span
                            key={field}
                            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px]"
                          >
                            {field}
                            <span className="text-brand-ink">
                              {keyLabel(value)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {index.protected ? (
                          <Badge>
                            <Lock />
                            obligatoire
                          </Badge>
                        ) : null}
                        {index.unique ? (
                          <Badge tone="brand">unique</Badge>
                        ) : null}
                        {index.sparse ? <Badge>sparse</Badge> : null}
                        {index.hidden ? (
                          <Badge tone="warn">masqué</Badge>
                        ) : null}
                        {index.expireAfterSeconds !== null ? (
                          <Badge tone="info">
                            TTL {formatNumber(index.expireAfterSeconds)} s
                          </Badge>
                        ) : null}
                        {index.partialFilterExpression ? (
                          <Badge
                            title={JSON.stringify(
                              index.partialFilterExpression,
                            )}
                          >
                            partiel
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted tabular-nums">
                      {formatBytes(index.size)}
                    </td>
                    <td
                      className="hidden px-4 py-2.5 text-right text-muted tabular-nums md:table-cell"
                      title={
                        index.usage?.since
                          ? `Depuis ${formatDateTime(index.usage.since)}`
                          : undefined
                      }
                    >
                      {index.usage ? formatNumber(index.usage.ops) : '—'}
                    </td>
                    <td className="px-2 text-right">
                      {isAdmin && !index.protected ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDropping(index.name)}
                          aria-label={`Supprimer l’index ${index.name}`}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CreateIndexDialog
        open={creating}
        onOpenChange={setCreating}
        db={db}
        coll={coll}
        fields={schema.data?.fields.map(field => field.path) ?? []}
      />
      <ConfirmDialog
        open={Boolean(dropping)}
        onOpenChange={open => !open && setDropping(null)}
        title="Supprimer l’index"
        confirmLabel="Supprimer l’index"
        requireText={dropping ?? undefined}
        loading={drop.isPending}
        onConfirm={() => dropping && drop.mutate(dropping)}
      >
        <p>
          L’index <strong className="font-mono">{dropping}</strong> sera
          supprimé. Les requêtes qui l’utilisent pourraient devenir plus lentes
          {dropping &&
          indexes.data?.find(item => item.name === dropping)?.unique
            ? ' et l’unicité ne sera plus garantie'
            : ''}
          .
        </p>
      </ConfirmDialog>
    </div>
  );
}
