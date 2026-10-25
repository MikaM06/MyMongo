import {useQuery} from '@tanstack/react-query';
import {
  Database,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Table2,
  Timer,
  Trash2,
} from 'lucide-react';
import {useState} from 'react';
import {Link, useParams} from 'react-router';
import {PageContainer, PageHeader} from '../components/layout/app-shell';
import {
  CreateCollectionDialog,
  DropCollectionDialog,
  DropDatabaseDialog,
  RenameCollectionDialog,
} from '../components/database-dialogs';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Card, StatCard} from '../components/ui/card';
import {Menu, MenuItem} from '../components/ui/dropdown';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {LoadingBlock} from '../components/ui/spinner';
import {api, dbPath, errorMessage} from '../lib/api';
import {useAuth} from '../lib/auth';
import {useConnection} from '../lib/connection';
import {formatBytes, formatNumber} from '../lib/format';
import {useCollections} from '../lib/queries';
import {collUrl} from '../lib/selection';

const SYSTEM = new Set(['admin', 'local', 'config']);

interface DbStats {
  collections: number | null;
  views: number | null;
  objects: number | null;
  avgObjSize: number | null;
  dataSize: number | null;
  storageSize: number | null;
  indexes: number | null;
  indexSize: number | null;
}

function TypeIcon({type}: {type: string}) {
  if (type === 'view') {
    return <Eye className="size-4 text-info" />;
  }
  if (type === 'timeseries') {
    return <Timer className="size-4 text-t-date" />;
  }
  return <Table2 className="size-4 text-faint" />;
}

export function DatabasePage() {
  const {db = ''} = useParams();
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const collections = useCollections(conn, db);
  const stats = useQuery({
    queryKey: ['dbStats', conn, db],
    queryFn: () =>
      api<{stats: DbStats | null}>('GET', `${dbPath(conn!, db)}/stats`),
    enabled: Boolean(conn),
    select: data => data.stats,
  });
  const [creating, setCreating] = useState(false);
  const [dropDb, setDropDb] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropping, setDropping] = useState<string | null>(null);
  const system = SYSTEM.has(db);
  const s = stats.data;
  const missing = (value: number | null | undefined) =>
    !stats.isLoading && (value ?? null) === null;

  return (
    <PageContainer>
      <PageHeader
        icon={<Database />}
        title={<span className="font-mono">{db}</span>}
        subtitle={
          system ? (
            <Badge tone="warn">Base système — modifiez-la avec prudence</Badge>
          ) : (
            'Collections, vues et statistiques de la base'
          )
        }
        actions={
          isAdmin ? (
            <>
              {!system ? (
                <Button variant="ghost" onClick={() => setDropDb(true)}>
                  <Trash2 />
                  Supprimer la base
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Nouvelle collection
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Collections"
          value={formatNumber(s?.collections)}
          unavailable={missing(s?.collections)}
          sub={s?.views ? `${formatNumber(s.views)} vue(s)` : undefined}
        />
        <StatCard
          label="Documents"
          value={formatNumber(s?.objects)}
          unavailable={missing(s?.objects)}
          sub={
            s?.avgObjSize ? `≈ ${formatBytes(s.avgObjSize)} / doc` : undefined
          }
        />
        <StatCard
          label="Données"
          value={formatBytes(s?.dataSize)}
          unavailable={missing(s?.dataSize)}
          sub={
            s?.storageSize
              ? `Stockage : ${formatBytes(s.storageSize)}`
              : undefined
          }
        />
        <StatCard
          label="Index"
          value={formatNumber(s?.indexes)}
          unavailable={missing(s?.indexes)}
          sub={s?.indexSize ? formatBytes(s.indexSize) : undefined}
        />
      </div>

      <Card>
        {collections.isLoading ? (
          <LoadingBlock label="Chargement des collections…" />
        ) : collections.isError ? (
          <div className="p-4">
            <ErrorState
              message={errorMessage(collections.error)}
              onRetry={() => void collections.refetch()}
            />
          </div>
        ) : !collections.data?.length ? (
          <EmptyState
            icon={<Table2 />}
            title="Cette base ne contient aucune collection"
            action={
              isAdmin ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus />
                  Créer une collection
                </Button>
              ) : null
            }
          >
            Une base MongoDB sans collection disparaît automatiquement.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Nom</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Documents
                  </th>
                  <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">
                    Taille moy.
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Données
                  </th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
                    Stockage
                  </th>
                  <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">
                    Index
                  </th>
                  <th className="w-12 px-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {collections.data.map(item => (
                  <tr key={item.name} className="group hover:bg-hover/60">
                    <td className="px-4 py-2">
                      <Link
                        to={collUrl(db, item.name)}
                        className="flex items-center gap-2.5 font-mono text-[12.5px] font-medium text-text hover:text-brand-ink"
                      >
                        <TypeIcon type={item.type} />
                        {item.name}
                        {item.type === 'view' ? (
                          <Badge tone="info">
                            vue{item.viewOn ? ` · ${item.viewOn}` : ''}
                          </Badge>
                        ) : null}
                        {item.type === 'timeseries' ? (
                          <Badge>time series</Badge>
                        ) : null}
                        {item.capped ? <Badge tone="warn">capped</Badge> : null}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(item.stats?.count)}
                    </td>
                    <td className="hidden px-4 py-2 text-right text-muted tabular-nums md:table-cell">
                      {formatBytes(item.stats?.avgObjSize)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatBytes(item.stats?.size)}
                    </td>
                    <td className="hidden px-4 py-2 text-right text-muted tabular-nums sm:table-cell">
                      {formatBytes(item.stats?.storageSize)}
                    </td>
                    <td className="hidden px-4 py-2 text-right text-muted tabular-nums lg:table-cell">
                      {typeof item.stats?.nindexes === 'number'
                        ? `${item.stats.nindexes} · ${formatBytes(item.stats.totalIndexSize)}`
                        : '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {isAdmin ? (
                        <Menu
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions pour ${item.name}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          }
                        >
                          <MenuItem
                            icon={<Pencil />}
                            onSelect={() => setRenaming(item.name)}
                            disabled={item.type === 'view'}
                          >
                            Renommer
                          </MenuItem>
                          <MenuItem
                            icon={<Trash2 />}
                            danger
                            onSelect={() => setDropping(item.name)}
                          >
                            Supprimer
                          </MenuItem>
                        </Menu>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateCollectionDialog
        db={db}
        open={creating}
        onOpenChange={setCreating}
      />
      <DropDatabaseDialog db={db} open={dropDb} onOpenChange={setDropDb} />
      {renaming ? (
        <RenameCollectionDialog
          db={db}
          coll={renaming}
          open
          onOpenChange={open => !open && setRenaming(null)}
        />
      ) : null}
      {dropping ? (
        <DropCollectionDialog
          db={db}
          coll={dropping}
          open
          onOpenChange={open => !open && setDropping(null)}
        />
      ) : null}
    </PageContainer>
  );
}
