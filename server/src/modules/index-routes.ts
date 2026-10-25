import type {FastifyInstance} from 'fastify';
import type {CreateIndexesOptions, Document, IndexSpecification} from 'mongodb';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {badRequest, forbidden} from '../lib/errors.js';
import {assertSafeExpression} from '../lib/guard.js';
import {
  auditBase,
  collParams,
  parse,
  requireAdmin,
  requireSession,
} from '../lib/http.js';
import {parseDocumentText} from '../lib/mongo-syntax.js';
import {indexName} from '../lib/names.js';
import {toWire} from '../lib/wire.js';

const BASE = '/conn/:conn/databases/:db/collections/:coll/indexes';

const keySchema = z.object({
  field: z
    .string()
    .trim()
    .min(1, 'Nom de champ requis')
    .max(1024)
    .refine(field => !field.startsWith('$') || field === '$**', {
      message: 'Un nom de champ ne peut pas commencer par $',
    }),
  type: z.enum(['1', '-1', 'text', '2dsphere', 'hashed']),
});

const createBody = z.object({
  keys: z.array(keySchema).min(1).max(32),
  name: indexName.optional(),
  unique: z.boolean().default(false),
  sparse: z.boolean().default(false),
  hidden: z.boolean().default(false),
  expireAfterSeconds: z.number().int().min(0).max(2_147_483_647).optional(),
  partialFilterExpression: z.string().max(100_000).optional(),
});

export async function indexRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const collectionOf = async (params: z.infer<typeof collParams>) =>
    (await ctx.registry.client(params.conn))
      .db(params.db)
      .collection(params.coll);

  app.get(BASE, async request => {
    requireSession(request);
    const params = parse(collParams, request.params);
    const collection = await collectionOf(params);
    const indexes = await collection.listIndexes().toArray();
    const usage = new Map<string, {ops: number; since: string | null}>();
    try {
      const stats = await collection
        .aggregate([{$indexStats: {}}], {maxTimeMS: 5_000})
        .toArray();
      for (const stat of stats) {
        const accesses = stat.accesses as Document | undefined;
        usage.set(stat.name as string, {
          ops: Number(accesses?.ops ?? 0),
          since:
            accesses?.since instanceof Date
              ? accesses.since.toISOString()
              : null,
        });
      }
    } catch {
      usage.clear();
    }
    let sizes: Record<string, number> = {};
    try {
      const [stats] = await collection
        .aggregate([{$collStats: {storageStats: {}}}], {maxTimeMS: 5_000})
        .toArray();
      sizes = ((stats?.storageStats as Document | undefined)?.indexSizes ??
        {}) as Record<string, number>;
    } catch {
      sizes = {};
    }
    return {
      indexes: indexes.map(index => {
        const {key, name, v, ...options} = index;
        return {
          name,
          key: toWire(key),
          version: v ?? null,
          unique: Boolean(options.unique),
          sparse: Boolean(options.sparse),
          hidden: Boolean(options.hidden),
          expireAfterSeconds:
            typeof options.expireAfterSeconds === 'number'
              ? options.expireAfterSeconds
              : null,
          partialFilterExpression: options.partialFilterExpression
            ? toWire(options.partialFilterExpression)
            : null,
          options: toWire(options),
          size: typeof sizes[name] === 'number' ? sizes[name] : null,
          usage: usage.get(name) ?? null,
          protected: name === '_id_',
        };
      }),
    };
  });

  app.post(BASE, async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(createBody, request.body);
    const spec: Record<string, 1 | -1 | string> = {};
    for (const key of body.keys) {
      if (key.field in spec) {
        throw badRequest(`Le champ « ${key.field} » apparaît deux fois.`);
      }
      spec[key.field] =
        key.type === '1' ? 1 : key.type === '-1' ? -1 : key.type;
    }
    if (body.unique && body.keys.some(key => key.type === 'hashed')) {
      throw badRequest('Un index haché ne peut pas être unique.');
    }
    const options: CreateIndexesOptions = {};
    if (body.unique) {
      options.unique = true;
    }
    if (body.sparse) {
      options.sparse = true;
    }
    if (body.hidden) {
      options.hidden = true;
    }
    if (body.expireAfterSeconds !== undefined) {
      options.expireAfterSeconds = body.expireAfterSeconds;
    }
    if (body.name) {
      options.name = body.name;
    }
    if (body.partialFilterExpression?.trim()) {
      const partial = parseDocumentText(
        body.partialFilterExpression,
        'Filtre partiel',
      );
      assertSafeExpression(partial, 'Filtre partiel');
      options.partialFilterExpression = partial;
    }
    const collection = await collectionOf(params);
    const name = await collection.createIndex(
      spec as IndexSpecification,
      options,
    );
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'index.create',
      outcome: 'success',
      details: {index: name, unique: body.unique},
    });
    return {name};
  });

  app.delete(`${BASE}/:name`, async request => {
    requireAdmin(request);
    const params = parse(collParams.extend({name: indexName}), request.params);
    if (params.name === '_id_') {
      throw forbidden(
        "L'index _id_ est obligatoire et ne peut pas être supprimé.",
      );
    }
    const collection = await collectionOf(params);
    await collection.dropIndex(params.name);
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'index.drop',
      outcome: 'success',
      details: {index: params.name},
    });
    return {ok: true};
  });
}
