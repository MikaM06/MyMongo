import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useCallback} from 'react';
import {api, collPath, dbPath, enc} from './api';
import type {WireDocument} from './wire';

export interface DatabaseInfo {
  name: string;
  sizeOnDisk: number | null;
  empty: boolean | null;
  system: boolean;
}

export interface CollectionStats {
  count: number | null;
  size: number | null;
  avgObjSize: number | null;
  storageSize: number | null;
  totalIndexSize: number | null;
  nindexes: number | null;
  capped: boolean | null;
}

export interface CollectionInfo {
  name: string;
  type: 'collection' | 'view' | 'timeseries';
  readOnly: boolean;
  viewOn: string | null;
  capped: boolean;
  stats: CollectionStats | null;
}

export interface DatabaseStats {
  name: string;
  sizeOnDisk: number | null;
  collections: number | null;
  views: number | null;
  objects: number | null;
  dataSize: number | null;
  storageSize: number | null;
  indexSize: number | null;
}

export interface Overview {
  connected: boolean;
  latencyMs: number;
  server: {
    version: string | null;
    gitVersion: string | null;
    modules: string[] | null;
    bits: number | null;
    host: string | null;
    process: string | null;
    uptimeSeconds: number | null;
    storageEngine: string | null;
    connectionsCurrent: number | null;
    connectionsAvailable: number | null;
    memoryResidentMb: number | null;
    replicaSet: string | null;
    isWritablePrimary: boolean | null;
    maxBsonObjectSize: number | null;
  };
  opcounters: Record<string, number | null> | null;
  totals: {
    databases: number | null;
    collections: number | null;
    documents: number | null;
    dataSize: number | null;
    storageSize: number | null;
    indexSize: number | null;
    partial: boolean;
  } | null;
  databases: DatabaseStats[] | null;
}

export interface FieldInfo {
  path: string;
  types: string[];
  frequency: number;
}

export interface FindResult {
  documents: WireDocument[];
  total: number | null;
  totalExact: boolean;
  durationMs: number;
}

export const keys = {
  databases: (conn: string) => ['databases', conn] as const,
  collections: (conn: string, db: string) => ['collections', conn, db] as const,
  overview: (conn: string) => ['overview', conn] as const,
  status: (conn: string) => ['status', conn] as const,
  documents: (conn: string, db: string, coll: string) =>
    ['documents', conn, db, coll] as const,
  indexes: (conn: string, db: string, coll: string) =>
    ['indexes', conn, db, coll] as const,
  schema: (conn: string, db: string, coll: string) =>
    ['schema', conn, db, coll] as const,
  collStats: (conn: string, db: string, coll: string) =>
    ['collStats', conn, db, coll] as const,
};

export function useDatabases(conn: string | null) {
  return useQuery({
    queryKey: keys.databases(conn ?? ''),
    queryFn: () =>
      api<{databases: DatabaseInfo[]}>('GET', `/conn/${enc(conn!)}/databases`),
    enabled: Boolean(conn),
    select: data => data.databases,
  });
}

export function useCollections(
  conn: string | null,
  db: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: keys.collections(conn ?? '', db ?? ''),
    queryFn: () =>
      api<{collections: CollectionInfo[]}>(
        'GET',
        `${dbPath(conn!, db!)}/collections`,
      ),
    enabled: Boolean(conn && db && enabled),
    select: data => data.collections,
  });
}

export function useOverview(conn: string | null) {
  return useQuery({
    queryKey: keys.overview(conn ?? ''),
    queryFn: () => api<Overview>('GET', `/conn/${enc(conn!)}/overview`),
    enabled: Boolean(conn),
  });
}

export function useStatus(conn: string | null) {
  return useQuery({
    queryKey: keys.status(conn ?? ''),
    queryFn: () =>
      api<{connected: boolean; latencyMs: number | null; message?: string}>(
        'GET',
        `/conn/${enc(conn!)}/status`,
      ),
    enabled: Boolean(conn),
    refetchInterval: 30_000,
  });
}

export function useSchema(conn: string, db: string, coll: string) {
  return useQuery({
    queryKey: keys.schema(conn, db, coll),
    queryFn: () =>
      api<{sampleSize: number; fields: FieldInfo[]}>(
        'GET',
        `${collPath(conn, db, coll)}/schema`,
      ),
    staleTime: 60_000,
  });
}

export function useRefreshAll() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries(), [client]);
}
