import {useMutation, useQueryClient} from '@tanstack/react-query';
import {type FormEvent, useEffect, useState} from 'react';
import {useNavigate} from 'react-router';
import {toast} from 'sonner';
import {api, dbPath, enc, errorMessage} from '../lib/api';
import {useConnection} from '../lib/connection';
import {keys} from '../lib/queries';
import {collUrl} from '../lib/selection';
import {Button} from './ui/button';
import {ConfirmDialog} from './ui/confirm-dialog';
import {Modal} from './ui/dialog';
import {Checkbox, Field, Input} from './ui/input';

const DB_NAME = /^[^/\\. "$*<>:|?]{1,63}$/;

function collectionNameError(name: string): string | null {
  if (!name) {
    return null;
  }
  if (name.includes('$')) {
    return 'Le caractère $ est interdit.';
  }
  if (name.startsWith('system.')) {
    return 'Le préfixe « system. » est réservé.';
  }
  if (name.startsWith('.') || name.endsWith('.')) {
    return 'Le nom ne peut pas commencer ou finir par un point.';
  }
  return null;
}

export function CreateDatabaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [collection, setCollection] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setCollection('');
    }
  }, [open]);
  const mutation = useMutation({
    mutationFn: () =>
      api('POST', `/conn/${enc(conn!)}/databases`, {name, collection}),
    onSuccess: async () => {
      toast.success(`Base « ${name} » créée`);
      await client.invalidateQueries({queryKey: keys.databases(conn!)});
      onOpenChange(false);
      void navigate(collUrl(name, collection));
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const nameError =
    name && !DB_NAME.test(name)
      ? 'Caractères interdits : / \\ . espace " $ * < > : | ?'
      : null;
  const collError = collectionNameError(collection);
  const valid = name && collection && !nameError && !collError;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) {
      mutation.mutate();
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle base de données"
      subtitle="MongoDB crée une base au moment où sa première collection est créée."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Créer la base
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nom de la base" htmlFor="db-name" error={nameError}>
          <Input
            id="db-name"
            autoFocus
            value={name}
            onChange={event => setName(event.target.value.trim())}
            placeholder="boutique"
            spellCheck={false}
          />
        </Field>
        <Field label="Première collection" htmlFor="db-coll" error={collError}>
          <Input
            id="db-coll"
            value={collection}
            onChange={event => setCollection(event.target.value.trim())}
            placeholder="commandes"
            spellCheck={false}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function CreateCollectionDialog({
  db,
  open,
  onOpenChange,
}: {
  db: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [capped, setCapped] = useState(false);
  const [sizeMb, setSizeMb] = useState('16');
  const [max, setMax] = useState('');
  useEffect(() => {
    if (open) {
      setName('');
      setCapped(false);
      setSizeMb('16');
      setMax('');
    }
  }, [open]);
  const mutation = useMutation({
    mutationFn: () =>
      api('POST', `${dbPath(conn!, db)}/collections`, {
        name,
        ...(capped
          ? {
              capped: true,
              size: Math.round(Number(sizeMb) * 1024 * 1024),
              ...(max ? {max: Number(max)} : {}),
            }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(`Collection « ${name} » créée`);
      await client.invalidateQueries({queryKey: keys.collections(conn!, db)});
      await client.invalidateQueries({queryKey: keys.databases(conn!)});
      onOpenChange(false);
      void navigate(collUrl(db, name));
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const error = collectionNameError(name);
  const sizeValid = !capped || Number(sizeMb) > 0;
  const valid = Boolean(name) && !error && sizeValid;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle collection"
      subtitle={
        <>
          Dans la base <span className="font-mono text-text">{db}</span>
        </>
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Créer la collection
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (valid) {
            mutation.mutate();
          }
        }}
      >
        <Field label="Nom" htmlFor="coll-name" error={error}>
          <Input
            id="coll-name"
            autoFocus
            value={name}
            onChange={event => setName(event.target.value.trim())}
            placeholder="clients"
            spellCheck={false}
          />
        </Field>
        <Checkbox
          checked={capped}
          onChange={setCapped}
          label="Collection plafonnée (capped)"
          hint="Taille fixe : les documents les plus anciens sont remplacés automatiquement."
        />
        {capped ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Taille maximale (Mo)" htmlFor="coll-size">
              <Input
                id="coll-size"
                type="number"
                min={1}
                value={sizeMb}
                onChange={event => setSizeMb(event.target.value)}
              />
            </Field>
            <Field label="Documents max." htmlFor="coll-max" hint="Optionnel">
              <Input
                id="coll-max"
                type="number"
                min={1}
                value={max}
                onChange={event => setMax(event.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function RenameCollectionDialog({
  db,
  coll,
  open,
  onOpenChange,
}: {
  db: string;
  coll: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(coll);
  useEffect(() => {
    if (open) {
      setName(coll);
    }
  }, [open, coll]);
  const mutation = useMutation({
    mutationFn: () =>
      api('PATCH', `${dbPath(conn!, db)}/collections/${enc(coll)}`, {name}),
    onSuccess: async () => {
      toast.success(`Collection renommée en « ${name} »`);
      await client.invalidateQueries({queryKey: keys.collections(conn!, db)});
      onOpenChange(false);
      void navigate(collUrl(db, name));
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const error = collectionNameError(name);
  const valid = Boolean(name) && name !== coll && !error;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Renommer la collection"
      subtitle="Nécessite le privilège renameCollection sur le serveur. Les vues ne peuvent pas être renommées."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Renommer
          </Button>
        </>
      }
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (valid) {
            mutation.mutate();
          }
        }}
      >
        <Field label="Nouveau nom" htmlFor="rename" error={error}>
          <Input
            id="rename"
            autoFocus
            value={name}
            onChange={event => setName(event.target.value.trim())}
            spellCheck={false}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function DropCollectionDialog({
  db,
  coll,
  open,
  onOpenChange,
}: {
  db: string;
  coll: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (confirm: string) =>
      api('DELETE', `${dbPath(conn!, db)}/collections/${enc(coll)}`, {confirm}),
    onSuccess: async () => {
      toast.success(`Collection « ${coll} » supprimée`);
      onOpenChange(false);
      void navigate(`/db/${encodeURIComponent(db)}`);
      await client.invalidateQueries({queryKey: keys.collections(conn!, db)});
      await client.invalidateQueries({queryKey: keys.databases(conn!)});
    },
    onError: error => toast.error(errorMessage(error)),
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Supprimer la collection"
      confirmLabel="Supprimer définitivement"
      requireText={coll}
      loading={mutation.isPending}
      onConfirm={typed => mutation.mutate(typed)}
    >
      <p>
        La collection{' '}
        <strong className="font-mono">
          {db}.{coll}
        </strong>
        , tous ses documents et ses index seront supprimés.
      </p>
      <p className="text-muted">Cette action est irréversible.</p>
    </ConfirmDialog>
  );
}

export function DropDatabaseDialog({
  db,
  open,
  onOpenChange,
}: {
  db: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (confirm: string) =>
      api('DELETE', dbPath(conn!, db), {confirm}),
    onSuccess: async () => {
      toast.success(`Base « ${db} » supprimée`);
      onOpenChange(false);
      void navigate('/');
      await client.invalidateQueries({queryKey: keys.databases(conn!)});
    },
    onError: error => toast.error(errorMessage(error)),
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Supprimer la base de données"
      confirmLabel="Supprimer la base"
      requireText={db}
      loading={mutation.isPending}
      onConfirm={typed => mutation.mutate(typed)}
    >
      <p>
        La base <strong className="font-mono">{db}</strong> et toutes ses
        collections seront supprimées.
      </p>
      <p className="text-muted">Cette action est irréversible.</p>
    </ConfirmDialog>
  );
}
