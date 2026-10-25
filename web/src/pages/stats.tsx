import {
  BarChart3,
  Database,
  FileStack,
  HardDrive,
  KeyRound,
} from 'lucide-react';
import {Link} from 'react-router';
import {BarList} from '../components/bar-list';
import {PageContainer, PageHeader} from '../components/layout/app-shell';
import {Badge} from '../components/ui/badge';
import {Card, CardHeader, StatCard} from '../components/ui/card';
import {ErrorState} from '../components/ui/empty-state';
import {LoadingBlock} from '../components/ui/spinner';
import {errorMessage} from '../lib/api';
import {useConnection} from '../lib/connection';
import {formatBytes, formatNumber} from '../lib/format';
import {type DatabaseStats, useOverview} from '../lib/queries';
import {dbUrl} from '../lib/selection';

function bars(
  items: DatabaseStats[],
  pick: (item: DatabaseStats) => number | null,
  format: (value: number) => string,
) {
  return items
    .map(item => ({item, value: pick(item)}))
    .filter(
      (entry): entry is {item: DatabaseStats; value: number} =>
        entry.value !== null,
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 15)
    .map(({item, value}) => ({
      key: item.name,
      label: item.name,
      value,
      display: format(value),
      to: dbUrl(item.name),
    }));
}

export function StatsPage() {
  const {conn} = useConnection();
  const overview = useOverview(conn);
  const data = overview.data;
  const databases = data?.databases ?? [];
  const totals = data?.totals;
  const unknown = (value: number | null | undefined) =>
    (value ?? null) === null;

  return (
    <PageContainer>
      <PageHeader
        icon={<BarChart3 />}
        title="Statistiques"
        subtitle="Mesures fournies par dbStats pour chaque base accessible"
        actions={
          totals?.partial ? (
            <Badge tone="warn">Données partielles : droits limités</Badge>
          ) : null
        }
      />
      {overview.isLoading ? (
        <LoadingBlock />
      ) : overview.isError ? (
        <ErrorState
          message={errorMessage(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Documents"
              icon={<FileStack />}
              value={formatNumber(totals?.documents)}
              unavailable={unknown(totals?.documents)}
            />
            <StatCard
              label="Données"
              icon={<Database />}
              value={formatBytes(totals?.dataSize)}
              unavailable={unknown(totals?.dataSize)}
            />
            <StatCard
              label="Stockage"
              icon={<HardDrive />}
              value={formatBytes(totals?.storageSize)}
              unavailable={unknown(totals?.storageSize)}
            />
            <StatCard
              label="Index"
              icon={<KeyRound />}
              value={formatBytes(totals?.indexSize)}
              unavailable={unknown(totals?.indexSize)}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader icon={<FileStack />} title="Documents par base" />
              <BarList
                items={bars(databases, item => item.objects, formatNumber)}
                empty="Indisponible pour ce compte."
              />
            </Card>
            <Card>
              <CardHeader
                icon={<KeyRound />}
                title="Taille des index par base"
              />
              <BarList
                items={bars(databases, item => item.indexSize, formatBytes)}
                empty="Indisponible pour ce compte."
              />
            </Card>
          </div>
          <Card>
            <CardHeader icon={<Database />} title="Détail par base" />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-4 py-2.5 font-medium">Base</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Collections
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Documents
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Données
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Stockage
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Index
                    </th>
                    <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">
                      Ratio de compression
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {databases.map(item => (
                    <tr key={item.name} className="hover:bg-hover/50">
                      <td className="px-4 py-2 font-mono text-[12.5px]">
                        <Link
                          to={dbUrl(item.name)}
                          className="hover:text-brand-ink"
                        >
                          {item.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatNumber(item.collections)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatNumber(item.objects)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatBytes(item.dataSize)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted tabular-nums">
                        {formatBytes(item.storageSize)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted tabular-nums">
                        {formatBytes(item.indexSize)}
                      </td>
                      <td className="hidden px-4 py-2 text-right text-muted tabular-nums md:table-cell">
                        {item.dataSize && item.storageSize
                          ? `× ${(item.dataSize / item.storageSize).toFixed(2)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
