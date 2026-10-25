import {readFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';

export interface ConnectionConfig {
  id: string;
  label: string;
  uri: string;
}

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  webDir: string;
  trustProxy: boolean;
  secureCookies: boolean;
  allowedOrigins: string[];
  sessionTtlMinutes: number;
  sessionIdleMinutes: number;
  maxImportMb: number;
  maxExportDocs: number;
  queryTimeoutMs: number;
  logLevel: string;
  connections: ConnectionConfig[];
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  MYMONGO_DATA_DIR: z.string().min(1).default('./data'),
  MYMONGO_WEB_DIR: z.string().optional(),
  MYMONGO_TRUST_PROXY: z.stringbool().default(false),
  MYMONGO_SECURE_COOKIES: z.stringbool().optional(),
  MYMONGO_ALLOWED_ORIGINS: z.string().default(''),
  MYMONGO_SESSION_TTL_MINUTES: z.coerce.number().int().min(5).default(480),
  MYMONGO_SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(60),
  MYMONGO_MAX_IMPORT_MB: z.coerce.number().int().min(1).max(256).default(16),
  MYMONGO_MAX_EXPORT_DOCS: z.coerce
    .number()
    .int()
    .min(1)
    .max(5_000_000)
    .default(100_000),
  MYMONGO_QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(600_000)
    .default(15_000),
  MYMONGO_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const CONNECTION_KEY = /^MYMONGO_CONNECTION_([A-Z0-9_]+?)_URI(_FILE)?$/;
const URI_PREFIX = /^mongodb(\+srv)?:\/\//;

function readSecret(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const file = env[`${key}_FILE`];
  if (file) {
    return readFileSync(file, 'utf8').trim();
  }
  const value = env[key]?.trim();
  return value || undefined;
}

function toConnectionId(raw: string): string {
  return raw.toLowerCase().replace(/_/g, '-');
}

export function loadConnections(env: NodeJS.ProcessEnv): ConnectionConfig[] {
  const connections = new Map<string, ConnectionConfig>();
  const defaultUri = readSecret(env, 'MONGODB_URI');
  if (defaultUri) {
    connections.set('default', {
      id: 'default',
      label: env.MONGODB_LABEL?.trim() || 'MongoDB',
      uri: defaultUri,
    });
  }
  for (const key of Object.keys(env).sort()) {
    const match = CONNECTION_KEY.exec(key);
    if (!match) {
      continue;
    }
    const name = match[1];
    const uri = readSecret(env, `MYMONGO_CONNECTION_${name}_URI`);
    if (!uri) {
      continue;
    }
    const id = toConnectionId(name);
    connections.set(id, {
      id,
      label: env[`MYMONGO_CONNECTION_${name}_LABEL`]?.trim() || id,
      uri,
    });
  }
  for (const connection of connections.values()) {
    if (!URI_PREFIX.test(connection.uri)) {
      throw new Error(
        `Connexion "${connection.id}" : l'URI doit commencer par mongodb:// ou mongodb+srv://`,
      );
    }
  }
  return [...connections.values()];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuration invalide : ${issues}`);
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === 'production';
  return {
    env: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    dataDir: path.resolve(values.MYMONGO_DATA_DIR),
    webDir: path.resolve(
      values.MYMONGO_WEB_DIR ??
        path.join(import.meta.dirname, '..', '..', 'web', 'dist'),
    ),
    trustProxy: values.MYMONGO_TRUST_PROXY,
    secureCookies: values.MYMONGO_SECURE_COOKIES ?? isProduction,
    allowedOrigins: values.MYMONGO_ALLOWED_ORIGINS.split(',')
      .map(origin => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
    sessionTtlMinutes: values.MYMONGO_SESSION_TTL_MINUTES,
    sessionIdleMinutes: values.MYMONGO_SESSION_IDLE_MINUTES,
    maxImportMb: values.MYMONGO_MAX_IMPORT_MB,
    maxExportDocs: values.MYMONGO_MAX_EXPORT_DOCS,
    queryTimeoutMs: values.MYMONGO_QUERY_TIMEOUT_MS,
    logLevel: values.MYMONGO_LOG_LEVEL,
    connections: loadConnections(env),
  };
}
