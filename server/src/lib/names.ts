import {z} from 'zod';

export const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

export const databaseName = z
  .string()
  .min(1, 'Le nom de la base est requis')
  .max(63, 'Le nom de la base est limité à 63 caractères')
  .regex(
    /^[^/\\. "$*<>:|?\0]+$/,
    'Le nom de la base ne peut pas contenir / \\ . espace " $ * < > : | ?',
  );

export const collectionName = z
  .string()
  .min(1, 'Le nom de la collection est requis')
  .max(255, 'Le nom de la collection est limité à 255 caractères')
  .refine(name => !name.includes('$') && !name.includes('\0'), {
    message: 'Le nom de la collection ne peut pas contenir $',
  })
  .refine(name => !name.startsWith('.') && !name.endsWith('.'), {
    message:
      'Le nom de la collection ne peut pas commencer ou finir par un point',
  });

export const newCollectionName = collectionName.refine(
  name => !name.startsWith('system.'),
  {message: 'Le préfixe « system. » est réservé à MongoDB'},
);

export const indexName = z.string().min(1).max(512);

export const connectionId = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, 'Identifiant de connexion invalide');
