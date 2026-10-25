import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {credentialStamp, ROLES, usernameSchema} from '../auth/users.js';
import {badRequest} from '../lib/errors.js';
import {auditBase, parse, requireAdmin} from '../lib/http.js';

const userParams = z.object({username: usernameSchema});
const createBody = z.object({
  username: usernameSchema,
  password: z.string().max(256),
  role: z.enum(ROLES),
});
const updateBody = z
  .object({
    role: z.enum(ROLES).optional(),
    password: z.string().max(256).optional(),
  })
  .refine(body => body.role !== undefined || body.password !== undefined, {
    message: 'Aucune modification fournie',
  });

export async function userRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get('/users', async request => {
    requireAdmin(request);
    return {users: ctx.users.list()};
  });

  app.post('/users', async request => {
    requireAdmin(request);
    const body = parse(createBody, request.body);
    const user = await ctx.users.create(
      body.username,
      body.password,
      body.role,
    );
    ctx.audit.record({
      ...auditBase(request),
      action: 'user.create',
      outcome: 'success',
      details: {target: user.username, role: user.role},
    });
    return {user};
  });

  app.patch('/users/:username', async request => {
    const session = requireAdmin(request);
    const {username} = parse(userParams, request.params);
    const body = parse(updateBody, request.body);
    if (
      body.role &&
      body.role !== 'admin' &&
      username.toLowerCase() === session.username.toLowerCase()
    ) {
      throw badRequest(
        'Vous ne pouvez pas retirer votre propre rôle administrateur.',
      );
    }
    const user = await ctx.users.update(username, body);
    if (body.password) {
      const self = user.username === session.username;
      if (self) {
        session.stamp = credentialStamp(ctx.users.find(user.username)!);
      }
      ctx.sessions.destroyUser(user.username, self ? session.id : undefined);
    }
    if (body.role) {
      ctx.sessions.updateRole(user.username, body.role);
    }
    ctx.audit.record({
      ...auditBase(request),
      action: 'user.update',
      outcome: 'success',
      details: {
        target: user.username,
        role: user.role,
        credentialsChanged: Boolean(body.password),
      },
    });
    return {user};
  });

  app.delete('/users/:username', async request => {
    const session = requireAdmin(request);
    const {username} = parse(userParams, request.params);
    if (username.toLowerCase() === session.username.toLowerCase()) {
      throw badRequest('Vous ne pouvez pas supprimer votre propre compte.');
    }
    await ctx.users.remove(username);
    await ctx.avatars.remove(username);
    ctx.sessions.destroyUser(username);
    ctx.audit.record({
      ...auditBase(request),
      action: 'user.delete',
      outcome: 'success',
      details: {target: username},
    });
    return {ok: true};
  });
}
