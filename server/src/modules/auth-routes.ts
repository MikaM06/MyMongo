import type {FastifyInstance, FastifyReply} from 'fastify';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {burnPasswordCheck, verifyPassword} from '../auth/password.js';
import type {Session} from '../auth/sessions.js';
import {credentialStamp, toPublicUser} from '../auth/users.js';
import {badRequest, tooManyRequests, unauthorized} from '../lib/errors.js';
import {auditBase, parse, requireSession} from '../lib/http.js';

const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

const passwordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});

function sessionPayload(ctx: AppContext, session: Session) {
  const stored = ctx.users.find(session.username);
  return {
    user: {
      username: session.username,
      role: session.role,
      avatar: stored
        ? toPublicUser(stored).avatar
        : {kind: 'generated', seed: session.username},
    },
    csrfToken: session.csrfToken,
  };
}

export async function authRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  const setCookie = (reply: FastifyReply, session: Session) =>
    reply.setCookie(ctx.cookieName, session.id, {
      path: '/',
      httpOnly: true,
      secure: ctx.config.secureCookies,
      sameSite: 'strict',
      maxAge: ctx.config.sessionTtlMinutes * 60,
    });

  app.post('/auth/login', {config: {public: true}}, async (request, reply) => {
    const body = parse(loginBody, request.body);
    const userKey = `${request.ip}|${body.username.toLowerCase()}`;
    const retry = Math.max(
      ctx.loginLimiter.retryAfterSeconds(userKey),
      ctx.ipLimiter.retryAfterSeconds(request.ip),
    );
    if (retry > 0) {
      throw tooManyRequests(retry);
    }
    await ctx.users.refresh(0);
    if (ctx.users.count() === 0) {
      throw badRequest(
        'Aucun compte n’est configuré. Créez un administrateur avec la commande « user add » (voir README).',
      );
    }
    const user = ctx.users.find(body.username);
    let valid = false;
    if (user) {
      valid = await verifyPassword(body.password, user.passwordHash);
    } else {
      await burnPasswordCheck(body.password);
    }
    if (!user || !valid) {
      ctx.loginLimiter.fail(userKey);
      ctx.ipLimiter.fail(request.ip);
      ctx.audit.record({
        ...auditBase(request),
        user: body.username.slice(0, 64),
        action: 'auth.login',
        outcome: 'failure',
      });
      throw unauthorized('Identifiant ou mot de passe incorrect.');
    }
    ctx.loginLimiter.reset(userKey);
    if (request.session) {
      ctx.sessions.destroy(request.session.id);
    }
    const session = ctx.sessions.create(
      user.username,
      user.role,
      credentialStamp(user),
      request.ip,
    );
    request.session = session;
    setCookie(reply, session);
    ctx.audit.record({
      ...auditBase(request),
      action: 'auth.login',
      outcome: 'success',
    });
    return sessionPayload(ctx, session);
  });

  app.post('/auth/logout', {config: {public: true}}, async (request, reply) => {
    if (request.session) {
      ctx.audit.record({
        ...auditBase(request),
        action: 'auth.logout',
        outcome: 'success',
      });
      ctx.sessions.destroy(request.session.id);
    }
    reply.clearCookie(ctx.cookieName, {
      path: '/',
      httpOnly: true,
      secure: ctx.config.secureCookies,
      sameSite: 'strict',
    });
    return {ok: true};
  });

  app.get('/auth/me', async request =>
    sessionPayload(ctx, requireSession(request)),
  );

  app.post('/auth/password', async request => {
    const session = requireSession(request);
    const body = parse(passwordBody, request.body);
    const user = ctx.users.find(session.username);
    if (
      !user ||
      !(await verifyPassword(body.currentPassword, user.passwordHash))
    ) {
      throw badRequest('Mot de passe actuel incorrect.');
    }
    await ctx.users.update(user.username, {password: body.newPassword});
    session.stamp = credentialStamp(ctx.users.find(user.username)!);
    ctx.sessions.destroyUser(user.username, session.id);
    ctx.audit.record({
      ...auditBase(request),
      action: 'auth.password',
      outcome: 'success',
    });
    return {ok: true};
  });
}
