import type {ReactNode} from 'react';
import {cn} from '../../lib/cn';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-md border border-line bg-panel', className)}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  icon,
  actions,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-10 items-center justify-between gap-3 rounded-t-md border-b border-line bg-panel-2 px-3 py-1.5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold text-text [&_svg]:size-3.5 [&_svg]:text-muted">
        {icon}
        {title}
      </h2>
      {actions}
    </header>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  unavailable,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5 [&_svg]:text-faint">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          'mt-1 truncate font-mono text-lg font-medium tabular-nums',
          unavailable ? 'text-sm text-faint' : 'text-text',
        )}
        title={
          unavailable
            ? 'Information non fournie par le serveur ou non autorisée pour ce compte'
            : undefined
        }
      >
        {unavailable ? 'Indisponible' : value}
      </div>
      {sub ? (
        <div className="mt-1 truncate text-xs text-faint">{sub}</div>
      ) : null}
    </div>
  );
}
