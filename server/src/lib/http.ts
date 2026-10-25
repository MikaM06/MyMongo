import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Session} from '../auth/sessions.js';
import type {AuditEntry} from './audit.js';
import {badRequest, forbidden, unauthorized} from './errors.js';
import {collectionName, connectionId, databaseName} from './names.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => {
      const where = issue.path.length ? `${issue.path.join('.')} : ` : '';
      return `${where}${issue.message}`;
    })
    .join(' · ');
}

export function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(formatZodError(result.error));
  }
  return result.data;
}

export function requireSession(request: FastifyRequest): Session {
  if (!request.session) {
    throw unauthorized();
  }
  return request.session;
}

export function requireAdmin(request: FastifyRequest): Session {
  const session = requireSession(request);
  if (session.role !== 'admin') {
    throw forbidden(
      'Votre compte est en lecture seule : cette action nécessite le rôle administrateur.',
    );
  }
  return session;
}

export function isAdmin(request: FastifyRequest): boolean {
  return request.session?.role === 'admin';
}

export const connParams = z.object({conn: connectionId});
export const dbParams = connParams.extend({db: databaseName});
export const collParams = dbParams.extend({coll: collectionName});

export type CollParams = z.infer<typeof collParams>;

export function auditBase(
  request: FastifyRequest,
  params?: {conn?: string; db?: string; coll?: string},
): Pick<AuditEntry, 'user' | 'ip' | 'connection' | 'database' | 'collection'> {
  return {
    user: request.session?.username ?? 'anonyme',
    ip: request.ip,
    connection: params?.conn,
    database: params?.db,
    collection: params?.coll,
  };
}

export async function timed<T>(
  run: () => Promise<T>,
): Promise<{result: T; durationMs: number}> {
  const start = performance.now();
  const result = await run();
  return {
    result,
    durationMs: Math.round((performance.now() - start) * 10) / 10,
  };
}
