import type {FastifyInstance} from 'fastify';
import {BSON, type Document} from 'mongodb';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {badRequest, notFound} from '../lib/errors.js';
import {assertSafeExpression} from '../lib/guard.js';
import {
  auditBase,
  type CollParams,
  collParams,
  parse,
  requireAdmin,
  requireSession,
  timed,
} from '../lib/http.js';
import {parseDocumentText, parseMongoValue} from '../lib/mongo-syntax.js';
import {analyzeFields, querySchema, resolveQuery} from '../lib/query.js';
import {toWire} from '../lib/wire.js';

const MAX_DOCUMENT_TEXT = 16 * 1024 * 1024;
const BASE = '/conn/:conn/databases/:db/collections/:coll';

const findBody = querySchema.extend({
  skip: z.number().int().min(0).max(100_000_000).default(0),
  limit: z.number().int().min(1).max(1000).default(20),
  count: z.boolean().default(true),
});

const idBody = z.object({id: z.string().min(1).max(10_000)});
const insertBody = z.object({
  document: z.string().min(1).max(MAX_DOCUMENT_TEXT),
});
const replaceBody = idBody.extend({
  document: z.string().min(1).max(MAX_DOCUMENT_TEXT),
});
const deleteManyBody = z.object({
  filter: z.string().max(200_000).optional(),
  confirm: z.string(),
});

function parseId(text: string): unknown {
  const value = parseMongoValue(text);
  if (value === undefined) {
    throw badRequest('Identifiant _id invalide.');
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return (
    BSON.EJSON.stringify({v: a as Document}, {relaxed: false}) ===
    BSON.EJSON.stringify({v: b as Document}, {relaxed: false})
  );
}

export async function documentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const collectionOf = async (params: CollParams) =>
    (await ctx.registry.client(params.conn))
      .db(params.db)
      .collection(params.coll);

  app.post(`${BASE}/find`, async request => {
    requireSession(request);
    const params = parse(collParams, request.params);
    const body = parse(findBody, request.body);
    const collection = await collectionOf(params);
    const query = await resolveQuery(collection, body);
    const timeout = ctx.config.queryTimeoutMs;
    const {result: documents, durationMs} = await timed(() =>
      collection
        .find(query.filter, {
          projection: query.projection,
          sort: query.sort,
          skip: body.skip,
          limit: body.limit,
          maxTimeMS: timeout,
          promoteValues: false,
          allowDiskUse: true,
        })
        .toArray(),
    );
    let total: number | null = null;
    let totalExact = false;
    if (body.count) {
      const empty = Object.keys(query.filter).length === 0;
      if (empty) {
        total = await collection
          .estimatedDocumentCount({maxTimeMS: 5_000})
          .catch(() => null);
      }
      if (total === null) {
        total = await collection
          .countDocuments(query.filter, {maxTimeMS: 5_000})
          .catch(() => null);
        totalExact = total !== null;
      }
    }
    return {
      documents: documents.map(toWire),
      total,
      totalExact,
      durationMs,
    };
  });

  app.post(`${BASE}/document`, async request => {
    requireSession(request);
    const params = parse(collParams, request.params);
    const body = parse(idBody, request.body);
    const collection = await collectionOf(params);
    const document = await collection.findOne(
      {_id: parseId(body.id) as never},
      {promoteValues: false, maxTimeMS: ctx.config.queryTimeoutMs},
    );
    if (!document) {
      throw notFound('Document introuvable.');
    }
    return {document: toWire(document)};
  });

  app.get(`${BASE}/schema`, async request => {
    requireSession(request);
    const params = parse(collParams, request.params);
    const collection = await collectionOf(params);
    const sample = await collection
      .aggregate([{$sample: {size: 200}}], {
        maxTimeMS: 10_000,
        promoteValues: false,
      })
      .toArray()
      .catch(() => collection.find({}, {limit: 200}).toArray());
    return {sampleSize: sample.length, fields: analyzeFields(sample)};
  });

  app.post(`${BASE}/documents`, async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(insertBody, request.body);
    const document = parseDocumentText(body.document, 'Document');
    const collection = await collectionOf(params);
    const result = await collection.insertOne(document);
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'document.insert',
      outcome: 'success',
    });
    return {insertedId: toWire(result.insertedId)};
  });

  app.put(`${BASE}/documents`, async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(replaceBody, request.body);
    const id = parseId(body.id);
    const document = parseDocumentText(body.document, 'Document');
    if ('_id' in document) {
      if (!sameValue(document._id, id)) {
        throw badRequest(
          'Le champ _id ne peut pas être modifié. Dupliquez le document pour en créer un nouveau.',
        );
      }
      delete document._id;
    }
    const collection = await collectionOf(params);
    const result = await collection.replaceOne({_id: id as never}, document);
    if (result.matchedCount === 0) {
      throw notFound('Document introuvable : il a peut-être été supprimé.');
    }
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'document.update',
      outcome: 'success',
    });
    return {matched: result.matchedCount, modified: result.modifiedCount};
  });

  app.delete(`${BASE}/documents`, async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(idBody, request.body);
    const collection = await collectionOf(params);
    const result = await collection.deleteOne({_id: parseId(body.id) as never});
    if (result.deletedCount === 0) {
      throw notFound('Document introuvable.');
    }
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'document.delete',
      outcome: 'success',
    });
    return {deleted: result.deletedCount};
  });

  app.post(`${BASE}/delete-many`, async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(deleteManyBody, request.body);
    if (body.confirm !== params.coll) {
      throw badRequest(
        'Confirmation incorrecte : saisissez le nom exact de la collection.',
      );
    }
    const filter = parseDocumentText(body.filter, 'Filtre');
    assertSafeExpression(filter, 'Filtre');
    const collection = await collectionOf(params);
    const result = await collection.deleteMany(filter);
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'document.deleteMany',
      outcome: 'success',
      details: {
        deleted: result.deletedCount,
        filtered: Object.keys(filter).length > 0,
      },
    });
    return {deleted: result.deletedCount};
  });
}
