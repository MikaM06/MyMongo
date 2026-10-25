export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string, details?: unknown): HttpError {
  return new HttpError(400, 'BAD_REQUEST', message, details);
}

export function unauthorized(message = 'Authentification requise'): HttpError {
  return new HttpError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'Action non autorisée'): HttpError {
  return new HttpError(403, 'FORBIDDEN', message);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, 'CONFLICT', message);
}

export function tooManyRequests(retryAfterSeconds: number): HttpError {
  return new HttpError(
    429,
    'TOO_MANY_REQUESTS',
    `Trop de tentatives. Réessayez dans ${Math.ceil(retryAfterSeconds / 60)} min.`,
    {retryAfterSeconds},
  );
}

interface MongoLikeError {
  name: string;
  code?: number | string;
  codeName?: string;
  message: string;
}

const MONGO_CODE_STATUS: Record<number, [number, string]> = {
  2: [400, 'Valeur invalide'],
  9: [400, 'Requête mal formée'],
  13: [403, "Le compte MongoDB n'a pas la permission d'effectuer cette action"],
  18: [503, 'Échec d’authentification auprès de MongoDB'],
  26: [404, 'Espace de noms introuvable'],
  27: [404, 'Index introuvable'],
  48: [409, 'Cette collection existe déjà'],
  50: [408, 'Délai d’exécution dépassé'],
  59: [400, 'Commande non prise en charge'],
  67: [400, 'Impossible de créer cet index'],
  72: [400, 'Options invalides'],
  73: [400, 'Nom invalide'],
  85: [409, 'Un index équivalent existe avec d’autres options'],
  86: [409, 'Un index portant ce nom existe avec une autre clé'],
  115: [400, 'Opération non prise en charge par ce serveur'],
  166: [400, 'Opération impossible sur une vue'],
  11000: [409, 'Clé dupliquée'],
};

export function isMongoError(error: unknown): error is MongoLikeError {
  return (
    error instanceof Error &&
    (error.name.startsWith('Mongo') || error.name === 'BSONError')
  );
}

export function fromMongoError(error: MongoLikeError): HttpError {
  if (
    error.name === 'MongoServerSelectionError' ||
    error.name === 'MongoNetworkError' ||
    error.name === 'MongoNetworkTimeoutError' ||
    error.name === 'MongoTopologyClosedError'
  ) {
    return new HttpError(
      503,
      'MONGO_UNAVAILABLE',
      'MongoDB est injoignable. Vérifiez que le serveur est démarré et accessible.',
    );
  }
  if (error.name === 'BSONError') {
    return badRequest(`Valeur BSON invalide : ${error.message}`);
  }
  const code = typeof error.code === 'number' ? error.code : undefined;
  const mapped = code === undefined ? undefined : MONGO_CODE_STATUS[code];
  if (mapped) {
    return new HttpError(
      mapped[0],
      error.codeName ?? 'MONGO_ERROR',
      mapped[1],
      {
        mongoCode: code,
        mongoMessage: error.message,
      },
    );
  }
  return new HttpError(400, error.codeName ?? 'MONGO_ERROR', error.message, {
    mongoCode: code,
  });
}
