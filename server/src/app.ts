import {existsSync} from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import {z} from 'zod';
import {AvatarFiles} from './auth/avatars.js';
import {FailureLimiter} from './auth/rate-limit.js';
import {safeEqual, SessionStore} from './auth/sessions.js';
import {credentialStamp, UserStore} from './auth/users.js';
import type {Config} from './config.js';
import {AuditLog} from './lib/audit.js';
import {
  forbidden,
  fromMongoError,
  HttpError,
  isMongoError,
  unauthorized,
} from './lib/errors.js';
import {formatZodError} from './lib/http.js';
import {SyntaxParseError} from './lib/mongo-syntax.js';
import {aggregateRoutes} from './modules/aggregate-routes.js';
import {auditRoutes} from './modules/audit-routes.js';
import {authRoutes} from './modules/auth-routes.js';
import {avatarRoutes} from './modules/avatar-routes.js';
import {databaseRoutes} from './modules/database-routes.js';
import {documentRoutes} from './modules/document-routes.js';
import {indexRoutes} from './modules/index-routes.js';
import {mongoUserRoutes} from './modules/mongo-user-routes.js';
import {serverRoutes} from './modules/server-routes.js';
import {toolRoutes} from './modules/tool-routes.js';
import {transferRoutes} from './modules/transfer-routes.js';
import {userRoutes} from './modules/user-routes.js';
import {ConnectionRegistry} from './mongo/registry.js';

export interface AppContext {
  config: Config;
  users: UserStore;
  avatars: AvatarFiles;
  sessions: SessionStore;
  loginLimiter: FailureLimiter;
  ipLimiter: FailureLimiter;
  registry: ConnectionRegistry;
  audit: AuditLog;
  cookieName: string;
  version: string;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VERSION = '1.0.0';

function toHttpError(error: unknown): HttpError | undefined {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof SyntaxParseError) {
    return new HttpError(400, 'SYNTAX_ERROR', error.message, {
      line: error.line,
      column: error.column,
    });
  }
  if (error instanceof z.ZodError) {
    return new HttpError(400, 'VALIDATION_ERROR', formatZodError(error));
  }
  if (isMongoError(error)) {
    return fromMongoError(error);
  }
  const fastifyError = error as FastifyError;
  if (
    typeof fastifyError.statusCode === 'number' &&
    fastifyError.statusCode < 500
  ) {
    const messages: Record<number, string> = {
      400: 'Requête invalide',
      413: 'Requête trop volumineuse',
      415: 'Type de contenu non pris en charge',
    };
    return new HttpError(
      fastifyError.statusCode,
      fastifyError.code ?? 'REQUEST_ERROR',
      messages[fastifyError.statusCode] ?? fastifyError.message,
    );
  }
  return undefined;
}

function isAllowedOrigin(
  request: FastifyRequest,
  allowedOrigins: string[],
): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return request.headers['sec-fetch-site'] !== 'cross-site';
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  try {
    return new URL(origin).host === request.host;
  } catch {
    return false;
  }
}

export async function buildApp(config: Config): Promise<{
  app: FastifyInstance;
  context: AppContext;
}> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: (config.maxImportMb + 1) * 1024 * 1024,
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-csrf-token"]',
          'body.password',
        ],
        censor: '[masqué]',
      },
      transport:
        config.env === 'development'
          ? {target: 'pino-pretty', options: {translateTime: 'HH:MM:ss'}}
          : undefined,
    },
  });

  const users = new UserStore(config.dataDir);
  await users.load();
  const context: AppContext = {
    config,
    users,
    avatars: new AvatarFiles(config.dataDir),
    sessions: new SessionStore({
      ttlMs: config.sessionTtlMinutes * 60_000,
      idleMs: config.sessionIdleMinutes * 60_000,
    }),
    loginLimiter: new FailureLimiter({maxFailures: 5, windowMs: 15 * 60_000}),
    ipLimiter: new FailureLimiter({maxFailures: 30, windowMs: 15 * 60_000}),
    registry: new ConnectionRegistry(config.connections),
    audit: new AuditLog(config.dataDir, app.log),
    cookieName: config.secureCookies ? '__Host-mymongo' : 'mymongo_session',
    version: VERSION,
  };

  const sweeper = setInterval(() => {
    context.sessions.sweep();
    context.loginLimiter.sweep();
    context.ipLimiter.sweep();
  }, 60_000);
  sweeper.unref();

  app.addHook('onClose', async () => {
    clearInterval(sweeper);
    await context.audit.flush();
    await context.registry.closeAll();
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        workerSrc: ["'self'", 'blob:'],
      },
    },
    hsts: config.secureCookies
      ? {maxAge: 31_536_000, includeSubDomains: true}
      : false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(fastifyCookie);

  app.decorateRequest('session', undefined);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }
    reply.header('Cache-Control', 'no-store');
    const unsafe = UNSAFE_METHODS.has(request.method);
    if (unsafe && !isAllowedOrigin(request, config.allowedOrigins)) {
      throw forbidden('Origine de la requête non autorisée.');
    }
    let session = context.sessions.get(request.cookies[context.cookieName]);
    if (session) {
      await context.users.refresh();
      const user = context.users.find(session.username);
      if (!user || credentialStamp(user) !== session.stamp) {
        context.sessions.destroy(session.id);
        session = undefined;
      } else {
        session.role = user.role;
        request.session = session;
      }
    }
    if (request.routeOptions.config?.public) {
      return;
    }
    if (!session) {
      throw unauthorized('Session expirée ou absente. Reconnectez-vous.');
    }
    if (unsafe) {
      const token = request.headers['x-csrf-token'];
      if (typeof token !== 'string' || !safeEqual(token, session.csrfToken)) {
        throw forbidden('Jeton CSRF invalide. Rechargez la page.');
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const http = toHttpError(error);
    if (!http) {
      request.log.error({err: error}, 'Erreur non gérée');
      return reply.status(500).send({
        error: {code: 'INTERNAL', message: 'Erreur interne du serveur.'},
      });
    }
    if (http.statusCode >= 500) {
      request.log.warn({code: http.code}, http.message);
    }
    if (http.statusCode === 429) {
      const details = http.details as {retryAfterSeconds?: number} | undefined;
      reply.header('Retry-After', String(details?.retryAfterSeconds ?? 60));
    }
    return reply.status(http.statusCode).send({
      error: {code: http.code, message: http.message, details: http.details},
    });
  });

  app.get('/api/health', {config: {public: true}}, async () => ({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  await app.register(
    async api => {
      await authRoutes(api, context);
      await avatarRoutes(api, context);
      await userRoutes(api, context);
      await auditRoutes(api, context);
      await serverRoutes(api, context);
      await databaseRoutes(api, context);
      await documentRoutes(api, context);
      await aggregateRoutes(api, context);
      await indexRoutes(api, context);
      await transferRoutes(api, context);
      await toolRoutes(api);
      await mongoUserRoutes(api, context);
    },
    {prefix: '/api'},
  );

  const indexFile = path.join(config.webDir, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      wildcard: false,
      cacheControl: false,
      setHeaders(res, filePath) {
        res.header(
          'Cache-Control',
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      existsSync(indexFile)
    ) {
      return reply
        .header('Cache-Control', 'no-cache')
        .sendFile('index.html', config.webDir, {cacheControl: false});
    }
    return reply.status(404).send({
      error: {code: 'NOT_FOUND', message: 'Ressource introuvable.'},
    });
  });

  return {app, context};
}
