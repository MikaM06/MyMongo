import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  KeyRound,
  Moon,
  Palette,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {UserAvatar} from '../components/avatar';
import {PageContainer, PageHeader} from '../components/layout/app-shell';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Card, CardHeader} from '../components/ui/card';
import {ConfirmDialog} from '../components/ui/confirm-dialog';
import {Modal} from '../components/ui/dialog';
import {ErrorState} from '../components/ui/empty-state';
import {Field, Input, Select} from '../components/ui/input';
import {Segmented} from '../components/ui/segmented';
import {LoadingBlock} from '../components/ui/spinner';
import {api, enc, errorMessage} from '../lib/api';
import {type Avatar, type Role, useAuth} from '../lib/auth';
import {useConnection} from '../lib/connection';
import {formatDateTime, formatNumber} from '../lib/format';
import {useTheme} from '../lib/theme';

interface ManagedUser {
  username: string;
  role: Role;
  avatar: Avatar;
  createdAt: string;
  updatedAt: string;
}

interface AuditEntry {
  at: string;
  user: string;
  ip: string;
  action: string;
  outcome: 'success' | 'failure';
  connection?: string;
  database?: string;
  collection?: string;
  details?: Record<string, string | number | boolean | null>;
}

interface ServerSettings {
  version: string;
  environment: string;
  limits: {
    maxImportMb: number;
    maxExportDocs: number;
    queryTimeoutMs: number;
    maxPageSize: number;
    maxAggregateResults: number;
  };
  session: {ttlMinutes: number; idleMinutes: number; secureCookies: boolean};
}

function UserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ManagedUser | null;
}) {
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('readonly');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setUsername(user?.username ?? '');
      setPassword('');
      setRole(user?.role ?? 'readonly');
      setError(null);
    }
  }, [open, user]);
  const mutation = useMutation({
    mutationFn: () =>
      user
        ? api('PATCH', `/users/${enc(user.username)}`, {
            ...(role !== user.role ? {role} : {}),
            ...(password ? {password} : {}),
          })
        : api('POST', '/users', {username, password, role}),
    onSuccess: async () => {
      toast.success(
        user ? 'Utilisateur mis à jour' : `Utilisateur « ${username} » créé`,
      );
      await client.invalidateQueries({queryKey: ['users']});
      onOpenChange(false);
    },
    onError: caught => setError(errorMessage(caught)),
  });
  const changed = user
    ? role !== user.role || Boolean(password)
    : Boolean(username && password);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={user ? `Modifier ${user.username}` : 'Nouvel utilisateur'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!changed}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {user ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (changed) {
            mutation.mutate();
          }
        }}
      >
        {user ? null : (
          <Field
            label="Identifiant"
            htmlFor="user-name"
            hint="3 à 32 caractères : lettres, chiffres, . _ -"
          >
            <Input
              id="user-name"
              autoFocus
              value={username}
              onChange={event => setUsername(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}
        <Field
          label={user ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'}
          htmlFor="user-password"
          hint="12 caractères minimum, avec au moins trois types de caractères."
        >
          <Input
            id="user-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Rôle" htmlFor="user-role">
          <Select
            id="user-role"
            value={role}
            onChange={event => setRole(event.target.value as Role)}
          >
            <option value="readonly">
              Lecture seule — consulter, filtrer, exporter
            </option>
            <option value="admin">
              Administrateur — toutes les opérations
            </option>
          </Select>
        </Field>
        {error ? <ErrorState message={error} /> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function UsersCard() {
  const {user: me} = useAuth();
  const client = useQueryClient();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{users: ManagedUser[]}>('GET', '/users'),
    select: data => data.users,
  });
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (username: string) => api('DELETE', `/users/${enc(username)}`),
    onSuccess: async () => {
      toast.success('Utilisateur supprimé');
      setRemoving(null);
      await client.invalidateQueries({queryKey: ['users']});
    },
    onError: error => toast.error(errorMessage(error)),
  });
  return (
    <Card>
      <CardHeader
        icon={<Users />}
        title="Utilisateurs MyMongo"
        actions={
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <UserPlus />
            Ajouter
          </Button>
        }
      />
      {users.isLoading ? (
        <LoadingBlock />
      ) : users.isError ? (
        <div className="p-4">
          <ErrorState message={errorMessage(users.error)} />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {users.data?.map(item => (
            <li
              key={item.username}
              className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]"
            >
              <UserAvatar
                username={item.username}
                avatar={item.avatar}
                size={28}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {item.username}
                  {item.username === me?.username ? (
                    <span className="ml-1.5 text-xs text-faint">(vous)</span>
                  ) : null}
                </span>
                <span className="block text-xs text-faint">
                  Créé le {formatDateTime(item.createdAt)}
                </span>
              </span>
              {item.role === 'admin' ? (
                <Badge tone="brand">Administrateur</Badge>
              ) : (
                <Badge>Lecture seule</Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(item)}
              >
                Modifier
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={item.username === me?.username}
                onClick={() => setRemoving(item.username)}
                aria-label={`Supprimer ${item.username}`}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <UserDialog
        open={creating || Boolean(editing)}
        onOpenChange={open => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        user={editing}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={open => !open && setRemoving(null)}
        title="Supprimer l’utilisateur"
        confirmLabel="Supprimer"
        requireText={removing ?? undefined}
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      >
        <p>
          Le compte <strong>{removing}</strong> ne pourra plus se connecter. Ses
          sessions actives sont fermées immédiatement.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

function AuditCard() {
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<{entries: AuditEntry[]}>('GET', '/audit?limit=200'),
    select: data => data.entries,
  });
  return (
    <Card>
      <CardHeader
        icon={<ScrollText />}
        title="Journal d’audit"
        actions={
          <span className="text-xs text-faint">200 dernières opérations</span>
        }
      />
      {audit.isLoading ? (
        <LoadingBlock />
      ) : audit.isError ? (
        <div className="p-4">
          <ErrorState message={errorMessage(audit.error)} />
        </div>
      ) : !audit.data?.length ? (
        <p className="px-4 py-8 text-center text-[13px] text-faint">
          Aucune opération enregistrée.
        </p>
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Utilisateur</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Cible</th>
                <th className="hidden px-4 py-2 font-medium lg:table-cell">
                  Détails
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {audit.data.map((entry, index) => (
                <tr key={`${entry.at}-${index}`}>
                  <td className="px-4 py-2 whitespace-nowrap text-muted tabular-nums">
                    {formatDateTime(entry.at)}
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-medium">{entry.user}</span>
                    <span className="ml-1.5 text-xs text-faint">
                      {entry.ip}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <Badge
                      tone={entry.outcome === 'failure' ? 'danger' : 'neutral'}
                      className="font-mono"
                    >
                      {entry.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {[entry.database, entry.collection]
                      .filter(Boolean)
                      .join('.') || '—'}
                  </td>
                  <td className="hidden px-4 py-2 font-mono text-xs text-faint lg:table-cell">
                    {entry.details
                      ? Object.entries(entry.details)
                          .map(([key, value]) => `${key}=${String(value)}`)
                          .join(' ')
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const {isAdmin} = useAuth();
  const {theme, setTheme} = useTheme();
  const {connections} = useConnection();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<ServerSettings>('GET', '/settings'),
  });
  const s = settings.data;
  const rows: [string, string][] = s
    ? [
        ['Version', s.version],
        ['Environnement', s.environment],
        ['Taille max. d’import', `${s.limits.maxImportMb} Mo`],
        ['Documents max. par export', formatNumber(s.limits.maxExportDocs)],
        [
          'Délai max. d’une requête',
          `${formatNumber(s.limits.queryTimeoutMs)} ms`,
        ],
        ['Documents max. par page', formatNumber(s.limits.maxPageSize)],
        [
          'Résultats max. d’agrégation',
          formatNumber(s.limits.maxAggregateResults),
        ],
        [
          'Durée de session',
          `${s.session.ttlMinutes} min (inactivité : ${s.session.idleMinutes} min)`,
        ],
        [
          'Cookies sécurisés (HTTPS)',
          s.session.secureCookies ? 'Oui' : 'Non — à activer en production',
        ],
      ]
    : [];
  return (
    <PageContainer>
      <PageHeader
        icon={<Settings />}
        title="Paramètres"
        subtitle="Préférences, comptes et sécurité"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Palette />} title="Apparence" />
          <div className="flex items-center justify-between gap-4 p-4 text-[13px]">
            <span className="text-muted">Thème de l’interface</span>
            <Segmented
              label="Thème"
              value={theme}
              onChange={setTheme}
              options={[
                {value: 'dark', label: 'Sombre', icon: <Moon />},
                {value: 'light', label: 'Clair', icon: <Sun />},
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<Plug />}
            title="Connexions MongoDB"
            actions={
              <span className="text-xs text-faint">
                Définies côté serveur (.env)
              </span>
            }
          />
          <ul className="divide-y divide-line">
            {connections.map(item => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
              >
                <span className="font-medium">{item.label}</span>
                <span className="truncate font-mono text-xs text-muted">
                  {item.hosts.join(', ')}
                </span>
              </li>
            ))}
            {!connections.length ? (
              <li className="px-4 py-3 text-[13px] text-faint">
                Aucune connexion configurée.
              </li>
            ) : null}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            icon={<ShieldCheck />}
            title="Limites et sécurité"
            actions={
              <span className="flex items-center gap-1 text-xs text-faint">
                <KeyRound className="size-3.5" />
                Modifiables via les variables d’environnement
              </span>
            }
          />
          {settings.isLoading ? (
            <LoadingBlock />
          ) : (
            <dl className="grid gap-x-8 px-4 py-2 sm:grid-cols-2">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-4 border-b border-line py-2.5 text-[13px] last:border-0"
                >
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
        {isAdmin ? (
          <>
            <div className="lg:col-span-2">
              <UsersCard />
            </div>
            <div className="lg:col-span-2">
              <AuditCard />
            </div>
          </>
        ) : null}
      </div>
    </PageContainer>
  );
}
