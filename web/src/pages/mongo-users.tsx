import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import {PageContainer, PageHeader} from '../components/layout/app-shell';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Card, CardHeader} from '../components/ui/card';
import {ConfirmDialog} from '../components/ui/confirm-dialog';
import {Modal} from '../components/ui/dialog';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {Field, Input, Select} from '../components/ui/input';
import {LoadingBlock} from '../components/ui/spinner';
import {api, enc, errorMessage} from '../lib/api';
import {useAuth} from '../lib/auth';
import {copyText} from '../lib/clipboard';
import {cn} from '../lib/cn';
import {useConnection} from '../lib/connection';
import {generatePassword, passwordProblem} from '../lib/password';
import {keys, useDatabases} from '../lib/queries';

interface RoleRef {
  role: string;
  db: string;
}

interface MongoUser {
  username: string;
  authDatabase: string;
  roles: RoleRef[];
  mechanisms: string[];
  current: boolean;
}

interface CreateResult {
  username: string;
  authDatabase: string;
  databaseCreated: boolean;
  databaseError: string | null;
}

type Access = 'own' | 'existing' | 'global' | 'custom';

const DB_ROLES = [
  {value: 'read', label: 'Lecture (read)'},
  {value: 'readWrite', label: 'Lecture / écriture (readWrite)'},
  {value: 'dbAdmin', label: 'Administration de la base (dbAdmin)'},
  {value: 'dbOwner', label: 'Tous les privilèges (dbOwner)'},
  {value: 'userAdmin', label: 'Gestion des utilisateurs (userAdmin)'},
];

const GLOBAL_ROLES = [
  {value: 'readAnyDatabase', label: 'Lecture sur toutes les bases'},
  {
    value: 'readWriteAnyDatabase',
    label: 'Lecture / écriture sur toutes les bases',
  },
  {value: 'dbAdminAnyDatabase', label: 'Administration de toutes les bases'},
  {
    value: 'userAdminAnyDatabase',
    label: 'Gestion des utilisateurs de toutes les bases',
  },
  {value: 'clusterMonitor', label: 'Supervision du serveur (clusterMonitor)'},
];

const ALL_ROLES = [...DB_ROLES, ...GLOBAL_ROLES].map(item => item.value);
const GLOBAL_SET = new Set(GLOBAL_ROLES.map(item => item.value));
const DB_NAME = /^[^/\\. "$*<>:|?]{1,63}$/;

function sanitizeDbName(name: string): string {
  return name.replace(/[/\\. "$*<>:|?]/g, '_').slice(0, 63);
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  optional,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const problem = passwordProblem(value);
  return (
    <Field
      label={label}
      htmlFor={id}
      error={problem}
      hint={
        optional
          ? 'Laisser vide pour ne pas changer.'
          : '12 caractères minimum, trois types de caractères.'
      }
    >
      <div className="flex gap-1.5">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          className="font-mono"
        />
        <Button
          onClick={() => {
            onChange(generatePassword());
            setVisible(true);
          }}
          title="Générer un mot de passe"
        >
          <RefreshCw />
          Générer
        </Button>
        <Button
          size="icon"
          onClick={() => void copyText(value, 'Mot de passe copié')}
          disabled={!value}
          aria-label="Copier le mot de passe"
        >
          <Copy />
        </Button>
      </div>
    </Field>
  );
}

function RolesEditor({
  roles,
  onChange,
  databases,
}: {
  roles: RoleRef[];
  onChange: (roles: RoleRef[]) => void;
  databases: string[];
}) {
  const options = useMemo(
    () => [...new Set([...ALL_ROLES, ...roles.map(item => item.role)])],
    [roles],
  );
  return (
    <div className="space-y-1.5">
      <datalist id="role-dbs">
        {databases.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {roles.map((item, index) => (
        <div key={index} className="flex gap-1.5">
          <Select
            value={item.role}
            aria-label={`Rôle ${index + 1}`}
            onChange={event => {
              const role = event.target.value;
              onChange(
                roles.map((current, i) =>
                  i === index
                    ? {role, db: GLOBAL_SET.has(role) ? 'admin' : current.db}
                    : current,
                ),
              );
            }}
          >
            {options.map(role => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
          <Input
            list="role-dbs"
            value={item.db}
            aria-label={`Base du rôle ${index + 1}`}
            disabled={GLOBAL_SET.has(item.role)}
            onChange={event =>
              onChange(
                roles.map((current, i) =>
                  i === index
                    ? {...current, db: event.target.value.trim()}
                    : current,
                ),
              )
            }
            className="w-44 font-mono"
            spellCheck={false}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(roles.filter((_, i) => i !== index))}
            aria-label="Retirer ce rôle"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...roles,
            {
              role: 'read',
              db:
                databases.find(
                  name => !['admin', 'local', 'config'].includes(name),
                ) ?? 'admin',
            },
          ])
        }
      >
        <Plus />
        Ajouter un rôle
      </Button>
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateResult, database: string | null) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const databases = useDatabases(conn);
  const names = useMemo(
    () => databases.data?.map(item => item.name) ?? [],
    [databases.data],
  );
  const userDbs = names.filter(
    name => !['admin', 'local', 'config'].includes(name),
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authDatabase, setAuthDatabase] = useState('admin');
  const [access, setAccess] = useState<Access>('own');
  const [ownDb, setOwnDb] = useState('');
  const [ownDbTouched, setOwnDbTouched] = useState(false);
  const [firstCollection, setFirstCollection] = useState('donnees');
  const [existingDb, setExistingDb] = useState('');
  const [existingRole, setExistingRole] = useState('readWrite');
  const [globalRole, setGlobalRole] = useState('readAnyDatabase');
  const [customRoles, setCustomRoles] = useState<RoleRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername('');
      setPassword('');
      setAuthDatabase('admin');
      setAccess('own');
      setOwnDb('');
      setOwnDbTouched(false);
      setFirstCollection('donnees');
      setExistingRole('readWrite');
      setGlobalRole('readAnyDatabase');
      setCustomRoles([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!existingDb && userDbs.length) {
      setExistingDb(userDbs[0]);
    }
  }, [existingDb, userDbs]);

  const ownDbName = ownDbTouched ? ownDb : sanitizeDbName(username);

  const roles: RoleRef[] =
    access === 'own'
      ? [{role: 'dbOwner', db: ownDbName}]
      : access === 'existing'
        ? [{role: existingRole, db: existingDb}]
        : access === 'global'
          ? [{role: globalRole, db: 'admin'}]
          : customRoles;

  const usernameError =
    username && !/^[A-Za-z0-9._@-]{1,64}$/.test(username)
      ? 'Lettres, chiffres et . _ @ - uniquement (64 max.).'
      : null;
  const ownDbError =
    access === 'own' &&
    ownDbName &&
    (!DB_NAME.test(ownDbName) ||
      ['admin', 'local', 'config'].includes(ownDbName))
      ? 'Nom de base invalide.'
      : null;
  const valid =
    Boolean(username) &&
    !usernameError &&
    Boolean(password) &&
    !passwordProblem(password) &&
    roles.length > 0 &&
    roles.every(item => item.db) &&
    !ownDbError &&
    (access !== 'own' || Boolean(ownDbName && firstCollection.trim()));

  const mutation = useMutation({
    mutationFn: () =>
      api<CreateResult>('POST', `/conn/${enc(conn!)}/mongo-users`, {
        username,
        password,
        authDatabase,
        roles,
        ...(access === 'own'
          ? {
              createDatabase: {
                name: ownDbName,
                collection: firstCollection.trim(),
              },
            }
          : {}),
      }),
    onSuccess: async result => {
      await client.invalidateQueries({queryKey: ['mongoUsers', conn]});
      if (access === 'own') {
        await client.invalidateQueries({queryKey: keys.databases(conn!)});
      }
      onCreated(result, access === 'own' ? ownDbName : (roles[0]?.db ?? null));
      onOpenChange(false);
    },
    onError: caught => setError(errorMessage(caught)),
  });

  const choices: {value: Access; title: string; text: string}[] = [
    {
      value: 'own',
      title:
        'Créer une base portant le même nom et accorder tous les privilèges',
      text: 'Nouvelle base dédiée, rôle dbOwner.',
    },
    {
      value: 'existing',
      title: 'Donner accès à une base existante',
      text: 'Lecture, écriture ou administration sur une base.',
    },
    {
      value: 'global',
      title: 'Accès global',
      text: 'Rôle sur toutes les bases (attribué sur admin).',
    },
    {
      value: 'custom',
      title: 'Rôles personnalisés',
      text: 'Composer la liste de rôles à la main.',
    },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ajouter un utilisateur MongoDB"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {access === 'own'
              ? 'Créer l’utilisateur et la base'
              : 'Créer l’utilisateur'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={event => {
          event.preventDefault();
          if (valid) {
            mutation.mutate();
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field
            label="Nom d’utilisateur"
            htmlFor="mu-name"
            error={usernameError}
          >
            <Input
              id="mu-name"
              autoFocus
              value={username}
              onChange={event => setUsername(event.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          <Field
            label="Base d’authentification"
            htmlFor="mu-auth"
            hint="admin est le choix habituel."
          >
            <Select
              id="mu-auth"
              value={authDatabase}
              onChange={event => setAuthDatabase(event.target.value)}
            >
              {['admin', ...userDbs].map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <PasswordField
          id="mu-password"
          label="Mot de passe"
          value={password}
          onChange={setPassword}
        />

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-muted">
            Base de données et privilèges
          </legend>
          {choices.map(choice => (
            <label
              key={choice.value}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2',
                access === choice.value
                  ? 'border-primary/60 bg-panel-2'
                  : 'border-line hover:bg-hover',
              )}
            >
              <input
                type="radio"
                name="access"
                checked={access === choice.value}
                onChange={() => setAccess(choice.value)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span>
                <span className="block text-[13px] text-text">
                  {choice.title}
                </span>
                <span className="block text-xs text-faint">{choice.text}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {access === 'own' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nom de la base"
              htmlFor="mu-db"
              error={ownDbError}
              hint="Par défaut, le nom de l’utilisateur."
            >
              <Input
                id="mu-db"
                value={ownDbName}
                onChange={event => {
                  setOwnDbTouched(true);
                  setOwnDb(event.target.value.trim());
                }}
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Field
              label="Première collection"
              htmlFor="mu-coll"
              hint="MongoDB crée la base avec sa première collection."
            >
              <Input
                id="mu-coll"
                value={firstCollection}
                onChange={event =>
                  setFirstCollection(event.target.value.trim())
                }
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          </div>
        ) : access === 'existing' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base" htmlFor="mu-existing">
              <Select
                id="mu-existing"
                value={existingDb}
                onChange={event => setExistingDb(event.target.value)}
              >
                {userDbs.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Privilèges" htmlFor="mu-role">
              <Select
                id="mu-role"
                value={existingRole}
                onChange={event => setExistingRole(event.target.value)}
              >
                {DB_ROLES.map(role => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : access === 'global' ? (
          <Field label="Rôle" htmlFor="mu-global">
            <Select
              id="mu-global"
              value={globalRole}
              onChange={event => setGlobalRole(event.target.value)}
            >
              {GLOBAL_ROLES.map(role => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <RolesEditor
            roles={customRoles}
            onChange={setCustomRoles}
            databases={names}
          />
        )}
        {error ? <ErrorState message={error} /> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function EditUserDialog({
  user,
  onOpenChange,
}: {
  user: MongoUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const {conn} = useConnection();
  const client = useQueryClient();
  const databases = useDatabases(conn);
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<RoleRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      setPassword('');
      setRoles(user.roles);
      setError(null);
    }
  }, [user]);
  const rolesChanged = user
    ? JSON.stringify(roles) !== JSON.stringify(user.roles)
    : false;
  const mutation = useMutation({
    mutationFn: () =>
      api(
        'PATCH',
        `/conn/${enc(conn!)}/mongo-users/${enc(user!.authDatabase)}/${enc(user!.username)}`,
        {
          ...(password ? {password} : {}),
          ...(rolesChanged ? {roles} : {}),
        },
      ),
    onSuccess: async () => {
      toast.success('Utilisateur MongoDB mis à jour');
      await client.invalidateQueries({queryKey: ['mongoUsers', conn]});
      onOpenChange(false);
    },
    onError: caught => setError(errorMessage(caught)),
  });
  const valid =
    (Boolean(password) && !passwordProblem(password)) ||
    (rolesChanged && roles.every(item => item.db));
  return (
    <Modal
      open={Boolean(user)}
      onOpenChange={onOpenChange}
      title={user ? `Modifier ${user.username}` : ''}
      subtitle={
        user ? (
          <span className="font-mono text-xs">
            Base d’authentification : {user.authDatabase}
          </span>
        ) : null
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <PasswordField
          id="mu-edit-password"
          label="Nouveau mot de passe"
          value={password}
          onChange={setPassword}
          optional
        />
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted">Rôles</span>
          {user?.current ? (
            <p className="rounded border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
              MyMongo est connecté avec ce compte : ses rôles se modifient
              depuis mongosh pour éviter de perdre l’accès.
            </p>
          ) : (
            <RolesEditor
              roles={roles}
              onChange={setRoles}
              databases={databases.data?.map(item => item.name) ?? []}
            />
          )}
        </div>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}

function CreatedDialog({
  result,
  database,
  onClose,
}: {
  result: CreateResult | null;
  database: string | null;
  onClose: () => void;
}) {
  const {current} = useConnection();
  const hosts = current?.hosts.join(',') ?? 'hote:27017';
  const uri = result
    ? `mongodb://${encodeURIComponent(result.username)}:<mot_de_passe>@${hosts}/${database ?? ''}?authSource=${result.authDatabase}`
    : '';
  return (
    <Modal
      open={Boolean(result)}
      onOpenChange={open => !open && onClose()}
      title="Utilisateur créé"
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          Terminé
        </Button>
      }
    >
      <div className="space-y-4 text-[13px]">
        <p>
          L’utilisateur{' '}
          <strong className="font-mono">{result?.username}</strong> a été créé
          {result?.databaseCreated ? (
            <>
              {' '}
              avec la base <strong className="font-mono">{database}</strong>
            </>
          ) : null}
          .
        </p>
        {result?.databaseError ? (
          <ErrorState
            message={`La base n’a pas pu être créée : ${result.databaseError}`}
          />
        ) : null}
        <Field
          label="Chaîne de connexion pour vos applications"
          hint="Remplacez <mot_de_passe> par le mot de passe choisi."
        >
          <div className="flex gap-1.5">
            <Input readOnly value={uri} className="font-mono text-xs" />
            <Button
              size="icon"
              onClick={() => void copyText(uri, 'Chaîne copiée')}
              aria-label="Copier la chaîne de connexion"
            >
              <Copy />
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export function MongoUsersPage() {
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MongoUser | null>(null);
  const [dropping, setDropping] = useState<MongoUser | null>(null);
  const [created, setCreated] = useState<{
    result: CreateResult;
    database: string | null;
  } | null>(null);
  const users = useQuery({
    queryKey: ['mongoUsers', conn],
    queryFn: () =>
      api<{users: MongoUser[]}>('GET', `/conn/${enc(conn!)}/mongo-users`),
    enabled: Boolean(conn) && isAdmin,
    select: data => data.users,
  });
  const drop = useMutation({
    mutationFn: (user: MongoUser) =>
      api(
        'DELETE',
        `/conn/${enc(conn!)}/mongo-users/${enc(user.authDatabase)}/${enc(user.username)}`,
        {confirm: user.username},
      ),
    onSuccess: async () => {
      toast.success('Utilisateur supprimé');
      setDropping(null);
      await client.invalidateQueries({queryKey: ['mongoUsers', conn]});
    },
    onError: error => toast.error(errorMessage(error)),
  });

  if (!isAdmin) {
    return (
      <PageContainer>
        <EmptyState icon={<UserCog />} title="Réservé aux administrateurs">
          La gestion des utilisateurs MongoDB nécessite le rôle administrateur
          dans MyMongo.
        </EmptyState>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={<UserCog />}
        title="Utilisateurs MongoDB"
        subtitle="Comptes du serveur MongoDB, à utiliser dans vos applications"
        actions={
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            disabled={!conn}
          >
            <Plus />
            Ajouter un utilisateur
          </Button>
        }
      />
      <Card>
        <CardHeader
          icon={<KeyRound />}
          title={`Comptes${users.data ? ` (${users.data.length})` : ''}`}
        />
        {users.isLoading ? (
          <LoadingBlock />
        ) : users.isError ? (
          <div className="p-3">
            <ErrorState
              message={`${errorMessage(users.error)}\nLe compte utilisé par MyMongo doit avoir le rôle userAdminAnyDatabase (ou userAdmin sur les bases concernées).`}
              onRetry={() => void users.refetch()}
            />
          </div>
        ) : !users.data?.length ? (
          <EmptyState
            icon={<UserCog />}
            title="Aucun utilisateur MongoDB"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Ajouter un utilisateur
              </Button>
            }
          >
            Sans utilisateur, le serveur fonctionne probablement sans
            authentification : activez-la avant une mise en production.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line bg-panel-2 text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Utilisateur</th>
                  <th className="px-3 py-2 font-medium">Authentification</th>
                  <th className="px-3 py-2 font-medium">Rôles</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">
                    Mécanismes
                  </th>
                  <th className="w-24" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.data.map(user => (
                  <tr
                    key={`${user.authDatabase}.${user.username}`}
                    className="hover:bg-hover/60"
                  >
                    <td className="px-3 py-2 font-mono text-[12.5px]">
                      {user.username}
                      {user.current ? (
                        <Badge className="ml-2 font-sans">
                          utilisé par MyMongo
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">
                      {user.authDatabase}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.length ? (
                          user.roles.map(role => (
                            <span
                              key={`${role.role}@${role.db}`}
                              className="inline-flex items-center rounded-sm border border-line bg-panel-2 px-1.5 py-px font-mono text-[11.5px]"
                            >
                              {role.role}
                              <span className="text-faint">@{role.db}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-faint">aucun rôle</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-3 py-2 font-mono text-xs text-faint md:table-cell">
                      {user.mechanisms.join(', ')}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(user)}
                      >
                        Modifier
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={user.current}
                        onClick={() => setDropping(user)}
                        aria-label={`Supprimer ${user.username}`}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(result, database) => setCreated({result, database})}
      />
      <EditUserDialog
        user={editing}
        onOpenChange={open => !open && setEditing(null)}
      />
      <CreatedDialog
        result={created?.result ?? null}
        database={created?.database ?? null}
        onClose={() => setCreated(null)}
      />
      <ConfirmDialog
        open={Boolean(dropping)}
        onOpenChange={open => !open && setDropping(null)}
        title="Supprimer l’utilisateur MongoDB"
        confirmLabel="Supprimer"
        requireText={dropping?.username}
        loading={drop.isPending}
        onConfirm={() => dropping && drop.mutate(dropping)}
      >
        <p>
          Les applications qui utilisent{' '}
          <strong className="font-mono">{dropping?.username}</strong> ne
          pourront plus se connecter. Les données ne sont pas supprimées.
        </p>
      </ConfirmDialog>
    </PageContainer>
  );
}
