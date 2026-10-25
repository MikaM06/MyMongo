import {useQuery} from '@tanstack/react-query';
import {BarChart3, ListTree} from 'lucide-react';
import {useParams} from 'react-router';
import {Badge} from '../components/ui/badge';
import {Card, CardHeader, StatCard} from '../components/ui/card';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {LoadingBlock} from '../components/ui/spinner';
import {api, collPath, errorMessage} from '../lib/api';
import {useConnection} from '../lib/connection';
import {formatBytes, formatNumber} from '../lib/format';
import {type CollectionStats, keys, useSchema} from '../lib/queries';

export function CollectionStatsPage() {
  const {db = '', coll = ''} = useParams();
  const {conn} = useConnection();
  const stats = useQuery({
    queryKey: keys.collStats(conn!, db, coll),
    queryFn: () =>
      api<{stats: CollectionStats | null}>(
        'GET',
        `${collPath(conn!, db, coll)}/stats`,
      ),
    select: data => data.stats,
  });
  const schema = useSchema(conn!, db, coll);
  const s = stats.data;
  const missing = (value: number | null | undefined) =>
    !stats.isLoading && (value ?? null) === null;

  return (
    <div className="space-y-4 p-3 sm:p-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Documents"
          value={formatNumber(s?.count)}
          unavailable={missing(s?.count)}
        />
        <StatCard
          label="Taille des données"
          value={formatBytes(s?.size)}
          unavailable={missing(s?.size)}
        />
        <StatCard
          label="Taille moyenne"
          value={formatBytes(s?.avgObjSize)}
          unavailable={missing(s?.avgObjSize)}
        />
        <StatCard
          label="Stockage"
          value={formatBytes(s?.storageSize)}
          unavailable={missing(s?.storageSize)}
          sub="Compressé sur disque"
        />
        <StatCard
          label="Index"
          value={formatNumber(s?.nindexes)}
          unavailable={missing(s?.nindexes)}
        />
        <StatCard
          label="Taille des index"
          value={formatBytes(s?.totalIndexSize)}
          unavailable={missing(s?.totalIndexSize)}
        />
      </div>
      {stats.isError ? (
        <ErrorState message={errorMessage(stats.error)} />
      ) : null}

      <Card>
        <CardHeader
          icon={<ListTree />}
          title="Structure des documents"
          actions={
            schema.data ? (
              <Badge>
                Échantillon de {formatNumber(schema.data.sampleSize)}{' '}
                document(s)
              </Badge>
            ) : null
          }
        />
        {schema.isLoading ? (
          <LoadingBlock label="Analyse d’un échantillon…" />
        ) : schema.isError ? (
          <div className="p-4">
            <ErrorState message={errorMessage(schema.error)} />
          </div>
        ) : !schema.data?.fields.length ? (
          <EmptyState icon={<BarChart3 />} title="Aucun champ à analyser">
            La collection est vide.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Champ</th>
                  <th className="px-4 py-2.5 font-medium">Types observés</th>
                  <th className="w-1/3 px-4 py-2.5 font-medium">Présence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {schema.data.fields.map(field => (
                  <tr key={field.path}>
                    <td className="px-4 py-2 font-mono text-[12.5px]">
                      <span className="text-faint">
                        {field.path.includes('.')
                          ? field.path.slice(0, field.path.lastIndexOf('.') + 1)
                          : ''}
                      </span>
                      {field.path.split('.').pop()}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {field.types.map(type => (
                          <Badge
                            key={type}
                            tone={field.types.length > 1 ? 'warn' : 'neutral'}
                          >
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                          <div
                            className="h-full rounded-full bg-brand"
                            style={{
                              width: `${Math.round(field.frequency * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs text-muted tabular-nums">
                          {Math.round(field.frequency * 100)} %
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
