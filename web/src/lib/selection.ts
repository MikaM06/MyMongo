import {matchPath, useLocation} from 'react-router';

export interface Selection {
  db: string | null;
  coll: string | null;
  tab: string | null;
}

export function useSelection(): Selection {
  const {pathname} = useLocation();
  const tabMatch = matchPath('/db/:db/:coll/:tab', pathname);
  if (tabMatch) {
    return {
      db: tabMatch.params.db ?? null,
      coll: tabMatch.params.coll ?? null,
      tab: tabMatch.params.tab ?? null,
    };
  }
  const collMatch = matchPath('/db/:db/:coll', pathname);
  if (collMatch) {
    return {
      db: collMatch.params.db ?? null,
      coll: collMatch.params.coll ?? null,
      tab: null,
    };
  }
  const dbMatch = matchPath('/db/:db', pathname);
  return {db: dbMatch?.params.db ?? null, coll: null, tab: null};
}

export function collUrl(db: string, coll: string, tab?: string): string {
  const base = `/db/${encodeURIComponent(db)}/${encodeURIComponent(coll)}`;
  return tab ? `${base}/${tab}` : base;
}

export function dbUrl(db: string): string {
  return `/db/${encodeURIComponent(db)}`;
}
