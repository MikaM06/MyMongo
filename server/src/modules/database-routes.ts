import type {FastifyInstance} from 'fastify';
import type {Db, Document} from 'mongodb';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {badRequest, forbidden} from '../lib/errors.js';
import {
  auditBase,
  collParams,
  connParams,
  dbParams,
  parse,
  requireAdmin,
  requireSession,
} from '../lib/http.js';
import {
  databaseName,
  newCollectionName,
  SYSTEM_DATABASES,
} from '../lib/names.js';
import {listDatabaseNames} from './server-routes.js';

const MAX_COLLECTION_STATS = 300;

const createCollectionBody = z.object({
  name: newCollectionName,
  capped: z.boolean().optional(),
  size: z.number().int().positive().max(1e15).optional(),
  max: z.number().int().positive().optional(),
});

const createDatabaseBody = z.object({
  name: databaseName,
  collection: newCollectionName,
});

const renameBody = z.object({name: newCollectionName});
const confirmBody = z.object({confirm: z.string()});

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value !== null && typeof value === 'object' && 'toNumber' in value) {
    return (value as {toNumber(): number}).toNumber();
  }
  return null;
}

export async function collectionStats(
  db: Db,
  name: string,
): Promise<Document | null> {
  try {
    const [result] = await db
      .collection(name)
      .aggregate([{$collStats: {storageStats: {scale: 1}, count: {}}}], {
        maxTimeMS: 5_000,
      })
      .toArray();
    const storage = (result?.storageStats ?? {}) as Document;
    return {
      count: toNumber(storage.count ?? result?.count),
      size: toNumber(storage.size),
      avgObjSize: toNumber(storage.avgObjSize),
      storageSize: toNumber(storage.storageSize),
      totalIndexSize: toNumber(storage.totalIndexSize),
      nindexes: toNumber(storage.nindexes),
      capped: typeof storage.capped === 'boolean' ? storage.capped : null,
    };
  } catch {
    return null;
  }
}

export async function databaseRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/conn/:conn/databases', async request => {
    requireSession(request);
    const {conn} = parse(connParams, request.params);
    const client = await ctx.registry.client(conn);
    const databases = await listDatabaseNames(client);
    return {
      databases: databases
        .map(db => ({...db, system: SYSTEM_DATABASES.has(db.name)}))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  app.post('/conn/:conn/databases', async request => {
    requireAdmin(request);
    const params = parse(connParams, request.params);
    const body = parse(createDatabaseBody, request.body);
    if (SYSTEM_DATABASES.has(body.name)) {
      throw forbidden('Les bases système ne peuvent pas être créées ici.');
    }
    const client = await ctx.registry.client(params.conn);
    await client.db(body.name).createCollection(body.collection);
    ctx.audit.record({
      ...auditBase(request, {...params, db: body.name, coll: body.collection}),
      action: 'database.create',
      outcome: 'success',
    });
    return {ok: true};
  });

  app.delete('/conn/:conn/databases/:db', async request => {
    requireAdmin(request);
    const params = parse(dbParams, request.params);
    const body = parse(confirmBody, request.body);
    if (SYSTEM_DATABASES.has(params.db)) {
      throw forbidden('Les bases système ne peuvent pas être supprimées.');
    }
    if (body.confirm !== params.db) {
      throw badRequest(
        'Confirmation incorrecte : saisissez le nom exact de la base.',
      );
    }
    const client = await ctx.registry.client(params.conn);
    await client.db(params.db).dropDatabase();
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'database.drop',
      outcome: 'success',
    });
    return {ok: true};
  });

  app.get('/conn/:conn/databases/:db/stats', async request => {
    requireSession(request);
    const params = parse(dbParams, request.params);
    const client = await ctx.registry.client(params.conn);
    const stats = await client
      .db(params.db)
      .command({dbStats: 1, scale: 1})
      .catch(() => null);
    return {
      stats: stats
        ? {
            collections: toNumber(stats.collections),
            views: toNumber(stats.views),
            objects: toNumber(stats.objects),
            avgObjSize: toNumber(stats.avgObjSize),
            dataSize: toNumber(stats.dataSize),
            storageSize: toNumber(stats.storageSize),
            indexes: toNumber(stats.indexes),
            indexSize: toNumber(stats.indexSize),
            totalSize: toNumber(stats.totalSize),
          }
        : null,
    };
  });

  app.get('/conn/:conn/databases/:db/collections', async request => {
    requireSession(request);
    const params = parse(dbParams, request.params);
    const query = parse(
      z.object({stats: z.enum(['0', '1']).default('1')}),
      request.query,
    );
    const client = await ctx.registry.client(params.conn);
    const db = client.db(params.db);
    const infos = await db
      .listCollections({}, {nameOnly: false, authorizedCollections: true})
      .toArray();
    infos.sort((a, b) => a.name.localeCompare(b.name));
    const withStats = query.stats === '1';
    const collections = await Promise.all(
      infos.map(async (info, index) => {
        const type = (info.type as string | undefined) ?? 'collection';
        const options = (info as Document).options as Document | undefined;
        const stats =
          withStats && type === 'collection' && index < MAX_COLLECTION_STATS
            ? await collectionStats(db, info.name)
            : null;
        return {
          name: info.name,
          type: options?.timeseries ? 'timeseries' : type,
          readOnly: Boolean((info as Document).info?.readOnly),
          viewOn: (options?.viewOn as string | undefined) ?? null,
          capped: Boolean(options?.capped),
          stats,
        };
      }),
    );
    return {collections};
  });

  app.get(
    '/conn/:conn/databases/:db/collections/:coll/stats',
    async request => {
      requireSession(request);
      const params = parse(collParams, request.params);
      const client = await ctx.registry.client(params.conn);
      return {stats: await collectionStats(client.db(params.db), params.coll)};
    },
  );

  app.post('/conn/:conn/databases/:db/collections', async request => {
    requireAdmin(request);
    const params = parse(dbParams, request.params);
    const body = parse(createCollectionBody, request.body);
    if (body.capped && !body.size) {
      throw badRequest(
        'Une collection plafonnée nécessite une taille maximale.',
      );
    }
    const client = await ctx.registry.client(params.conn);
    await client.db(params.db).createCollection(
      body.name,
      body.capped
        ? {
            capped: true,
            size: body.size,
            ...(body.max ? {max: body.max} : {}),
          }
        : {},
    );
    ctx.audit.record({
      ...auditBase(request, {...params, coll: body.name}),
      action: 'collection.create',
      outcome: 'success',
      details: {capped: Boolean(body.capped)},
    });
    return {ok: true};
  });

  app.patch('/conn/:conn/databases/:db/collections/:coll', async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(renameBody, request.body);
    const client = await ctx.registry.client(params.conn);
    await client
      .db(params.db)
      .collection(params.coll)
      .rename(body.name, {dropTarget: false});
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'collection.rename',
      outcome: 'success',
      details: {newName: body.name},
    });
    return {ok: true};
  });

  app.delete('/conn/:conn/databases/:db/collections/:coll', async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(confirmBody, request.body);
    if (body.confirm !== params.coll) {
      throw badRequest(
        'Confirmation incorrecte : saisissez le nom exact de la collection.',
      );
    }
    const client = await ctx.registry.client(params.conn);
    await client.db(params.db).collection(params.coll).drop();
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'collection.drop',
      outcome: 'success',
    });
    return {ok: true};
  });
}
