import {
  ArrowLeftRight,
  BarChart3,
  ChevronRight,
  Database,
  Eye,
  FileSearch,
  Folder,
  KeyRound,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Table2,
  TerminalSquare,
  Timer,
  UserCog,
} from 'lucide-react';
import {type ReactNode, useEffect, useMemo, useState} from 'react';
import {Link, NavLink} from 'react-router';
import {useAuth} from '../../lib/auth';
import {cn} from '../../lib/cn';
import {useConnection} from '../../lib/connection';
import {readPreference, writePreference} from '../../lib/history';
import {useCollections, useDatabases} from '../../lib/queries';
import {collUrl, dbUrl, useSelection} from '../../lib/selection';
import {
  CreateCollectionDialog,
  CreateDatabaseDialog,
} from '../database-dialogs';
import {Logo} from '../logo';
import {Select} from '../ui/input';
import {Spinner} from '../ui/spinner';

const ACTIVE = 'bg-hover text-text shadow-[inset_2px_0_0_var(--primary)]';

function NavItem({
  to,
  icon,
  label,
  collapsed,
  end,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({isActive}) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded px-2.5 text-[13px] font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
          collapsed && 'justify-center px-0',
          isActive ? ACTIVE : 'text-muted hover:bg-hover hover:text-text',
        )
      }
    >
      {icon}
      {collapsed ? null : <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function CollectionIcon({type}: {type: string}) {
  if (type === 'view') {
    return <Eye />;
  }
  if (type === 'timeseries') {
    return <Timer />;
  }
  return <Table2 />;
}

function DatabaseNode({
  name,
  filter,
  expanded,
  onToggle,
  onCreateCollection,
}: {
  name: string;
  filter: string;
  expanded: boolean;
  onToggle: () => void;
  onCreateCollection: () => void;
}) {
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const selection = useSelection();
  const active = selection.db === name;
  const collections = useCollections(conn, name, expanded || Boolean(filter));
  const visible = useMemo(() => {
    const items = collections.data ?? [];
    return filter
      ? items.filter(item => item.name.toLowerCase().includes(filter))
      : items;
  }, [collections.data, filter]);
  const matchesSelf = !filter || name.toLowerCase().includes(filter);
  if (!matchesSelf && filter && !visible.length) {
    return null;
  }
  const open = expanded || Boolean(filter && visible.length);
  return (
    <li>
      <div
        className={cn(
          'group flex h-8 items-center rounded pr-1 transition-colors',
          active && !selection.coll ? 'bg-hover' : 'hover:bg-hover',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Replier ${name}` : `Déplier ${name}`}
          aria-expanded={open}
          className="flex h-8 w-6 shrink-0 cursor-pointer items-center justify-center text-faint hover:text-text"
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
          />
        </button>
        <Link
          to={dbUrl(name)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 text-[13px]',
            active
              ? 'font-medium text-text'
              : 'text-muted group-hover:text-text',
          )}
        >
          <Database
            className={cn(
              'size-3.5 shrink-0',
              active ? 'text-text' : 'text-faint',
            )}
          />
          <span className="truncate">{name}</span>
        </Link>
        {isAdmin ? (
          <button
            type="button"
            onClick={onCreateCollection}
            title="Nouvelle collection"
            aria-label={`Nouvelle collection dans ${name}`}
            className="flex size-6 cursor-pointer items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 hover:bg-panel hover:text-text focus:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="mt-0.5 mb-1 ml-[18px] border-l border-line pl-1.5">
          {collections.isLoading ? (
            <li className="flex h-7 items-center gap-2 px-2 text-xs text-faint">
              <Spinner className="size-3" /> Chargement…
            </li>
          ) : collections.isError ? (
            <li className="px-2 py-1 text-xs text-danger">Accès impossible</li>
          ) : visible.length === 0 ? (
            <li className="px-2 py-1 text-xs text-faint">Aucune collection</li>
          ) : (
            visible.map(item => {
              const selected = active && selection.coll === item.name;
              return (
                <li key={item.name}>
                  <Link
                    to={collUrl(name, item.name)}
                    className={cn(
                      'flex h-7 items-center gap-2 rounded px-2 text-[13px] transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0',
                      selected
                        ? `${ACTIVE} font-medium`
                        : 'text-muted hover:bg-hover hover:text-text [&_svg]:text-faint',
                    )}
                  >
                    <CollectionIcon type={item.type} />
                    <span className="truncate">{item.name}</span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </li>
  );
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const {connections, conn, select} = useConnection();
  const {isAdmin} = useAuth();
  const selection = useSelection();
  const databases = useDatabases(conn);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string[]>(() =>
    readPreference<string[]>('expanded', []),
  );
  const [createDb, setCreateDb] = useState(false);
  const [createCollIn, setCreateCollIn] = useState<string | null>(null);

  useEffect(() => {
    if (selection.db && !expanded.includes(selection.db)) {
      const next = [...expanded, selection.db];
      setExpanded(next);
      writePreference('expanded', next);
    }
  }, [selection.db, expanded]);

  const toggle = (name: string) => {
    const next = expanded.includes(name)
      ? expanded.filter(item => item !== name)
      : [...expanded, name];
    setExpanded(next);
    writePreference('expanded', next);
  };

  const tool = (tab: string, fallback: string) =>
    selection.db && selection.coll
      ? collUrl(selection.db, selection.coll, tab)
      : fallback;

  const needle = filter.trim().toLowerCase();
  const isCollapsed = collapsed && !mobileOpen;

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-line bg-panel transition-[width,transform] duration-150 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          isCollapsed ? 'w-[60px]' : 'w-[272px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Navigation principale"
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-line',
            isCollapsed ? 'justify-center px-2' : 'justify-between px-4',
          )}
        >
          <Link
            to="/"
            onClick={onCloseMobile}
            aria-label="MyMongo — tableau de bord"
          >
            <Logo collapsed={isCollapsed} />
          </Link>
          {isCollapsed ? null : (
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hidden size-7 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-hover hover:text-text lg:flex"
              title="Réduire la barre latérale (Ctrl+B)"
              aria-label="Réduire la barre latérale"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>

        {isCollapsed ? null : (
          <div className="border-b border-line p-3">
            <label
              htmlFor="connection"
              className="mb-1.5 block text-[11px] font-medium tracking-wide text-faint uppercase"
            >
              Connexion
            </label>
            {connections.length ? (
              <Select
                id="connection"
                value={conn ?? ''}
                onChange={event => select(event.target.value)}
                title={connections
                  .find(item => item.id === conn)
                  ?.hosts.join(', ')}
              >
                {connections.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="rounded border border-dashed border-line px-3 py-2 text-xs text-faint">
                Aucune connexion configurée côté serveur.
              </p>
            )}
          </div>
        )}

        <nav
          className={cn(
            'space-y-0.5 border-b border-line p-2',
            isCollapsed && 'px-2',
          )}
          onClick={onCloseMobile}
        >
          <NavItem
            to="/"
            end
            icon={<LayoutDashboard />}
            label="Tableau de bord"
            collapsed={isCollapsed}
          />
          <NavItem
            to={tool('', '/tools/explorer')}
            end
            icon={<FileSearch />}
            label="Explorateur de données"
            collapsed={isCollapsed}
          />
          <NavItem
            to={tool('query', '/tools/query')}
            icon={<TerminalSquare />}
            label="Éditeur de requêtes"
            collapsed={isCollapsed}
          />
          <NavItem
            to={tool('indexes', '/tools/indexes')}
            icon={<KeyRound />}
            label="Index"
            collapsed={isCollapsed}
          />
          <NavItem
            to={tool('transfer', '/tools/transfer')}
            icon={<ArrowLeftRight />}
            label="Import / Export"
            collapsed={isCollapsed}
          />
          <NavItem
            to="/stats"
            icon={<BarChart3 />}
            label="Statistiques"
            collapsed={isCollapsed}
          />
          {isAdmin ? (
            <NavItem
              to="/mongo-users"
              icon={<UserCog />}
              label="Utilisateurs MongoDB"
              collapsed={isCollapsed}
            />
          ) : null}
          <NavItem
            to="/settings"
            icon={<Settings />}
            label="Paramètres"
            collapsed={isCollapsed}
          />
        </nav>

        {isCollapsed ? (
          <div className="mt-auto p-2">
            <button
              type="button"
              onClick={onToggleCollapsed}
              className="flex h-8 w-full cursor-pointer items-center justify-center rounded text-faint hover:bg-hover hover:text-text"
              title="Agrandir la barre latérale (Ctrl+B)"
              aria-label="Agrandir la barre latérale"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-[11px] font-medium tracking-wide text-faint uppercase">
                Bases de données
                {databases.data ? (
                  <span className="ml-1.5 text-faint/80">
                    {databases.data.length}
                  </span>
                ) : null}
              </span>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setCreateDb(true)}
                  disabled={!conn}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-md text-faint hover:bg-hover hover:text-text disabled:opacity-40"
                  title="Nouvelle base de données"
                  aria-label="Nouvelle base de données"
                >
                  <Plus className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
                <input
                  value={filter}
                  onChange={event => setFilter(event.target.value)}
                  placeholder="Filtrer bases et collections"
                  aria-label="Filtrer bases et collections"
                  className="h-7.5 w-full rounded-md border border-line bg-panel-2 pr-2 pl-8 text-xs text-text placeholder:text-faint focus:border-info focus:outline-none"
                />
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
              onClick={event => {
                if ((event.target as HTMLElement).closest('a')) {
                  onCloseMobile();
                }
              }}
            >
              {databases.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-faint">
                  <Spinner className="size-3" /> Chargement des bases…
                </div>
              ) : databases.isError ? (
                <p className="px-3 py-2 text-xs text-danger">
                  Impossible de lister les bases.
                </p>
              ) : databases.data?.length ? (
                <ul>
                  {databases.data.map(db => (
                    <DatabaseNode
                      key={db.name}
                      name={db.name}
                      filter={needle}
                      expanded={expanded.includes(db.name)}
                      onToggle={() => toggle(db.name)}
                      onCreateCollection={() => setCreateCollIn(db.name)}
                    />
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-faint">
                  <Folder className="size-5" />
                  Aucune base accessible.
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
      <CreateDatabaseDialog open={createDb} onOpenChange={setCreateDb} />
      {createCollIn ? (
        <CreateCollectionDialog
          db={createCollIn}
          open={Boolean(createCollIn)}
          onOpenChange={open => !open && setCreateCollIn(null)}
        />
      ) : null}
    </>
  );
}
