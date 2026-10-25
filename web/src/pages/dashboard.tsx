import {
  Activity,
  Boxes,
  Cpu,
  Database,
  FileStack,
  HardDrive,
  Layers,
  Server,
  Unplug,
} from 'lucide-react';
import {PageContainer, PageHeader} from '../components/layout/app-shell';
import {BarList} from '../components/bar-list';
import {Badge} from '../components/ui/badge';
import {Card, CardHeader, StatCard} from '../components/ui/card';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {Skeleton} from '../components/ui/spinner';
import {errorMessage} from '../lib/api';
import {useConnection} from '../lib/connection';
import {formatBytes, formatNumber, formatUptime} from '../lib/format';
import {useOverview} from '../lib/queries';
import {dbUrl} from '../lib/selection';

function InfoRow({label, value}: {label: string; value: React.ReactNode}) {
  const missing = value === null || value === undefined || value === '';
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className={missing ? 'text-faint' : 'truncate font-medium text-text'}>
        {missing ? 'Indisponible' : value}
      </dd>
    </div>
  );
}

export function DashboardPage() {
  const {conn, current, loading} = useConnection();
  const overview = useOverview(conn);

  if (!loading && !conn) {
    return (
      <PageContainer>
        <EmptyState
          icon={<Unplug />}
          title="Aucune connexion MongoDB configurée"
        >
          Définissez <code className="font-mono">MONGODB_URI</code> dans le
          fichier <code className="font-mono">.env</code> du serveur puis
          redémarrez MyMongo.
        </EmptyState>
      </PageContainer>
    );
  }

  const data = overview.data;
  const server = data?.server;
  const totals = data?.totals;
  const sizeItems =
    data?.databases
      ?.filter(db => db.storageSize !== null || db.sizeOnDisk !== null)
      .map(db => {
        const value = db.storageSize ?? db.sizeOnDisk ?? 0;
        return {
          key: db.name,
          label: db.name,
          value,
          display: formatBytes(value),
          secondary:
            db.objects !== null
              ? `${formatNumber(db.objects)} docs`
              : undefined,
          to: dbUrl(db.name),
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 12) ?? [];
  const ops = data?.opcounters
    ? Object.entries(data.opcounters).filter(([, value]) => value !== null)
    : [];

  return (
    <PageContainer>
      <PageHeader
        icon={<Activity />}
        title="Tableau de bord"
        subtitle={
          current ? (
            <span className="font-mono text-xs">
              {current.hosts.join(', ')}
            </span>
          ) : null
        }
        actions={
          data ? (
            <span className="text-xs text-muted">
              Connecté · {data.latencyMs} ms
            </span>
          ) : overview.isError ? (
            <Badge tone="danger">Déconnecté</Badge>
          ) : null
        }
      />

      {overview.isError ? (
        <ErrorState
          message={errorMessage(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {overview.isLoading ? (
          Array.from({length: 6}, (_, index) => (
            <Skeleton key={index} className="h-[94px] rounded-md" />
          ))
        ) : data ? (
          <>
            <StatCard
              label="Version"
              icon={<Server />}
              value={server?.version}
              unavailable={!server?.version}
              sub={server?.storageEngine ?? undefined}
            />
            <StatCard
              label="Bases"
              icon={<Database />}
              value={formatNumber(totals?.databases)}
              unavailable={(totals?.databases ?? null) === null}
            />
            <StatCard
              label="Collections"
              icon={<Layers />}
              value={formatNumber(totals?.collections)}
              unavailable={(totals?.collections ?? null) === null}
              sub={totals?.partial ? 'Partiel (droits limités)' : undefined}
            />
            <StatCard
              label="Documents"
              icon={<FileStack />}
              value={formatNumber(totals?.documents)}
              unavailable={(totals?.documents ?? null) === null}
              sub={totals?.partial ? 'Partiel (droits limités)' : undefined}
            />
            <StatCard
              label="Données"
              icon={<Boxes />}
              value={formatBytes(totals?.dataSize)}
              unavailable={(totals?.dataSize ?? null) === null}
              sub={
                (totals?.indexSize ?? null) !== null
                  ? `Index : ${formatBytes(totals?.indexSize)}`
                  : undefined
              }
            />
            <StatCard
              label="Stockage"
              icon={<HardDrive />}
              value={formatBytes(totals?.storageSize)}
              unavailable={(totals?.storageSize ?? null) === null}
            />
          </>
        ) : null}
      </div>

      {data ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader icon={<HardDrive />} title="Espace occupé par base" />
            <BarList
              items={sizeItems}
              empty="Taille des bases indisponible pour ce compte."
            />
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader icon={<Cpu />} title="Serveur" />
              <dl className="divide-y divide-line px-4">
                <InfoRow label="Hôte" value={server?.host} />
                <InfoRow label="Processus" value={server?.process} />
                <InfoRow
                  label="Disponibilité"
                  value={
                    (server?.uptimeSeconds ?? null) !== null
                      ? formatUptime(server?.uptimeSeconds)
                      : null
                  }
                />
                <InfoRow
                  label="Replica set"
                  value={
                    server?.replicaSet ??
                    ((server?.isWritablePrimary ?? null) !== null
                      ? 'Autonome'
                      : null)
                  }
                />
                <InfoRow
                  label="Rôle"
                  value={
                    (server?.isWritablePrimary ?? null) === null
                      ? null
                      : server?.isWritablePrimary
                        ? 'Primaire (écriture)'
                        : 'Secondaire'
                  }
                />
                <InfoRow
                  label="Connexions"
                  value={
                    (server?.connectionsCurrent ?? null) !== null
                      ? `${formatNumber(server?.connectionsCurrent)} actives / ${formatNumber(server?.connectionsAvailable)} disponibles`
                      : null
                  }
                />
                <InfoRow
                  label="Mémoire résidente"
                  value={
                    (server?.memoryResidentMb ?? null) !== null
                      ? `${formatNumber(server?.memoryResidentMb)} Mo`
                      : null
                  }
                />
                <InfoRow
                  label="Document max."
                  value={
                    (server?.maxBsonObjectSize ?? null) !== null
                      ? formatBytes(server?.maxBsonObjectSize)
                      : null
                  }
                />
              </dl>
            </Card>
            {ops.length ? (
              <Card>
                <CardHeader
                  icon={<Activity />}
                  title="Opérations depuis le démarrage"
                />
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-b bg-line">
                  {ops.map(([key, value]) => (
                    <div key={key} className="bg-panel px-3 py-2.5">
                      <dt className="text-[11px] text-faint">{key}</dt>
                      <dd className="mt-0.5 text-sm font-semibold tabular-nums">
                        {formatNumber(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
