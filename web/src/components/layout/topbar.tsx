import {useIsFetching, useQueryClient} from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Menu as MenuIcon,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import {Fragment, useState} from 'react';
import {Link} from 'react-router';
import {toast} from 'sonner';
import {api, errorMessage} from '../../lib/api';
import {useAuth} from '../../lib/auth';
import {cn} from '../../lib/cn';
import {useConnection} from '../../lib/connection';
import {useStatus} from '../../lib/queries';
import {collUrl, dbUrl, useSelection} from '../../lib/selection';
import {useTheme} from '../../lib/theme';
import {UserAvatar} from '../avatar';
import {AvatarDialog} from '../avatar-dialog';
import {Kbd} from '../ui/badge';
import {Button} from '../ui/button';
import {Modal} from '../ui/dialog';
import {Menu, MenuItem, MenuSeparator} from '../ui/dropdown';
import {Field, Input} from '../ui/input';

const TAB_LABELS: Record<string, string> = {
  query: 'Requêtes',
  indexes: 'Index',
  transfer: 'Import / Export',
  stats: 'Statistiques',
};

export const SHORTCUTS: [string[], string][] = [
  [['Ctrl', 'B'], 'Réduire / agrandir la barre latérale'],
  [['/'], 'Rechercher dans les documents'],
  [['Ctrl', 'Entrée'], 'Exécuter le filtre ou la requête'],
  [['N'], 'Nouveau document (explorateur)'],
  [['R'], 'Actualiser les données'],
  [['Échap'], 'Fermer un panneau ou une fenêtre'],
  [['?'], 'Afficher les raccourcis'],
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Raccourcis clavier"
      size="sm"
    >
      <ul className="divide-y divide-line">
        {SHORTCUTS.map(([combo, label]) => (
          <li
            key={label}
            className="flex items-center justify-between py-2.5 text-[13px]"
          >
            <span className="text-muted">{label}</span>
            <span className="flex gap-1">
              {combo.map(key => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const mismatch =
    confirm && next !== confirm ? 'Les mots de passe diffèrent.' : null;
  const submit = async () => {
    setSaving(true);
    try {
      await api('POST', '/auth/password', {
        currentPassword: current,
        newPassword: next,
      });
      toast.success(
        'Mot de passe mis à jour. Vos autres sessions ont été fermées.',
      );
      setCurrent('');
      setNext('');
      setConfirm('');
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Changer mon mot de passe"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!current || !next || next !== confirm}
            onClick={submit}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (current && next && next === confirm) {
            void submit();
          }
        }}
      >
        <Field label="Mot de passe actuel" htmlFor="pw-current">
          <Input
            id="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={event => setCurrent(event.target.value)}
          />
        </Field>
        <Field
          label="Nouveau mot de passe"
          htmlFor="pw-next"
          hint="12 caractères minimum, avec au moins trois types de caractères."
        >
          <Input
            id="pw-next"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={event => setNext(event.target.value)}
          />
        </Field>
        <Field label="Confirmation" htmlFor="pw-confirm" error={mismatch}>
          <Input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={event => setConfirm(event.target.value)}
          />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Topbar({
  onOpenMobile,
  onShowShortcuts,
}: {
  onOpenMobile: () => void;
  onShowShortcuts: () => void;
}) {
  const {user, logout} = useAuth();
  const {current, conn} = useConnection();
  const {theme, toggle} = useTheme();
  const selection = useSelection();
  const status = useStatus(conn);
  const client = useQueryClient();
  const fetching = useIsFetching() > 0;
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const crumbs: {label: string; to?: string; mono?: boolean}[] = [
    {label: current?.label ?? 'MyMongo', to: '/'},
  ];
  if (selection.db) {
    crumbs.push({label: selection.db, to: dbUrl(selection.db), mono: true});
  }
  if (selection.db && selection.coll) {
    crumbs.push({
      label: selection.coll,
      to: collUrl(selection.db, selection.coll),
      mono: true,
    });
  }
  if (selection.tab && TAB_LABELS[selection.tab]) {
    crumbs.push({label: TAB_LABELS[selection.tab]});
  }

  const connected = status.data?.connected;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 sm:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobile}
        aria-label="Ouvrir la navigation"
      >
        <MenuIcon />
      </Button>
      <nav aria-label="Fil d’Ariane" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-[13px]">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 ? (
                  <ChevronRight className="size-3.5 shrink-0 text-faint" />
                ) : null}
                <li
                  className={cn(
                    'min-w-0',
                    index < crumbs.length - 2 && 'hidden sm:block',
                  )}
                >
                  {crumb.to && !last ? (
                    <Link
                      to={crumb.to}
                      className={cn(
                        'block truncate rounded px-1 text-muted hover:text-text',
                        crumb.mono && 'font-mono text-[12.5px]',
                      )}
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current="page"
                      className={cn(
                        'block truncate px-1 font-semibold text-text',
                        crumb.mono && 'font-mono text-[12.5px]',
                      )}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center gap-1.5">
        {conn ? (
          <span
            className="hidden items-center gap-1.5 px-1 text-xs text-muted sm:inline-flex"
            title={status.data?.message ?? current?.hosts.join(', ')}
            role="status"
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                status.isLoading
                  ? 'bg-faint'
                  : connected
                    ? 'bg-brand-ink'
                    : 'bg-danger ',
              )}
            />
            {status.isLoading
              ? 'Vérification…'
              : connected
                ? `Connecté · ${status.data?.latencyMs ?? '—'} ms`
                : 'Déconnecté'}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void client.invalidateQueries()}
          title="Actualiser (R)"
          aria-label="Actualiser les données"
        >
          <RefreshCw className={cn(fetching && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          aria-label="Changer de thème"
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        <Menu
          trigger={
            <button
              type="button"
              className="ml-1 flex h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-[13px] text-muted hover:bg-hover hover:text-text"
              aria-label="Menu utilisateur"
            >
              {user ? (
                <UserAvatar
                  username={user.username}
                  avatar={user.avatar}
                  size={24}
                />
              ) : null}
              <span className="hidden max-w-32 truncate md:inline">
                {user?.username}
              </span>
              <ChevronDown className="size-3.5" />
            </button>
          }
        >
          <div className="flex items-center gap-2.5 px-2.5 py-1.5">
            {user ? (
              <UserAvatar
                username={user.username}
                avatar={user.avatar}
                size={36}
              />
            ) : null}
            <p className="text-xs text-muted">
              <span className="font-medium text-text">{user?.username}</span>
              <br />
              {user?.role === 'admin' ? 'Administrateur' : 'Lecture seule'}
            </p>
          </div>
          <MenuSeparator />
          <MenuItem onSelect={() => setAvatarOpen(true)}>
            Changer ma photo de profil
          </MenuItem>
          <MenuItem onSelect={() => setPasswordOpen(true)}>
            Changer mon mot de passe
          </MenuItem>
          <MenuItem onSelect={onShowShortcuts}>Raccourcis clavier</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => void logout()}>Se déconnecter</MenuItem>
        </Menu>
      </div>
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
      <AvatarDialog open={avatarOpen} onOpenChange={setAvatarOpen} />
    </header>
  );
}
