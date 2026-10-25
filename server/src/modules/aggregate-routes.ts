import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {assertSafePipeline, pipelineWritesData} from '../lib/guard.js';
import {
  auditBase,
  collParams,
  isAdmin,
  parse,
  requireSession,
  timed,
} from '../lib/http.js';
import {parsePipelineText} from '../lib/mongo-syntax.js';
import {toWire} from '../lib/wire.js';

const aggregateBody = z.object({
  pipeline: z.string().min(1).max(500_000),
  limit: z.number().int().min(1).max(1000).default(100),
});

export async function aggregateRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.post(
    '/conn/:conn/databases/:db/collections/:coll/aggregate',
    async request => {
      requireSession(request);
      const params = parse(collParams, request.params);
      const body = parse(aggregateBody, request.body);
      const pipeline = parsePipelineText(body.pipeline);
      assertSafePipeline(pipeline, isAdmin(request));
      const writes = pipelineWritesData(pipeline);
      const stages = writes
        ? pipeline
        : [...pipeline, {$limit: body.limit + 1}];
      const collection = (await ctx.registry.client(params.conn))
        .db(params.db)
        .collection(params.coll);
      const {result, durationMs} = await timed(() =>
        collection
          .aggregate(stages, {
            maxTimeMS: ctx.config.queryTimeoutMs,
            allowDiskUse: true,
            promoteValues: false,
          })
          .toArray(),
      );
      if (writes) {
        ctx.audit.record({
          ...auditBase(request, params),
          action: 'aggregate.write',
          outcome: 'success',
          details: {stages: pipeline.length},
        });
      }
      const truncated = !writes && result.length > body.limit;
      return {
        documents: result.slice(0, body.limit).map(toWire),
        truncated,
        wrote: writes,
        durationMs,
      };
    },
  );
}
