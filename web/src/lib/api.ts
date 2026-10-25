export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let csrfToken = '';
const unauthorizedListeners = new Set<() => void>();

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function request(
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw error;
    }
    throw new ApiError(0, 'NETWORK', 'Serveur MyMongo injoignable.');
  }
  if (!response.ok) {
    let payload: {error?: ApiErrorBody} = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    const error = new ApiError(
      response.status,
      payload.error?.code ?? 'HTTP_ERROR',
      payload.error?.message ?? `Erreur ${response.status}`,
      payload.error?.details,
    );
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      unauthorizedListeners.forEach(listener => listener());
    }
    throw error;
  }
  return response;
}

export async function api<T>(
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await request(method, path, body, signal);
  return (await response.json()) as T;
}

export async function downloadFile(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<void> {
  const response = await request('POST', path, body);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function enc(value: string): string {
  return encodeURIComponent(value);
}

export function collPath(conn: string, db: string, coll: string): string {
  return `/conn/${enc(conn)}/databases/${enc(db)}/collections/${enc(coll)}`;
}

export function dbPath(conn: string, db: string): string {
  return `/conn/${enc(conn)}/databases/${enc(db)}`;
}
