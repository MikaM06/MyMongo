import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {AppContext} from '../app.js';
import {
  AVATAR_MIME,
  detectImageFormat,
  MAX_AVATAR_BYTES,
} from '../auth/avatars.js';
import {usernameSchema} from '../auth/users.js';
import {badRequest, notFound} from '../lib/errors.js';
import {auditBase, parse, requireSession} from '../lib/http.js';

const generatedBody = z.object({
  seed: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w.@-]+$/, 'Graine invalide'),
});

const imageBody = z.object({
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64),
});

const avatarParams = z.object({username: usernameSchema});

export async function avatarRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.put('/auth/avatar', async request => {
    const session = requireSession(request);
    const {seed} = parse(generatedBody, request.body);
    await ctx.avatars.remove(session.username);
    const user = await ctx.users.setAvatar(session.username, {
      kind: 'generated',
      seed,
    });
    return {avatar: user.avatar};
  });

  app.post('/auth/avatar/image', async request => {
    const session = requireSession(request);
    const {data} = parse(imageBody, request.body);
    const base64 = data.replace(/^data:image\/[a-z]+;base64,/, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw badRequest('Image invalide : encodage base64 attendu.');
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_AVATAR_BYTES) {
      throw badRequest(
        `Image trop lourde : ${Math.round(MAX_AVATAR_BYTES / 1024)} Ko maximum.`,
      );
    }
    const format = detectImageFormat(buffer);
    if (!format) {
      throw badRequest('Format non pris en charge : PNG, JPEG ou WebP.');
    }
    await ctx.avatars.save(session.username, format, buffer);
    const user = await ctx.users.setAvatar(session.username, {
      kind: 'custom',
      format,
      version: Date.now(),
    });
    ctx.audit.record({
      ...auditBase(request),
      action: 'auth.avatar',
      outcome: 'success',
      details: {format, bytes: buffer.length},
    });
    return {avatar: user.avatar};
  });

  app.delete('/auth/avatar', async request => {
    const session = requireSession(request);
    await ctx.avatars.remove(session.username);
    const user = await ctx.users.setAvatar(session.username, {
      kind: 'generated',
      seed: session.username,
    });
    return {avatar: user.avatar};
  });

  app.get('/avatars/:username', async (request, reply) => {
    requireSession(request);
    const {username} = parse(avatarParams, request.params);
    const user = ctx.users.find(username);
    if (!user || user.avatar?.kind !== 'custom') {
      throw notFound('Aucune photo de profil.');
    }
    const data = await ctx.avatars.read(user.username, user.avatar.format);
    if (!data) {
      throw notFound('Aucune photo de profil.');
    }
    return reply
      .header('Content-Type', AVATAR_MIME[user.avatar.format])
      .header('Cache-Control', 'private, max-age=86400')
      .header('Content-Disposition', 'inline')
      .send(data);
  });
}
