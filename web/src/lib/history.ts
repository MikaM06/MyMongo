export interface HistoryEntry {
  id: string;
  kind: 'find' | 'aggregate';
  namespace: string;
  filter?: string;
  sort?: string;
  projection?: string;
  pipeline?: string;
  at: number;
}

const KEY = 'mymongo.history';
const MAX = 50;

export function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushHistory(
  entry: Omit<HistoryEntry, 'id' | 'at'>,
): HistoryEntry[] {
  const signature = JSON.stringify({...entry});
  const items = readHistory().filter(
    item =>
      JSON.stringify({...item, id: undefined, at: undefined}) !== signature,
  );
  const next = [
    {...entry, id: crypto.randomUUID(), at: Date.now()},
    ...items,
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    return;
  }
}

export function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`mymongo.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(`mymongo.${key}`, JSON.stringify(value));
  } catch {
    return;
  }
}
