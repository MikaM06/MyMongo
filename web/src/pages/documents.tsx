import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  Braces,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  FileX2,
  Filter,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useOutletContext, useParams} from 'react-router';
import {toast} from 'sonner';
import {BsonInline} from '../components/bson-value';
import {DocumentEditor} from '../components/document-editor';
import {DocumentPanel} from '../components/document-panel';
import {HistoryMenu} from '../components/history-menu';
import {JsonEditor} from '../components/json-editor';
import {JsonView} from '../components/json-view';
import {isTypingTarget} from '../components/layout/app-shell';
import {Badge, Kbd} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {ConfirmDialog} from '../components/ui/confirm-dialog';
import {Menu, MenuItem} from '../components/ui/dropdown';
import {EmptyState, ErrorState} from '../components/ui/empty-state';
import {Select} from '../components/ui/input';
import {Segmented} from '../components/ui/segmented';
import {Spinner} from '../components/ui/spinner';
import {
  type ActiveQuery,
  EMPTY_QUERY,
  isEmptyQuery,
  readActiveQuery,
  writeActiveQuery,
} from '../lib/active-query';
import {api, collPath, errorMessage} from '../lib/api';
import {useAuth} from '../lib/auth';
import {copyText} from '../lib/clipboard';
import {cn} from '../lib/cn';
import {useConnection} from '../lib/connection';
import {formatDuration, formatNumber} from '../lib/format';
import {pushHistory, readPreference, writePreference} from '../lib/history';
import {type FindResult, keys, useSchema} from '../lib/queries';
import {
  documentColumns,
  idDisplay,
  idToText,
  prettyJson,
  shellLiteral,
  stripId,
  type WireDocument,
  type WireValue,
} from '../lib/wire';
import type {CollectionContext} from './collection-layout';

const PAGE_SIZES = [10, 20, 50, 100, 200, 500];

type EditorState =
  | {mode: 'create'}
  | {mode: 'edit' | 'duplicate'; document: WireDocument}
  | null;

function parseSort(sort: string): {field: string; dir: 1 | -1} | null {
  const match = /^\s*\{\s*"?([^":\s]+)"?\s*:\s*(-?1)\s*\}\s*$/.exec(sort);
  return match ? {field: match[1], dir: match[2] === '1' ? 1 : -1} : null;
}

export function DocumentsPage() {
  const {db = '', coll = ''} = useParams();
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const {info} = useOutletContext<CollectionContext>();
  const client = useQueryClient();
  const readOnlyCollection = info?.type === 'view' || info?.readOnly;
  const canWrite = isAdmin && !readOnlyCollection;
  const namespace = `${db}.${coll}`;

  const [draft, setDraft] = useState<ActiveQuery>(() =>
    readActiveQuery(conn!, db, coll),
  );
  const [applied, setApplied] = useState<ActiveQuery>(() =>
    readActiveQuery(conn!, db, coll),
  );
  const [showOptions, setShowOptions] = useState(() =>
    Boolean(draft.sort || draft.projection),
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() =>
    readPreference('pageSize', 20),
  );
  const [view, setView] = useState<'table' | 'json'>(() =>
    readPreference('documentView', 'table'),
  );
  const [selected, setSelected] = useState<WireDocument | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [deleting, setDeleting] = useState<WireDocument | null>(null);
  const [deletingMany, setDeletingMany] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = readActiveQuery(conn!, db, coll);
    setDraft(stored);
    setApplied(stored);
    setPage(0);
    setSelected(null);
  }, [conn, db, coll]);

  const schema = useSchema(conn!, db, coll);
  const fieldNames = useMemo(
    () => schema.data?.fields.map(field => field.path) ?? [],
    [schema.data],
  );

  const result = useQuery({
    queryKey: [...keys.documents(conn!, db, coll), applied, page, pageSize],
    queryFn: ({signal}) =>
      api<FindResult>(
        'POST',
        `${collPath(conn!, db, coll)}/find`,
        {...applied, skip: page * pageSize, limit: pageSize},
        signal,
      ),
    placeholderData: keepPreviousData,
  });

  const run = useCallback(
    (next: ActiveQuery = draft) => {
      setApplied(next);
      setDraft(next);
      setPage(0);
      writeActiveQuery(conn!, db, coll, next);
      if (next.filter.trim() || next.sort.trim() || next.projection.trim()) {
        pushHistory({
          kind: 'find',
          namespace,
          filter: next.filter,
          sort: next.sort,
          projection: next.projection,
        });
      }
      void client.invalidateQueries({
        queryKey: keys.documents(conn!, db, coll),
      });
    },
    [draft, conn, db, coll, namespace, client],
  );

  const reset = () => run(EMPTY_QUERY);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.key === 'n' || event.key === 'N') && canWrite) {
        event.preventDefault();
        setEditor({mode: 'create'});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canWrite]);

  const refresh = () => {
    void client.invalidateQueries({queryKey: keys.documents(conn!, db, coll)});
    void client.invalidateQueries({queryKey: keys.collections(conn!, db)});
    void client.invalidateQueries({queryKey: keys.schema(conn!, db, coll)});
  };

  const remove = useMutation({
    mutationFn: (document: WireDocument) =>
      api('DELETE', `${collPath(conn!, db, coll)}/documents`, {
        id: idToText(document._id),
      }),
    onSuccess: () => {
      toast.success('Document supprimé');
      setDeleting(null);
      setSelected(null);
      refresh();
    },
    onError: error => toast.error(errorMessage(error)),
  });

  const removeMany = useMutation({
    mutationFn: (confirm: string) =>
      api<{deleted: number}>(
        'POST',
        `${collPath(conn!, db, coll)}/delete-many`,
        {filter: applied.filter, confirm},
      ),
    onSuccess: data => {
      toast.success(`${formatNumber(data.deleted)} document(s) supprimé(s)`);
      setDeletingMany(false);
      refresh();
    },
    onError: error => toast.error(errorMessage(error)),
  });

  const documents = useMemo(() => result.data?.documents ?? [], [result.data]);
  const columnKeys = useMemo(() => documentColumns(documents), [documents]);
  const activeSort = parseSort(applied.sort);

  const toggleSort = useCallback(
    (field: string) => {
      const dir = activeSort?.field === field && activeSort.dir === 1 ? -1 : 1;
      const next = {...applied, sort: `{${JSON.stringify(field)}: ${dir}}`};
      setShowOptions(true);
      run(next);
    },
    [activeSort, applied, run],
  );

  const columns = useMemo<ColumnDef<WireDocument>[]>(
    () => [
      ...columnKeys.map<ColumnDef<WireDocument>>(key => ({
        id: key,
        header: () => {
          const sorted = activeSort?.field === key;
          return (
            <button
              type="button"
              onClick={() => toggleSort(key)}
              className={cn(
                'flex cursor-pointer items-center gap-1 font-mono text-[12px] font-medium hover:text-text',
                sorted ? 'text-brand-ink' : 'text-muted',
              )}
              title={`Trier par ${key}`}
            >
              {key}
              {sorted ? (
                activeSort.dir === 1 ? (
                  <ArrowUp className="size-3" />
                ) : (
                  <ArrowDown className="size-3" />
                )
              ) : null}
            </button>
          );
        },
        cell: ({row}) => {
          const value = row.original[key];
          return value === undefined ? (
            <span className="text-faint/60">—</span>
          ) : (
            <BsonInline value={value} max={60} />
          );
        },
      })),
      {
        id: '__actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({row}) => (
          <div
            className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={event => event.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              title="Copier le document"
              aria-label="Copier le document"
              onClick={() =>
                void copyText(prettyJson(row.original), 'Document copié')
              }
            >
              <Copy />
            </Button>
            {canWrite ? (
              <Menu
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Plus d’actions"
                  >
                    <MoreHorizontal />
                  </Button>
                }
              >
                <MenuItem
                  icon={<Pencil />}
                  onSelect={() =>
                    setEditor({mode: 'edit', document: row.original})
                  }
                >
                  Modifier
                </MenuItem>
                <MenuItem
                  icon={<Copy />}
                  onSelect={() =>
                    setEditor({
                      mode: 'duplicate',
                      document: stripId(row.original),
                    })
                  }
                >
                  Dupliquer
                </MenuItem>
                <MenuItem
                  icon={<Copy />}
                  onSelect={() =>
                    void copyText(
                      row.original._id === undefined
                        ? ''
                        : shellLiteral(row.original._id),
                      '_id copié',
                    )
                  }
                >
                  Copier l’_id
                </MenuItem>
                <MenuItem
                  icon={<Trash2 />}
                  danger
                  onSelect={() => setDeleting(row.original)}
                >
                  Supprimer
                </MenuItem>
              </Menu>
            ) : null}
          </div>
        ),
      },
    ],
    [columnKeys, activeSort, toggleSort, canWrite],
  );

  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = result.data?.total ?? null;
  const from = documents.length ? page * pageSize + 1 : 0;
  const to = page * pageSize + documents.length;
  const hasNext = total !== null ? to < total : documents.length === pageSize;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const filtered = !isEmptyQuery(applied);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-2 border-b border-line bg-panel px-3 py-3 sm:px-5">
        <form
          className="flex flex-col gap-2 lg:flex-row"
          onSubmit={event => {
            event.preventDefault();
            run();
          }}
        >
          <div className="relative lg:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              value={draft.search}
              onChange={event =>
                setDraft({...draft, search: event.target.value})
              }
              placeholder="Rechercher…"
              aria-label="Rechercher dans les documents"
              className="h-9 w-full rounded border border-line bg-panel pr-9 pl-9 text-[13px] placeholder:text-faint hover:border-line-strong focus:border-info focus:ring-1 focus:ring-info/15 focus:outline-none"
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
              <Kbd>/</Kbd>
            </span>
          </div>
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <div className="flex h-9 shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
              <Filter className="size-3.5" />
              <span className="hidden sm:inline">Filtre</span>
            </div>
            <JsonEditor
              value={draft.filter}
              onChange={filter => setDraft(current => ({...current, filter}))}
              onRun={() => run()}
              fields={fieldNames}
              minHeight="34px"
              maxHeight="160px"
              placeholder='{ "status": "active", "age": { "$gte": 18 } }'
              className="min-w-0 flex-1 [&_.cm-content]:py-[7px]"
              ariaLabel="Filtre MongoDB"
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant={showOptions ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setShowOptions(!showOptions)}
              title="Tri et projection"
              aria-label="Tri et projection"
              aria-pressed={showOptions}
            >
              <SlidersHorizontal />
            </Button>
            <HistoryMenu
              kind="find"
              namespace={namespace}
              onPick={entry => {
                const next = {
                  ...EMPTY_QUERY,
                  filter: entry.filter ?? '',
                  sort: entry.sort ?? '',
                  projection: entry.projection ?? '',
                };
                setShowOptions(Boolean(next.sort || next.projection));
                run(next);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={reset}
              disabled={!filtered && isEmptyQuery(draft)}
              title="Effacer les filtres"
              aria-label="Effacer les filtres"
            >
              <Eraser />
            </Button>
            <Button
              type="submit"
              variant="primary"
              title="Exécuter (Ctrl+Entrée)"
            >
              <Play />
              Exécuter
            </Button>
          </div>
        </form>
        {showOptions ? (
          <div className="grid gap-2 lg:grid-cols-2 lg:pl-66">
            <div className="flex items-start gap-2">
              <span className="flex h-9 w-20 shrink-0 items-center text-xs font-medium text-muted">
                Tri
              </span>
              <JsonEditor
                value={draft.sort}
                onChange={sort => setDraft(current => ({...current, sort}))}
                onRun={() => run()}
                fields={fieldNames}
                minHeight="34px"
                placeholder='{ "createdAt": -1 }'
                className="min-w-0 flex-1 [&_.cm-content]:py-[7px]"
                ariaLabel="Tri"
              />
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-9 w-20 shrink-0 items-center text-xs font-medium text-muted">
                Projection
              </span>
              <JsonEditor
                value={draft.projection}
                onChange={projection =>
                  setDraft(current => ({...current, projection}))
                }
                onRun={() => run()}
                fields={fieldNames}
                minHeight="34px"
                placeholder='{ "name": 1, "email": 1 }'
                className="min-w-0 flex-1 [&_.cm-content]:py-[7px]"
                ariaLabel="Projection"
              />
            </div>
          </div>
        ) : null}
        {dirty ? (
          <p className="text-xs text-warn lg:pl-66">
            Modifications non appliquées — appuyez sur Exécuter ou Ctrl+Entrée.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2 sm:px-5">
        <div className="flex items-center gap-2 text-[13px]">
          {result.isFetching ? (
            <Spinner className="size-3.5 text-brand-ink" />
          ) : null}
          <span className="text-muted">
            {result.data ? (
              documents.length ? (
                <>
                  <span className="font-medium text-text tabular-nums">
                    {formatNumber(from)}–{formatNumber(to)}
                  </span>
                  {total !== null ? (
                    <>
                      {' '}
                      sur{' '}
                      <span className="font-medium text-text tabular-nums">
                        {formatNumber(total)}
                      </span>
                      {result.data.totalExact ? '' : ' (estimé)'}
                    </>
                  ) : null}
                </>
              ) : (
                'Aucun résultat'
              )
            ) : result.isError ? (
              'Requête en erreur'
            ) : (
              'Chargement…'
            )}
          </span>
          {result.data ? (
            <Badge title="Temps d’exécution côté serveur">
              {formatDuration(result.data.durationMs)}
            </Badge>
          ) : null}
          {filtered ? (
            <Badge tone="brand">
              <Filter />
              Filtré
            </Badge>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label="Affichage des documents"
            size="sm"
            value={view}
            onChange={next => {
              setView(next);
              writePreference('documentView', next);
            }}
            options={[
              {value: 'table', label: 'Tableau', icon: <Table2 />},
              {value: 'json', label: 'JSON', icon: <Braces />},
            ]}
          />
          <Select
            value={pageSize}
            onChange={event => {
              const size = Number(event.target.value);
              setPageSize(size);
              writePreference('pageSize', size);
              setPage(0);
            }}
            className="h-7 w-auto text-xs"
            aria-label="Documents par page"
          >
            {PAGE_SIZES.map(size => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </Select>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              aria-label="Page précédente"
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-12 text-center text-xs text-muted tabular-nums">
              p. {page + 1}
              {total !== null
                ? `/${Math.max(1, Math.ceil(total / pageSize))}`
                : ''}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage(page + 1)}
              aria-label="Page suivante"
            >
              <ChevronRight />
            </Button>
          </div>
          {canWrite ? (
            <>
              <Menu
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Actions sur les résultats"
                  >
                    <MoreHorizontal />
                  </Button>
                }
              >
                <MenuItem
                  icon={<Trash2 />}
                  danger
                  onSelect={() => setDeletingMany(true)}
                  disabled={!documents.length}
                >
                  {applied.filter.trim()
                    ? 'Supprimer les documents filtrés'
                    : 'Vider la collection'}
                </MenuItem>
              </Menu>
              <Button
                variant="primary"
                size="sm"
                onClick={() => setEditor({mode: 'create'})}
                title="Nouveau document (N)"
              >
                <Plus />
                Document
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {result.isError ? (
        <div className="p-3 sm:p-5">
          <ErrorState
            message={errorMessage(result.error)}
            onRetry={() => void result.refetch()}
          />
        </div>
      ) : result.isLoading ? (
        <div className="space-y-px p-3 sm:px-5">
          {Array.from({length: 8}, (_, index) => (
            <div
              key={index}
              className="h-9 animate-pulse rounded bg-hover/70"
            />
          ))}
        </div>
      ) : !documents.length ? (
        filtered ? (
          <EmptyState
            icon={<Filter />}
            title="Aucun document ne correspond"
            action={
              <Button onClick={reset}>
                <Eraser />
                Effacer les filtres
              </Button>
            }
          >
            Vérifiez le nom des champs et les types :{' '}
            <code className="font-mono">"18"</code> (texte) n’est pas égal à{' '}
            <code className="font-mono">18</code> (nombre).
          </EmptyState>
        ) : (
          <EmptyState
            icon={<FileX2 />}
            title="Cette collection est vide"
            action={
              canWrite ? (
                <Button
                  variant="primary"
                  onClick={() => setEditor({mode: 'create'})}
                >
                  <Plus />
                  Ajouter un document
                </Button>
              ) : null
            }
          >
            Ajoutez un premier document ou importez un fichier JSON, NDJSON ou
            CSV depuis l’onglet Import / Export.
          </EmptyState>
        )
      ) : view === 'table' ? (
        <div
          className={cn(
            'overflow-x-auto transition-opacity',
            result.isPlaceholderData && 'opacity-60',
          )}
        >
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead className="bg-bg">
              {table.getHeaderGroups().map(group => (
                <tr key={group.id}>
                  {group.headers.map(header => (
                    <th
                      key={header.id}
                      className="border-b border-line px-3 py-2 text-left whitespace-nowrap first:pl-5"
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  onClick={() => setSelected(row.original)}
                  onKeyDown={event => {
                    if (
                      event.key === 'Enter' &&
                      event.target === event.currentTarget
                    ) {
                      setSelected(row.original);
                    }
                  }}
                  className={cn(
                    'group cursor-pointer hover:bg-hover/70 focus:bg-hover/70 focus:outline-none',
                    selected === row.original && 'bg-hover',
                  )}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className="max-w-[320px] truncate border-b border-line px-3 py-[7px] first:pl-5"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className={cn(
            'space-y-3 p-3 sm:p-5',
            result.isPlaceholderData && 'opacity-60',
          )}
        >
          {documents.map((document, index) => (
            <article
              key={index}
              className="group rounded-md border border-line bg-panel"
            >
              <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-1.5">
                <button
                  type="button"
                  onClick={() => setSelected(document)}
                  className="cursor-pointer truncate font-mono text-xs text-t-oid hover:underline"
                >
                  {idDisplay(document._id as WireValue | undefined)}
                </button>
                <div className="flex gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copier"
                    onClick={() =>
                      void copyText(prettyJson(document), 'Document copié')
                    }
                  >
                    <Copy />
                  </Button>
                  {canWrite ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Modifier"
                        onClick={() => setEditor({mode: 'edit', document})}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Supprimer"
                        onClick={() => setDeleting(document)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </div>
              </header>
              <JsonView
                value={document}
                className="max-h-96 overflow-y-auto px-4 py-3"
              />
            </article>
          ))}
        </div>
      )}

      <DocumentPanel
        document={selected}
        onClose={() => setSelected(null)}
        canWrite={canWrite}
        onEdit={document => setEditor({mode: 'edit', document})}
        onDuplicate={document =>
          setEditor({mode: 'duplicate', document: stripId(document)})
        }
        onDelete={document => setDeleting(document)}
      />
      {editor ? (
        <DocumentEditor
          db={db}
          coll={coll}
          mode={editor.mode}
          document={editor.mode === 'create' ? undefined : editor.document}
          open
          onOpenChange={open => !open && setEditor(null)}
          onSaved={() => {
            setSelected(null);
            refresh();
          }}
          fields={fieldNames}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={open => !open && setDeleting(null)}
        title="Supprimer ce document ?"
        confirmLabel="Supprimer"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      >
        <p>
          Le document{' '}
          <code className="font-mono text-t-oid">
            {deleting ? idDisplay(deleting._id as WireValue | undefined) : ''}
          </code>{' '}
          sera supprimé définitivement.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={deletingMany}
        onOpenChange={setDeletingMany}
        title={
          applied.filter.trim()
            ? 'Supprimer les documents filtrés'
            : 'Vider la collection'
        }
        confirmLabel="Supprimer les documents"
        requireText={coll}
        loading={removeMany.isPending}
        onConfirm={typed => removeMany.mutate(typed)}
      >
        <p>
          {applied.filter.trim() ? (
            <>
              Tous les documents correspondant au filtre{' '}
              <code className="font-mono">
                {applied.filter.replace(/\s+/g, ' ')}
              </code>{' '}
              seront supprimés
            </>
          ) : (
            <>
              Tous les documents de{' '}
              <strong className="font-mono">{namespace}</strong> seront
              supprimés (les index sont conservés)
            </>
          )}
          {total !== null ? (
            <>
              {' '}
              — environ <strong>{formatNumber(total)}</strong> document(s).
            </>
          ) : (
            '.'
          )}
        </p>
        {applied.search.trim() ? (
          <p className="text-warn">
            La recherche rapide n’est pas prise en compte : seul le filtre
            s’applique.
          </p>
        ) : null}
        <p className="text-muted">Cette opération est irréversible.</p>
      </ConfirmDialog>
    </div>
  );
}
