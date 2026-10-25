import {useMutation} from '@tanstack/react-query';
import {
  AlertTriangle,
  Braces,
  Eraser,
  Filter,
  Layers,
  Play,
  Table2,
  TerminalSquare,
  WandSparkles,
} from 'lucide-react';
import {useCallback, useMemo, useState} from 'react';
import {useParams} from 'react-router';
import {toast} from 'sonner';
import {DocumentPanel} from '../components/document-panel';
import {HistoryMenu} from '../components/history-menu';
import {JsonEditor} from '../components/json-editor';
import {JsonView} from '../components/json-view';
import {ResultTable} from '../components/result-table';
import {Badge, Kbd} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Card} from '../components/ui/card';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {Input} from '../components/ui/input';
import {Segmented} from '../components/ui/segmented';
import {api, collPath, errorMessage} from '../lib/api';
import {useAuth} from '../lib/auth';
import {useConnection} from '../lib/connection';
import {formatDuration, formatNumber} from '../lib/format';
import {pushHistory, readPreference, writePreference} from '../lib/history';
import {useSchema} from '../lib/queries';
import type {WireDocument} from '../lib/wire';

type Mode = 'find' | 'aggregate';

interface QueryResult {
  documents: WireDocument[];
  durationMs: number;
  total?: number | null;
  truncated?: boolean;
  wrote?: boolean;
}

const SAMPLE_PIPELINE = `[
  { "$match": {} },
  { "$group": { "_id": null, "total": { "$sum": 1 } } }
]`;

function EditorBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function QueryPage() {
  const {db = '', coll = ''} = useParams();
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const namespace = `${db}.${coll}`;
  const schema = useSchema(conn!, db, coll);
  const fields = useMemo(
    () => schema.data?.fields.map(field => field.path) ?? [],
    [schema.data],
  );

  const [mode, setMode] = useState<Mode>(() =>
    readPreference('queryMode', 'find'),
  );
  const [filter, setFilter] = useState('{\n  \n}');
  const [projection, setProjection] = useState('');
  const [sort, setSort] = useState('');
  const [limit, setLimit] = useState('50');
  const [pipeline, setPipeline] = useState(SAMPLE_PIPELINE);
  const [view, setView] = useState<'table' | 'json'>('json');
  const [selected, setSelected] = useState<WireDocument | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);

  const limitValue = Math.min(Math.max(Number(limit) || 50, 1), 1000);

  const execute = useMutation({
    mutationFn: async (): Promise<QueryResult> => {
      const base = collPath(conn!, db, coll);
      if (mode === 'find') {
        pushHistory({kind: 'find', namespace, filter, sort, projection});
        return api<QueryResult>('POST', `${base}/find`, {
          filter,
          sort,
          projection,
          limit: limitValue,
        });
      }
      pushHistory({kind: 'aggregate', namespace, pipeline});
      return api<QueryResult>('POST', `${base}/aggregate`, {
        pipeline,
        limit: limitValue,
      });
    },
    onSuccess: data => {
      if (data.wrote) {
        toast.success('Pipeline exécuté : les données ont été écrites.');
      }
    },
  });

  const run = useCallback(() => execute.mutate(), [execute]);

  const format = async () => {
    setFormatError(null);
    try {
      if (mode === 'aggregate') {
        setPipeline(
          (await api<{text: string}>('POST', '/tools/format', {text: pipeline}))
            .text,
        );
      } else {
        if (filter.trim()) {
          setFilter(
            (await api<{text: string}>('POST', '/tools/format', {text: filter}))
              .text,
          );
        }
        if (sort.trim()) {
          setSort(
            (await api<{text: string}>('POST', '/tools/format', {text: sort}))
              .text,
          );
        }
        if (projection.trim()) {
          setProjection(
            (
              await api<{text: string}>('POST', '/tools/format', {
                text: projection,
              })
            ).text,
          );
        }
      }
    } catch (error) {
      setFormatError(errorMessage(error));
    }
  };

  const clear = () => {
    execute.reset();
    if (mode === 'aggregate') {
      setPipeline('[\n  \n]');
    } else {
      setFilter('{\n  \n}');
      setSort('');
      setProjection('');
    }
  };

  const writes = mode === 'aggregate' && /"?\$(out|merge)"?\s*:/.test(pipeline);
  const data = execute.data;

  return (
    <div className="grid gap-4 p-3 sm:p-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card className="flex flex-col self-start">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <Segmented
            label="Type de requête"
            value={mode}
            onChange={next => {
              setMode(next);
              writePreference('queryMode', next);
              execute.reset();
            }}
            options={[
              {value: 'find', label: 'Find', icon: <Filter />},
              {value: 'aggregate', label: 'Agrégation', icon: <Layers />},
            ]}
          />
          <div className="flex items-center gap-0.5">
            <HistoryMenu
              kind={mode}
              namespace={namespace}
              onPick={entry => {
                if (entry.kind === 'aggregate') {
                  setPipeline(entry.pipeline ?? '');
                } else {
                  setFilter(entry.filter ?? '');
                  setSort(entry.sort ?? '');
                  setProjection(entry.projection ?? '');
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void format()}
              title="Formater le JSON"
              aria-label="Formater le JSON"
            >
              <WandSparkles />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={clear}
              title="Effacer"
              aria-label="Effacer"
            >
              <Eraser />
            </Button>
          </div>
        </div>
        <div className="space-y-4 p-4">
          {mode === 'find' ? (
            <>
              <EditorBlock label="Filtre" hint="Ctrl+Entrée pour exécuter">
                <JsonEditor
                  value={filter}
                  onChange={setFilter}
                  onRun={run}
                  fields={fields}
                  mode="document"
                  minHeight="140px"
                  maxHeight="40vh"
                  ariaLabel="Filtre"
                />
              </EditorBlock>
              <div className="grid gap-4 sm:grid-cols-2">
                <EditorBlock label="Tri">
                  <JsonEditor
                    value={sort}
                    onChange={setSort}
                    onRun={run}
                    fields={fields}
                    minHeight="38px"
                    placeholder='{ "_id": -1 }'
                    ariaLabel="Tri"
                  />
                </EditorBlock>
                <EditorBlock label="Projection">
                  <JsonEditor
                    value={projection}
                    onChange={setProjection}
                    onRun={run}
                    fields={fields}
                    minHeight="38px"
                    placeholder='{ "name": 1 }'
                    ariaLabel="Projection"
                  />
                </EditorBlock>
              </div>
            </>
          ) : (
            <EditorBlock
              label="Pipeline d’agrégation"
              hint="Tableau d’étapes · Ctrl+Entrée"
            >
              <JsonEditor
                value={pipeline}
                onChange={setPipeline}
                onRun={run}
                fields={fields}
                mode="pipeline"
                minHeight="280px"
                maxHeight="56vh"
                ariaLabel="Pipeline d’agrégation"
              />
            </EditorBlock>
          )}
          {writes ? (
            <div className="flex gap-2 rounded border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              <AlertTriangle className="size-4 shrink-0" />
              {isAdmin
                ? 'Ce pipeline contient $out ou $merge : il va écrire dans une collection.'
                : '$out et $merge sont réservés aux administrateurs.'}
            </div>
          ) : null}
          {formatError ? <ErrorState message={formatError} /> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              Limite
              <Input
                type="number"
                min={1}
                max={1000}
                value={limit}
                onChange={event => setLimit(event.target.value)}
                className="h-7.5 w-20 text-xs"
              />
            </label>
            <Button variant="primary" onClick={run} loading={execute.isPending}>
              <Play />
              Exécuter
              <span className="ml-1 hidden opacity-70 sm:inline">
                <Kbd>Ctrl ↵</Kbd>
              </span>
            </Button>
          </div>
        </div>
      </Card>

      <Card className="flex min-h-[420px] flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold">Résultats</span>
            {data ? (
              <>
                <Badge>{formatNumber(data.documents.length)} document(s)</Badge>
                <Badge title="Temps d’exécution côté serveur">
                  {formatDuration(data.durationMs)}
                </Badge>
                {data.truncated ? (
                  <Badge tone="warn">Limité à {limitValue}</Badge>
                ) : null}
                {typeof data.total === 'number' &&
                data.total > data.documents.length ? (
                  <Badge tone="info">{formatNumber(data.total)} au total</Badge>
                ) : null}
              </>
            ) : null}
          </div>
          <Segmented
            label="Affichage des résultats"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              {value: 'json', label: 'JSON', icon: <Braces />},
              {value: 'table', label: 'Tableau', icon: <Table2 />},
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {execute.isError ? (
            <div className="p-4">
              <ErrorState message={errorMessage(execute.error)} />
            </div>
          ) : !data ? (
            <EmptyState icon={<TerminalSquare />} title="Prêt à exécuter">
              {mode === 'find'
                ? 'Écrivez un filtre MongoDB. Les helpers ObjectId(), ISODate(), NumberLong() et l’Extended JSON sont acceptés.'
                : 'Composez un pipeline : $match, $group, $lookup, $project… Les résultats sont limités pour protéger le serveur.'}
            </EmptyState>
          ) : !data.documents.length ? (
            <EmptyState icon={<Filter />} title="Aucun résultat" />
          ) : view === 'table' ? (
            <ResultTable documents={data.documents} onSelect={setSelected} />
          ) : (
            <div className="divide-y divide-line">
              {data.documents.map((document, index) => (
                <JsonView key={index} value={document} className="px-4 py-3" />
              ))}
            </div>
          )}
        </div>
      </Card>
      <DocumentPanel
        document={selected}
        onClose={() => setSelected(null)}
        canWrite={false}
        onEdit={() => undefined}
        onDuplicate={() => undefined}
        onDelete={() => undefined}
      />
    </div>
  );
}
