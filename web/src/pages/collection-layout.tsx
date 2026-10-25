import {
  ArrowLeftRight,
  BarChart3,
  Eye,
  FileSearch,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Table2,
  TerminalSquare,
  Timer,
  Trash2,
} from 'lucide-react';
import {useState} from 'react';
import {NavLink, Outlet, useParams} from 'react-router';
import {
  DropCollectionDialog,
  RenameCollectionDialog,
} from '../components/database-dialogs';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Menu, MenuItem} from '../components/ui/dropdown';
import {useAuth} from '../lib/auth';
import {cn} from '../lib/cn';
import {useConnection} from '../lib/connection';
import {formatBytes, formatNumber} from '../lib/format';
import {type CollectionInfo, useCollections} from '../lib/queries';
import {collUrl} from '../lib/selection';

export interface CollectionContext {
  info: CollectionInfo | undefined;
}

const TABS = [
  {tab: '', label: 'Documents', icon: <FileSearch />},
  {tab: 'query', label: 'Requêtes', icon: <TerminalSquare />},
  {tab: 'indexes', label: 'Index', icon: <KeyRound />},
  {tab: 'transfer', label: 'Import / Export', icon: <ArrowLeftRight />},
  {tab: 'stats', label: 'Statistiques', icon: <BarChart3 />},
];

export function CollectionLayout() {
  const {db = '', coll = ''} = useParams();
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const collections = useCollections(conn, db);
  const info = collections.data?.find(item => item.name === coll);
  const [renaming, setRenaming] = useState(false);
  const [dropping, setDropping] = useState(false);
  const Icon =
    info?.type === 'view' ? Eye : info?.type === 'timeseries' ? Timer : Table2;

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col">
      <div className="border-b border-line px-3 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded border border-line bg-panel text-muted">
              <Icon className="size-4.5" />
            </div>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 font-mono text-base font-semibold">
                <span className="truncate">
                  <span className="text-muted">{db}.</span>
                  {coll}
                </span>
                {info?.type === 'view' ? (
                  <Badge tone="info">vue · lecture seule</Badge>
                ) : null}
                {info?.type === 'timeseries' ? (
                  <Badge>time series</Badge>
                ) : null}
                {info?.capped ? <Badge tone="warn">capped</Badge> : null}
              </h1>
              <p className="mt-0.5 text-xs text-muted">
                {info?.stats ? (
                  <>
                    {formatNumber(info.stats.count)} documents ·{' '}
                    {formatBytes(info.stats.size)} ·{' '}
                    {formatNumber(info.stats.nindexes)} index
                  </>
                ) : info?.type === 'view' ? (
                  `Vue définie sur ${info.viewOn ?? '—'}`
                ) : collections.isLoading ? (
                  'Chargement…'
                ) : (
                  'Statistiques indisponibles'
                )}
              </p>
            </div>
          </div>
          {isAdmin ? (
            <Menu
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Actions sur la collection"
                >
                  <MoreHorizontal />
                </Button>
              }
            >
              <MenuItem
                icon={<Pencil />}
                onSelect={() => setRenaming(true)}
                disabled={info?.type === 'view'}
              >
                Renommer
              </MenuItem>
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={() => setDropping(true)}
              >
                Supprimer la collection
              </MenuItem>
            </Menu>
          ) : null}
        </div>
        <nav
          aria-label="Outils de la collection"
          className="-mb-px mt-3 flex gap-1 overflow-x-auto"
        >
          {TABS.map(item => (
            <NavLink
              key={item.tab}
              to={collUrl(db, coll, item.tab)}
              end
              className={({isActive}) =>
                cn(
                  'flex h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors [&_svg]:size-4',
                  isActive
                    ? 'border-primary text-text [&_svg]:text-text'
                    : 'border-transparent text-muted hover:text-text [&_svg]:text-faint',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1">
        <Outlet context={{info} satisfies CollectionContext} />
      </div>
      {renaming ? (
        <RenameCollectionDialog
          db={db}
          coll={coll}
          open
          onOpenChange={setRenaming}
        />
      ) : null}
      {dropping ? (
        <DropCollectionDialog
          db={db}
          coll={coll}
          open
          onOpenChange={setDropping}
        />
      ) : null}
    </div>
  );
}
