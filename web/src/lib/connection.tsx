import {useQuery} from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {api} from './api';
import {readPreference, writePreference} from './history';

export interface Connection {
  id: string;
  label: string;
  hosts: string[];
}

interface ConnectionValue {
  connections: Connection[];
  conn: string | null;
  current: Connection | null;
  loading: boolean;
  select: (id: string) => void;
}

const ConnectionContext = createContext<ConnectionValue | null>(null);

export function ConnectionProvider({children}: {children: ReactNode}) {
  const [selected, setSelected] = useState<string | null>(() =>
    readPreference<string | null>('connection', null),
  );
  const query = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<{connections: Connection[]}>('GET', '/connections'),
    staleTime: 60_000,
  });
  const connections = useMemo(
    () => query.data?.connections ?? [],
    [query.data],
  );
  const current =
    connections.find(item => item.id === selected) ?? connections[0] ?? null;
  const select = useCallback((id: string) => {
    writePreference('connection', id);
    setSelected(id);
  }, []);
  return (
    <ConnectionContext.Provider
      value={{
        connections,
        conn: current?.id ?? null,
        current,
        loading: query.isLoading,
        select,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) {
    throw new Error('ConnectionProvider manquant');
  }
  return value;
}
