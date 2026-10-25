import './styles.css';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Compass} from 'lucide-react';
import {lazy, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Link, Route, Routes} from 'react-router';
import {Toaster} from 'sonner';
import {AppShell} from './components/layout/app-shell';
import {EmptyState} from './components/ui/empty-state';
import {LoadingBlock} from './components/ui/spinner';
import {ApiError} from './lib/api';
import {AuthProvider, useAuth} from './lib/auth';
import {ConnectionProvider} from './lib/connection';
import {ThemeProvider, useTheme} from './lib/theme';
import {CollectionLayout} from './pages/collection-layout';
import {DashboardPage} from './pages/dashboard';
import {DatabasePage} from './pages/database';
import {DocumentsPage} from './pages/documents';
import {LoginPage} from './pages/login';

const QueryPage = lazy(() =>
  import('./pages/query').then(module => ({default: module.QueryPage})),
);
const IndexesPage = lazy(() =>
  import('./pages/indexes').then(module => ({default: module.IndexesPage})),
);
const TransferPage = lazy(() =>
  import('./pages/transfer').then(module => ({default: module.TransferPage})),
);
const CollectionStatsPage = lazy(() =>
  import('./pages/collection-stats').then(module => ({
    default: module.CollectionStatsPage,
  })),
);
const StatsPage = lazy(() =>
  import('./pages/stats').then(module => ({default: module.StatsPage})),
);
const MongoUsersPage = lazy(() =>
  import('./pages/mongo-users').then(module => ({
    default: module.MongoUsersPage,
  })),
);
const SettingsPage = lazy(() =>
  import('./pages/settings').then(module => ({default: module.SettingsPage})),
);
const ToolPickerPage = lazy(() =>
  import('./pages/tool-picker').then(module => ({
    default: module.ToolPickerPage,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        !(
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) && count < 1,
    },
  },
});

function NotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page introuvable"
      action={
        <Link
          to="/"
          className="inline-flex h-8 items-center rounded border border-line bg-panel px-3 text-[13px] hover:bg-hover"
        >
          Retour au tableau de bord
        </Link>
      }
    >
      L’adresse demandée ne correspond à aucune page de MyMongo.
    </EmptyState>
  );
}

function Root() {
  const {user, loading} = useAuth();
  const {theme} = useTheme();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Ouverture de MyMongo…" />
      </div>
    );
  }
  return (
    <>
      {user ? (
        <ConnectionProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="db/:db" element={<DatabasePage />} />
              <Route path="db/:db/:coll" element={<CollectionLayout />}>
                <Route index element={<DocumentsPage />} />
                <Route path="query" element={<QueryPage />} />
                <Route path="indexes" element={<IndexesPage />} />
                <Route path="transfer" element={<TransferPage />} />
                <Route path="stats" element={<CollectionStatsPage />} />
              </Route>
              <Route path="tools/:tool" element={<ToolPickerPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="mongo-users" element={<MongoUsersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ConnectionProvider>
      ) : (
        <LoginPage />
      )}
      <Toaster
        theme={theme}
        position="bottom-right"
        toastOptions={{
          className: 'font-sans !rounded-md !border-line !bg-panel !text-text',
        }}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
