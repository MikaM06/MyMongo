import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {parse, requireAdmin, requireSession} from '../lib/http.js';

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export async function auditRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/audit', async request => {
    requireAdmin(request);
    const {limit} = parse(auditQuery, request.query);
    return {entries: await ctx.audit.recent(limit)};
  });

  app.get('/settings', async request => {
    requireSession(request);
    return {
      version: ctx.version,
      environment: ctx.config.env,
      limits: {
        maxImportMb: ctx.config.maxImportMb,
        maxExportDocs: ctx.config.maxExportDocs,
        queryTimeoutMs: ctx.config.queryTimeoutMs,
        maxPageSize: 1000,
        maxAggregateResults: 1000,
      },
      session: {
        ttlMinutes: ctx.config.sessionTtlMinutes,
        idleMinutes: ctx.config.sessionIdleMinutes,
        secureCookies: ctx.config.secureCookies,
      },
    };
  });
}
