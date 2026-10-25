import type {ReactNode} from 'react';
import {Link} from 'react-router';

export interface BarItem {
  key: string;
  label: string;
  value: number;
  display: string;
  to?: string;
  secondary?: ReactNode;
}

export function BarList({items, empty}: {items: BarItem[]; empty: string}) {
  const max = Math.max(...items.map(item => item.value), 0);
  if (!items.length) {
    return (
      <p className="px-4 py-8 text-center text-[13px] text-faint">{empty}</p>
    );
  }
  return (
    <ul className="space-y-1 p-2">
      {items.map(item => {
        const width = max > 0 ? Math.max((item.value / max) * 100, 1.5) : 0;
        const body = (
          <>
            <div
              aria-hidden="true"
              className="absolute inset-y-0.5 left-0 rounded-sm bg-primary/15 dark:bg-primary/25"
              style={{width: `${width}%`}}
            />
            <span className="relative min-w-0 flex-1 truncate font-mono text-[12.5px] text-text">
              {item.label}
            </span>
            {item.secondary ? (
              <span className="relative hidden text-xs text-faint sm:inline">
                {item.secondary}
              </span>
            ) : null}
            <span className="relative w-20 text-right text-xs font-medium text-muted tabular-nums">
              {item.display}
            </span>
          </>
        );
        return (
          <li key={item.key}>
            {item.to ? (
              <Link
                to={item.to}
                className="relative flex h-8 items-center gap-3 rounded-md px-2.5 hover:bg-hover"
              >
                {body}
              </Link>
            ) : (
              <div className="relative flex h-8 items-center gap-3 px-2.5">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
