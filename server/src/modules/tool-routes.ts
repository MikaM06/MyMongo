import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {parse, requireSession} from '../lib/http.js';
import {parseMongoValue} from '../lib/mongo-syntax.js';
import {toWire} from '../lib/wire.js';

const formatBody = z.object({
  text: z
    .string()
    .min(1)
    .max(5 * 1024 * 1024),
});

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tools/format', async request => {
    requireSession(request);
    const {text} = parse(formatBody, request.body);
    return {text: JSON.stringify(toWire(parseMongoValue(text)), null, 2)};
  });
}
