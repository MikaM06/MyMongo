import {Readable} from 'node:stream';
import type {FastifyInstance} from 'fastify';
import {
  type AnyBulkWriteOperation,
  type Collection,
  type Document,
  MongoBulkWriteError,
} from 'mongodb';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {badRequest} from '../lib/errors.js';
import {
  auditBase,
  collParams,
  parse,
  requireAdmin,
  requireSession,
} from '../lib/http.js';
import {querySchema, resolveQuery} from '../lib/query.js';
import {
  csvHeader,
  csvLine,
  FORMATS,
  flattenWire,
  type ImportIssue,
  parseImport,
} from '../lib/transfer.js';
import {toWire} from '../lib/wire.js';

const BASE = '/conn/:conn/databases/:db/collections/:coll';
const MAX_IMPORT_DOCS = 500_000;
const BATCH_SIZE = 1_000;
const CSV_HEADER_SAMPLE = 1_000;

const importBody = z.object({
  format: z.enum(FORMATS),
  content: z.string().min(1),
});

const runImportBody = importBody.extend({
  mode: z.enum(['insert', 'upsert']).default('insert'),
});

const exportBody = querySchema.extend({
  format: z.enum(FORMATS),
  limit: z.number().int().min(1).optional(),
});

interface ImportReport {
  inserted: number;
  upserted: number;
  replaced: number;
  failed: number;
  errors: ImportIssue[];
}

async function writeBatch(
  collection: Collection,
  batch: Document[],
  mode: 'insert' | 'upsert',
  offset: number,
  report: ImportReport,
): Promise<void> {
  const operations: AnyBulkWriteOperation[] = batch.map(document =>
    mode === 'upsert' && document._id !== undefined
      ? {
          replaceOne: {
            filter: {_id: document._id},
            replacement: document,
            upsert: true,
          },
        }
      : {insertOne: {document}},
  );
  try {
    const result = await collection.bulkWrite(operations, {ordered: false});
    report.inserted += result.insertedCount;
    report.upserted += result.upsertedCount;
    report.replaced += result.modifiedCount;
  } catch (error) {
    if (!(error instanceof MongoBulkWriteError)) {
      throw error;
    }
    report.inserted += error.result.insertedCount;
    report.upserted += error.result.upsertedCount;
    report.replaced += error.result.modifiedCount;
    const writeErrors = Array.isArray(error.writeErrors)
      ? error.writeErrors
      : [error.writeErrors];
    report.failed += writeErrors.length;
    for (const writeError of writeErrors) {
      if (report.errors.length < 100) {
        report.errors.push({
          line: null,
          message: `Document ${offset + writeError.index + 1} : ${
            writeError.code === 11000 ? 'clé dupliquée' : writeError.errmsg
          }`,
        });
      }
    }
  }
}

export async function transferRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const maxChars = ctx.config.maxImportMb * 1024 * 1024;
  const collectionOf = async (params: z.infer<typeof collParams>) =>
    (await ctx.registry.client(params.conn))
      .db(params.db)
      .collection(params.coll);

  const parseContent = (format: (typeof FORMATS)[number], content: string) => {
    if (content.length > maxChars) {
      throw badRequest(
        `Fichier trop volumineux : la limite est de ${ctx.config.maxImportMb} Mo.`,
      );
    }
    return parseImport(format, content, MAX_IMPORT_DOCS);
  };

  app.post(`${BASE}/import/preview`, async request => {
    requireSession(request);
    parse(collParams, request.params);
    const body = parse(importBody, request.body);
    const parsed = parseContent(body.format, body.content);
    return {
      total: parsed.total,
      valid: parsed.documents.length,
      preview: parsed.documents.slice(0, 10).map(toWire),
      withId: parsed.documents.filter(doc => doc._id !== undefined).length,
      errors: parsed.errors,
    };
  });

  app.post(`${BASE}/import`, async request => {
    requireAdmin(request);
    const params = parse(collParams, request.params);
    const body = parse(runImportBody, request.body);
    const parsed = parseContent(body.format, body.content);
    if (parsed.errors.length) {
      throw badRequest(
        'Le fichier contient des erreurs : corrigez-les avant d’importer.',
        {errors: parsed.errors},
      );
    }
    if (!parsed.documents.length) {
      throw badRequest('Aucun document à importer.');
    }
    const collection = await collectionOf(params);
    const report: ImportReport = {
      inserted: 0,
      upserted: 0,
      replaced: 0,
      failed: 0,
      errors: [],
    };
    for (let i = 0; i < parsed.documents.length; i += BATCH_SIZE) {
      await writeBatch(
        collection,
        parsed.documents.slice(i, i + BATCH_SIZE),
        body.mode,
        i,
        report,
      );
    }
    ctx.audit.record({
      ...auditBase(request, params),
      action: 'collection.import',
      outcome: report.failed ? 'failure' : 'success',
      details: {
        format: body.format,
        mode: body.mode,
        inserted: report.inserted,
        upserted: report.upserted,
        replaced: report.replaced,
        failed: report.failed,
      },
    });
    return report;
  });

  app.post(`${BASE}/export`, async (request, reply) => {
    requireSession(request);
    const params = parse(collParams, request.params);
    const body = parse(exportBody, request.body);
    const collection = await collectionOf(params);
    const query = await resolveQuery(collection, body);
    const limit = Math.min(
      body.limit ?? ctx.config.maxExportDocs,
      ctx.config.maxExportDocs,
    );
    const cursor = collection.find(query.filter, {
      projection: query.projection,
      sort: query.sort,
      limit,
      batchSize: 500,
      promoteValues: false,
      allowDiskUse: true,
    });
    let exported = 0;
    async function* generate(): AsyncGenerator<string> {
      try {
        if (body.format === 'csv') {
          const flatten = (document: Document) =>
            flattenWire(toWire(document) as Record<string, unknown>);
          const iterator = cursor[Symbol.asyncIterator]();
          const head: Record<string, unknown>[] = [];
          while (head.length < CSV_HEADER_SAMPLE) {
            const next = await iterator.next();
            if (next.done) {
              break;
            }
            head.push(flatten(next.value));
          }
          const headers = csvHeader(head);
          yield `${headers.join(',')}\n`;
          for (const row of head) {
            exported++;
            yield `${csvLine(headers, row)}\n`;
          }
          for (;;) {
            const next = await iterator.next();
            if (next.done) {
              break;
            }
            exported++;
            yield `${csvLine(headers, flatten(next.value))}\n`;
          }
        } else {
          if (body.format === 'json') {
            yield '[\n';
          }
          for await (const document of cursor) {
            const line = JSON.stringify(toWire(document));
            if (body.format === 'json') {
              yield exported ? `,\n${line}` : line;
            } else {
              yield `${line}\n`;
            }
            exported++;
          }
          if (body.format === 'json') {
            yield '\n]\n';
          }
        }
      } finally {
        await cursor.close();
        ctx.audit.record({
          ...auditBase(request, params),
          action: 'collection.export',
          outcome: 'success',
          details: {format: body.format, exported},
        });
      }
    }
    const types = {
      json: 'application/json',
      ndjson: 'application/x-ndjson',
      csv: 'text/csv',
    };
    const extension = body.format === 'ndjson' ? 'jsonl' : body.format;
    const filename = `${params.db}.${params.coll}.${extension}`.replace(
      /[^A-Za-z0-9._-]/g,
      '_',
    );
    return reply
      .header('Content-Type', `${types[body.format]}; charset=utf-8`)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Export-Limit', String(limit))
      .send(Readable.from(generate()));
  });
}
