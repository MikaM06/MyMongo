import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Filter,
  Upload,
} from 'lucide-react';
import {type DragEvent, useRef, useState} from 'react';
import {useOutletContext, useParams} from 'react-router';
import {toast} from 'sonner';
import {ResultTable} from '../components/result-table';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Card, CardHeader} from '../components/ui/card';
import {ConfirmDialog} from '../components/ui/confirm-dialog';
import {ErrorState} from '../components/ui/empty-state';
import {Checkbox, Field, Input, Select} from '../components/ui/input';
import {isEmptyQuery, readActiveQuery} from '../lib/active-query';
import {api, collPath, downloadFile, errorMessage} from '../lib/api';
import {useAuth} from '../lib/auth';
import {cn} from '../lib/cn';
import {useConnection} from '../lib/connection';
import {formatBytes, formatNumber} from '../lib/format';
import {keys} from '../lib/queries';
import type {WireDocument} from '../lib/wire';
import type {CollectionContext} from './collection-layout';

type Format = 'json' | 'ndjson' | 'csv';

interface Issue {
  line: number | null;
  message: string;
}

interface Preview {
  total: number;
  valid: number;
  withId: number;
  preview: WireDocument[];
  errors: Issue[];
}

interface Report {
  inserted: number;
  upserted: number;
  replaced: number;
  failed: number;
  errors: Issue[];
}

interface Settings {
  limits: {maxImportMb: number; maxExportDocs: number};
}

const FORMAT_LABELS: Record<Format, string> = {
  json: 'JSON (tableau de documents)',
  ndjson: 'JSON Lines / NDJSON',
  csv: 'CSV',
};

function detectFormat(name: string): Format {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) {
    return 'csv';
  }
  if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) {
    return 'ndjson';
  }
  return 'json';
}

function IssueList({issues}: {issues: Issue[]}) {
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded border border-danger/25 bg-danger-soft p-3 font-mono text-xs text-danger">
      {issues.map((issue, index) => (
        <li key={index}>
          {issue.line !== null ? `Ligne ${issue.line} : ` : ''}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function TransferPage() {
  const {db = '', coll = ''} = useParams();
  const {conn} = useConnection();
  const {isAdmin} = useAuth();
  const {info} = useOutletContext<CollectionContext>();
  const client = useQueryClient();
  const base = collPath(conn!, db, coll);
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('GET', '/settings'),
  });
  const maxMb = settings.data?.limits.maxImportMb ?? 16;
  const maxExport = settings.data?.limits.maxExportDocs ?? 100_000;

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<Format>('json');
  const [mode, setMode] = useState<'insert' | 'upsert'>('insert');
  const [dragging, setDragging] = useState(false);
  const [confirmUpsert, setConfirmUpsert] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [exportFormat, setExportFormat] = useState<Format>('json');
  const [useFilters, setUseFilters] = useState(true);
  const [exportLimit, setExportLimit] = useState('');
  const [exporting, setExporting] = useState(false);
  const active = readActiveQuery(conn!, db, coll);
  const hasActive = !isEmptyQuery(active);

  const preview = useMutation({
    mutationFn: (payload: {format: Format; content: string}) =>
      api<Preview>('POST', `${base}/import/preview`, payload),
  });

  const run = useMutation({
    mutationFn: () =>
      api<Report>('POST', `${base}/import`, {format, content, mode}),
    onSuccess: report => {
      setConfirmUpsert(false);
      const done = report.inserted + report.upserted + report.replaced;
      if (report.failed) {
        toast.warning(
          `${formatNumber(done)} document(s) écrits, ${formatNumber(report.failed)} en échec`,
        );
      } else {
        toast.success(`${formatNumber(done)} document(s) importé(s)`);
      }
      void client.invalidateQueries({
        queryKey: keys.documents(conn!, db, coll),
      });
      void client.invalidateQueries({queryKey: keys.collections(conn!, db)});
    },
    onError: () => setConfirmUpsert(false),
  });

  const load = async (picked: File) => {
    setFileError(null);
    run.reset();
    preview.reset();
    if (picked.size > maxMb * 1024 * 1024) {
      setFile(null);
      setContent('');
      setFileError(
        `Fichier trop volumineux (${formatBytes(picked.size)}). Limite : ${maxMb} Mo.`,
      );
      return;
    }
    const text = await picked.text();
    const detected = detectFormat(picked.name);
    setFile(picked);
    setContent(text);
    setFormat(detected);
    preview.mutate({format: detected, content: text});
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const picked = event.dataTransfer.files[0];
    if (picked) {
      void load(picked);
    }
  };

  const startImport = () => {
    if (mode === 'upsert' && (preview.data?.withId ?? 0) > 0) {
      setConfirmUpsert(true);
    } else {
      run.mutate();
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const limit = Number(exportLimit);
      await downloadFile(
        `${base}/export`,
        {
          format: exportFormat,
          ...(useFilters && hasActive ? active : {}),
          ...(limit > 0 ? {limit} : {}),
        },
        `${db}.${coll}.${exportFormat === 'ndjson' ? 'jsonl' : exportFormat}`,
      );
      toast.success('Export téléchargé');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const readOnly = info?.type === 'view' || info?.readOnly;
  const data = preview.data;
  const canImport =
    isAdmin && !readOnly && data && data.valid > 0 && !data.errors.length;

  return (
    <div className="grid gap-4 p-3 sm:p-5 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Card>
        <CardHeader
          icon={<Upload />}
          title="Importer des documents"
          actions={<Badge>Max. {maxMb} Mo</Badge>}
        />
        <div className="space-y-4 p-4">
          {!isAdmin || readOnly ? (
            <p className="rounded border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
              {readOnly
                ? 'Import impossible : cette collection est en lecture seule.'
                : 'Aperçu uniquement : l’import nécessite le rôle administrateur.'}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={event => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors',
              dragging
                ? 'border-info bg-hover'
                : 'border-line hover:border-line-strong hover:bg-hover/50',
            )}
          >
            <FileUp className="size-6 text-faint" />
            {file ? (
              <span className="text-[13px]">
                <span className="font-medium">{file.name}</span>
                <span className="text-muted"> · {formatBytes(file.size)}</span>
              </span>
            ) : (
              <span className="text-[13px] text-muted">
                Déposez un fichier ici ou cliquez pour choisir
              </span>
            )}
            <span className="text-xs text-faint">
              .json, .ndjson, .jsonl ou .csv
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.ndjson,.jsonl,.csv,application/json,text/csv"
            hidden
            onChange={event => {
              const picked = event.target.files?.[0];
              if (picked) {
                void load(picked);
              }
              event.target.value = '';
            }}
          />
          {fileError ? <ErrorState message={fileError} /> : null}

          {file ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Format" htmlFor="import-format">
                <Select
                  id="import-format"
                  value={format}
                  onChange={event => {
                    const next = event.target.value as Format;
                    setFormat(next);
                    preview.mutate({format: next, content});
                  }}
                >
                  {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Mode"
                htmlFor="import-mode"
                hint={
                  mode === 'upsert'
                    ? 'Les documents avec un _id existant seront remplacés.'
                    : 'Les _id déjà présents sont signalés en erreur.'
                }
              >
                <Select
                  id="import-mode"
                  value={mode}
                  onChange={event =>
                    setMode(event.target.value as 'insert' | 'upsert')
                  }
                >
                  <option value="insert">Insérer uniquement</option>
                  <option value="upsert">Insérer ou remplacer (par _id)</option>
                </Select>
              </Field>
            </div>
          ) : null}

          {preview.isPending ? (
            <p className="text-[13px] text-muted">Analyse du fichier…</p>
          ) : null}
          {preview.isError ? (
            <ErrorState message={errorMessage(preview.error)} />
          ) : null}
          {data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone={data.errors.length ? 'danger' : 'brand'}>
                  {formatNumber(data.valid)} / {formatNumber(data.total)}{' '}
                  valides
                </Badge>
                <Badge>{formatNumber(data.withId)} avec _id</Badge>
                {data.errors.length ? (
                  <Badge tone="danger">{data.errors.length} erreur(s)</Badge>
                ) : null}
              </div>
              {data.errors.length ? <IssueList issues={data.errors} /> : null}
              {mode === 'upsert' && data.withId > 0 ? (
                <div className="flex gap-2 rounded border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
                  <AlertTriangle className="size-4 shrink-0" />
                  Jusqu’à {formatNumber(data.withId)} document(s) existant(s)
                  pourront être écrasés.
                </div>
              ) : null}
              {data.preview.length ? (
                <div className="overflow-hidden rounded border border-line">
                  <div className="border-b border-line bg-panel-2 px-3 py-1.5 text-xs text-muted">
                    Aperçu des {data.preview.length} premiers documents
                  </div>
                  <ResultTable documents={data.preview} />
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={!canImport}
                  loading={run.isPending}
                  onClick={startImport}
                >
                  <Upload />
                  Importer {formatNumber(data.valid)} document(s)
                </Button>
              </div>
            </div>
          ) : null}
          {run.isError ? (
            <ErrorState message={errorMessage(run.error)} />
          ) : null}
          {run.data ? (
            <div className="space-y-2 rounded-md border border-line bg-panel-2 p-3 text-[13px]">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4 text-brand-ink" />
                Import terminé
              </p>
              <p className="text-muted">
                {formatNumber(run.data.inserted)} inséré(s) ·{' '}
                {formatNumber(run.data.upserted)} créé(s) par upsert ·{' '}
                {formatNumber(run.data.replaced)} remplacé(s) ·{' '}
                {formatNumber(run.data.failed)} en échec
              </p>
              {run.data.errors.length ? (
                <IssueList issues={run.data.errors} />
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="self-start">
        <CardHeader icon={<Download />} title="Exporter" />
        <div className="space-y-4 p-4">
          <Field
            label="Format"
            htmlFor="export-format"
            hint={
              exportFormat === 'csv'
                ? 'Champs imbriqués aplatis (a.b) ; colonnes déduites des 1 000 premiers documents.'
                : 'Extended JSON : les types BSON sont conservés.'
            }
          >
            <Select
              id="export-format"
              value={exportFormat}
              onChange={event => setExportFormat(event.target.value as Format)}
            >
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox
            checked={useFilters && hasActive}
            onChange={setUseFilters}
            disabled={!hasActive}
            label="Appliquer les filtres actifs de l’explorateur"
            hint={
              hasActive
                ? undefined
                : 'Aucun filtre actif : toute la collection sera exportée.'
            }
          />
          {useFilters && hasActive ? (
            <pre className="flex gap-2 overflow-x-auto rounded border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-muted">
              <Filter className="mt-0.5 size-3.5 shrink-0" />
              {[
                active.filter && `filtre ${active.filter}`,
                active.search && `recherche « ${active.search} »`,
                active.sort && `tri ${active.sort}`,
                active.projection && `projection ${active.projection}`,
              ]
                .filter(Boolean)
                .join('\n')
                .replace(/[ \t]+/g, ' ')}
            </pre>
          ) : null}
          <Field
            label="Nombre maximum de documents"
            htmlFor="export-limit"
            hint={`Plafond serveur : ${formatNumber(maxExport)}.`}
          >
            <Input
              id="export-limit"
              type="number"
              min={1}
              max={maxExport}
              placeholder={String(maxExport)}
              value={exportLimit}
              onChange={event => setExportLimit(event.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            className="w-full justify-center"
            loading={exporting}
            onClick={() => void doExport()}
          >
            <Download />
            Télécharger l’export
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmUpsert}
        onOpenChange={setConfirmUpsert}
        title="Remplacer des documents existants ?"
        confirmLabel="Importer et remplacer"
        loading={run.isPending}
        onConfirm={() => run.mutate()}
      >
        <p>
          {formatNumber(data?.withId ?? 0)} document(s) du fichier possèdent un{' '}
          <code className="font-mono">_id</code>. Ceux qui existent déjà dans{' '}
          <strong className="font-mono">
            {db}.{coll}
          </strong>{' '}
          seront entièrement remplacés.
        </p>
      </ConfirmDialog>
    </div>
  );
}
