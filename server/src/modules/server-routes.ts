import type {FastifyInstance} from 'fastify';
import type {Document, MongoClient} from 'mongodb';
import type {AppContext} from '../app.js';
import {connParams, parse, requireSession, timed} from '../lib/http.js';

const MAX_DATABASE_STATS = 200;

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value !== null && typeof value === 'object' && 'toNumber' in value) {
    return (value as {toNumber(): number}).toNumber();
  }
  return null;
}

async function settle<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

export async function listDatabaseNames(
  client: MongoClient,
): Promise<{name: string; sizeOnDisk: number | null; empty: boolean | null}[]> {
  const admin = client.db('admin').admin();
  try {
    const result = await admin.listDatabases({authorizedDatabases: true});
    return result.databases.map(db => ({
      name: db.name,
      sizeOnDisk: numberOrNull(db.sizeOnDisk),
      empty: typeof db.empty === 'boolean' ? db.empty : null,
    }));
  } catch {
    const result = await admin.listDatabases({
      nameOnly: true,
      authorizedDatabases: true,
    });
    return result.databases.map(db => ({
      name: db.name,
      sizeOnDisk: null,
      empty: null,
    }));
  }
}

function sum(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}

export async function serverRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/connections', async request => {
    requireSession(request);
    return {connections: ctx.registry.list()};
  });

  app.get('/conn/:conn/status', async request => {
    requireSession(request);
    const {conn} = parse(connParams, request.params);
    try {
      const client = await ctx.registry.client(conn);
      const {durationMs} = await timed(() =>
        client.db('admin').command({ping: 1}),
      );
      return {connected: true, latencyMs: durationMs};
    } catch (error) {
      return {
        connected: false,
        latencyMs: null,
        message: (error as Error).name.startsWith('Mongo')
          ? 'MongoDB est injoignable.'
          : (error as Error).message,
      };
    }
  });

  app.get('/conn/:conn/overview', async request => {
    requireSession(request);
    const {conn} = parse(connParams, request.params);
    const client = await ctx.registry.client(conn);
    const admin = client.db('admin');
    const {durationMs: latencyMs} = await timed(() => admin.command({ping: 1}));
    const [buildInfo, hello, serverStatus, databases] = await Promise.all([
      settle(() => admin.command({buildInfo: 1})),
      settle(() => admin.command({hello: 1})),
      settle(() =>
        admin.command({serverStatus: 1, repl: 0, metrics: 0, locks: 0}),
      ),
      settle(() => listDatabaseNames(client)),
    ]);
    const stats = databases
      ? await Promise.all(
          databases.slice(0, MAX_DATABASE_STATS).map(async db => {
            const result: Document | null = await settle(() =>
              client.db(db.name).command({dbStats: 1, scale: 1}),
            );
            return {
              name: db.name,
              sizeOnDisk: db.sizeOnDisk,
              collections: numberOrNull(result?.collections),
              views: numberOrNull(result?.views),
              objects: numberOrNull(result?.objects),
              dataSize: numberOrNull(result?.dataSize),
              storageSize: numberOrNull(result?.storageSize),
              indexSize: numberOrNull(result?.indexSize),
            };
          }),
        )
      : null;
    const connections = serverStatus?.connections as Document | undefined;
    const mem = serverStatus?.mem as Document | undefined;
    const storageEngine = serverStatus?.storageEngine as Document | undefined;
    return {
      connected: true,
      latencyMs,
      server: {
        version: (buildInfo?.version as string | undefined) ?? null,
        gitVersion: (buildInfo?.gitVersion as string | undefined) ?? null,
        modules: (buildInfo?.modules as string[] | undefined) ?? null,
        bits: numberOrNull(buildInfo?.bits),
        host: (serverStatus?.host as string | undefined) ?? null,
        process: (serverStatus?.process as string | undefined) ?? null,
        uptimeSeconds: numberOrNull(serverStatus?.uptime),
        storageEngine: (storageEngine?.name as string | undefined) ?? null,
        connectionsCurrent: numberOrNull(connections?.current),
        connectionsAvailable: numberOrNull(connections?.available),
        memoryResidentMb: numberOrNull(mem?.resident),
        replicaSet: (hello?.setName as string | undefined) ?? null,
        isWritablePrimary:
          typeof hello?.isWritablePrimary === 'boolean'
            ? hello.isWritablePrimary
            : null,
        maxBsonObjectSize: numberOrNull(hello?.maxBsonObjectSize),
      },
      opcounters: serverStatus?.opcounters
        ? Object.fromEntries(
            Object.entries(serverStatus.opcounters as Document).map(
              ([key, value]) => [key, numberOrNull(value)],
            ),
          )
        : null,
      totals: stats
        ? {
            databases: databases?.length ?? null,
            collections: sum(stats.map(item => item.collections)),
            documents: sum(stats.map(item => item.objects)),
            dataSize: sum(stats.map(item => item.dataSize)),
            storageSize: sum(stats.map(item => item.storageSize)),
            indexSize: sum(stats.map(item => item.indexSize)),
            partial:
              stats.some(item => item.objects === null) ||
              (databases?.length ?? 0) > MAX_DATABASE_STATS,
          }
        : null,
      databases: stats,
    };
  });
}
