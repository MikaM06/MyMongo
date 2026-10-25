export interface ActiveQuery {
  filter: string;
  sort: string;
  projection: string;
  search: string;
}

export const EMPTY_QUERY: ActiveQuery = {
  filter: '',
  sort: '',
  projection: '',
  search: '',
};

function key(conn: string, db: string, coll: string): string {
  return `mymongo.query.${conn}.${db}.${coll}`;
}

export function readActiveQuery(
  conn: string,
  db: string,
  coll: string,
): ActiveQuery {
  try {
    const raw = sessionStorage.getItem(key(conn, db, coll));
    return raw
      ? {...EMPTY_QUERY, ...(JSON.parse(raw) as ActiveQuery)}
      : EMPTY_QUERY;
  } catch {
    return EMPTY_QUERY;
  }
}

export function writeActiveQuery(
  conn: string,
  db: string,
  coll: string,
  query: ActiveQuery,
): void {
  try {
    sessionStorage.setItem(key(conn, db, coll), JSON.stringify(query));
  } catch {
    return;
  }
}

export function isEmptyQuery(query: ActiveQuery): boolean {
  return (
    !query.filter.trim() &&
    !query.search.trim() &&
    !query.sort.trim() &&
    !query.projection.trim()
  );
}
