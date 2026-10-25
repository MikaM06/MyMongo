import {
  ArrowLeftRight,
  Compass,
  FileSearch,
  KeyRound,
  TerminalSquare,
} from 'lucide-react';
import {useState} from 'react';
import {Link, Navigate, useParams} from 'react-router';
import {PageContainer, PageHeader} from '../components/layout/app-shell';
import {Card} from '../components/ui/card';
import {EmptyState} from '../components/ui/empty-state';
import {Select} from '../components/ui/input';
import {LoadingBlock} from '../components/ui/spinner';
import {useConnection} from '../lib/connection';
import {useCollections, useDatabases} from '../lib/queries';
import {collUrl} from '../lib/selection';

const TOOLS: Record<
  string,
  {title: string; tab: string; icon: React.ReactNode; text: string}
> = {
  explorer: {
    title: 'Explorateur de données',
    tab: '',
    icon: <FileSearch />,
    text: 'Parcourez, filtrez et modifiez les documents.',
  },
  query: {
    title: 'Éditeur de requêtes',
    tab: 'query',
    icon: <TerminalSquare />,
    text: 'Exécutez des filtres et des pipelines d’agrégation.',
  },
  indexes: {
    title: 'Index',
    tab: 'indexes',
    icon: <KeyRound />,
    text: 'Consultez, créez et supprimez les index.',
  },
  transfer: {
    title: 'Import / Export',
    tab: 'transfer',
    icon: <ArrowLeftRight />,
    text: 'Importez ou exportez en JSON, NDJSON ou CSV.',
  },
};

export function ToolPickerPage() {
  const {tool = ''} = useParams();
  const {conn} = useConnection();
  const databases = useDatabases(conn);
  const [db, setDb] = useState('');
  const collections = useCollections(conn, db || null, Boolean(db));
  const config = TOOLS[tool];
  if (!config) {
    return <Navigate to="/" replace />;
  }
  return (
    <PageContainer>
      <PageHeader
        icon={config.icon}
        title={config.title}
        subtitle={config.text}
      />
      <Card className="mx-auto max-w-xl">
        <div className="space-y-4 p-5">
          <p className="text-[13px] text-muted">
            Choisissez la collection à ouvrir :
          </p>
          {databases.isLoading ? (
            <LoadingBlock />
          ) : !databases.data?.length ? (
            <EmptyState icon={<Compass />} title="Aucune base accessible" />
          ) : (
            <>
              <Select
                value={db}
                onChange={event => setDb(event.target.value)}
                aria-label="Base de données"
              >
                <option value="">Base de données…</option>
                {databases.data.map(item => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </Select>
              {db ? (
                collections.isLoading ? (
                  <LoadingBlock />
                ) : collections.data?.length ? (
                  <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded border border-line">
                    {collections.data.map(item => (
                      <li key={item.name}>
                        <Link
                          to={collUrl(db, item.name, config.tab)}
                          className="flex items-center justify-between px-3 py-2 font-mono text-[13px] hover:bg-hover"
                        >
                          {item.name}
                          <span className="font-sans text-xs text-faint">
                            {item.type === 'view' ? 'vue' : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-faint">
                    Aucune collection dans cette base.
                  </p>
                )
              ) : null}
            </>
          )}
        </div>
      </Card>
    </PageContainer>
  );
}
