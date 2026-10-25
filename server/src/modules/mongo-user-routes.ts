import type {FastifyInstance} from 'fastify';
import type {Document, MongoClient} from 'mongodb';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {validatePasswordStrength} from '../auth/password.js';
import {badRequest, forbidden} from '../lib/errors.js';
import {auditBase, connParams, parse, requireAdmin} from '../lib/http.js';
import {
  databaseName,
  newCollectionName,
  SYSTEM_DATABASES,
} from '../lib/names.js';

const ADMIN_ONLY_ROLES = new Set([
  'readAnyDatabase',
  'readWriteAnyDatabase',
  'dbAdminAnyDatabase',
  'userAdminAnyDatabase',
  'clusterMonitor',
  'clusterManager',
  'clusterAdmin',
  'backup',
  'restore',
  'root',
]);

const mongoUsername = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9._@-]{1,64}$/,
    'Nom d’utilisateur : 1 à 64 caractères (lettres, chiffres, . _ @ -)',
  );

const roleSchema = z
  .object({
    role: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Nom de rôle invalide'),
    db: databaseName,
  })
  .refine(item => !ADMIN_ONLY_ROLES.has(item.role) || item.db === 'admin', {
    message: 'Ce rôle ne peut être attribué que sur la base admin',
  });

const rolesSchema = z.array(roleSchema).max(32);

const createBody = z.object({
  username: mongoUsername,
  password: z.string().max(256),
  authDatabase: databaseName.default('admin'),
  roles: rolesSchema.min(1, 'Attribuez au moins un rôle'),
  createDatabase: z
    .object({name: databaseName, collection: newCollectionName})
    .optional(),
});

const updateBody = z
  .object({
    password: z.string().max(256).optional(),
    roles: rolesSchema.optional(),
  })
  .refine(body => body.password !== undefined || body.roles !== undefined, {
    message: 'Aucune modification fournie',
  });

const userParams = connParams.extend({
  authDb: databaseName,
  username: mongoUsername,
});

const confirmBody = z.object({confirm: z.string()});

interface RoleRef {
  role: string;
  db: string;
}

function assertPassword(password: string): void {
  const problem = validatePasswordStrength(password);
  if (problem) {
    throw badRequest(problem);
  }
}

interface UserRef {
  user: string;
  db: string;
}

async function currentUsers(client: MongoClient): Promise<UserRef[]> {
  try {
    const status = await client.db('admin').command({connectionStatus: 1});
    const users = (status.authInfo as Document | undefined)
      ?.authenticatedUsers as {user: string; db: string}[] | undefined;
    return users ?? [];
  } catch {
    return [];
  }
}

export async function mongoUserRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/conn/:conn/mongo-users', async request => {
    requireAdmin(request);
    const {conn} = parse(connParams, request.params);
    const client = await ctx.registry.client(conn);
    const result = await client
      .db('admin')
      .command({usersInfo: {forAllDBs: true}});
    const self = await currentUsers(client);
    const users = ((result.users ?? []) as Document[])
      .map(user => ({
        username: user.user as string,
        authDatabase: user.db as string,
        roles: ((user.roles ?? []) as RoleRef[]).map(role => ({
          role: role.role,
          db: role.db,
        })),
        mechanisms: (user.mechanisms as string[] | undefined) ?? [],
        current: self.some(
          item => item.user === user.user && item.db === user.db,
        ),
      }))
      .sort(
        (a, b) =>
          a.authDatabase.localeCompare(b.authDatabase) ||
          a.username.localeCompare(b.username),
      );
    return {users};
  });

  app.post('/conn/:conn/mongo-users', async request => {
    requireAdmin(request);
    const params = parse(connParams, request.params);
    const body = parse(createBody, request.body);
    assertPassword(body.password);
    if (body.createDatabase && SYSTEM_DATABASES.has(body.createDatabase.name)) {
      throw forbidden('Les bases système ne peuvent pas être créées ici.');
    }
    const client = await ctx.registry.client(params.conn);
    await client.db(body.authDatabase).command({
      createUser: body.username,
      pwd: body.password,
      roles: body.roles,
    });
    ctx.audit.record({
      ...auditBase(request, {...params, db: body.authDatabase}),
      action: 'mongoUser.create',
      outcome: 'success',
      details: {
        target: body.username,
        roles: body.roles.map(item => `${item.role}@${item.db}`).join(' '),
      },
    });
    let databaseError: string | null = null;
    if (body.createDatabase) {
      const {name, collection} = body.createDatabase;
      try {
        await client.db(name).createCollection(collection);
        ctx.audit.record({
          ...auditBase(request, {...params, db: name, coll: collection}),
          action: 'database.create',
          outcome: 'success',
          details: {owner: body.username},
        });
      } catch (error) {
        databaseError = (error as Error).message;
      }
    }
    return {
      username: body.username,
      authDatabase: body.authDatabase,
      databaseCreated: Boolean(body.createDatabase) && !databaseError,
      databaseError,
    };
  });

  app.patch('/conn/:conn/mongo-users/:authDb/:username', async request => {
    requireAdmin(request);
    const params = parse(userParams, request.params);
    const body = parse(updateBody, request.body);
    if (body.password !== undefined) {
      assertPassword(body.password);
    }
    const client = await ctx.registry.client(params.conn);
    const self = await currentUsers(client);
    const isSelf = self.some(
      item => item.user === params.username && item.db === params.authDb,
    );
    if (isSelf && body.roles !== undefined) {
      throw badRequest(
        'MyMongo utilise ce compte : modifiez ses rôles depuis mongosh pour éviter de perdre l’accès.',
      );
    }
    await client.db(params.authDb).command({
      updateUser: params.username,
      ...(body.password !== undefined ? {pwd: body.password} : {}),
      ...(body.roles !== undefined ? {roles: body.roles} : {}),
    });
    ctx.audit.record({
      ...auditBase(request, {conn: params.conn, db: params.authDb}),
      action: 'mongoUser.update',
      outcome: 'success',
      details: {
        target: params.username,
        credentialsChanged: body.password !== undefined,
        roles:
          body.roles?.map(item => `${item.role}@${item.db}`).join(' ') ?? null,
      },
    });
    return {ok: true};
  });

  app.delete('/conn/:conn/mongo-users/:authDb/:username', async request => {
    requireAdmin(request);
    const params = parse(userParams, request.params);
    const body = parse(confirmBody, request.body);
    if (body.confirm !== params.username) {
      throw badRequest(
        'Confirmation incorrecte : saisissez le nom exact de l’utilisateur.',
      );
    }
    const client = await ctx.registry.client(params.conn);
    const self = await currentUsers(client);
    if (
      self.some(
        item => item.user === params.username && item.db === params.authDb,
      )
    ) {
      throw forbidden(
        'Impossible de supprimer le compte utilisé par MyMongo pour cette connexion.',
      );
    }
    await client.db(params.authDb).command({dropUser: params.username});
    ctx.audit.record({
      ...auditBase(request, {conn: params.conn, db: params.authDb}),
      action: 'mongoUser.drop',
      outcome: 'success',
      details: {target: params.username},
    });
    return {ok: true};
  });
}
