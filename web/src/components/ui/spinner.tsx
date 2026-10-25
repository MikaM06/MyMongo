import {cn} from '../../lib/cn';

export function Spinner({className}: {className?: string}) {
  return (
    <span
      role="status"
      aria-label="Chargement"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent opacity-70',
        className,
      )}
    />
  );
}

export function LoadingBlock({label = 'Chargement…'}: {label?: string}) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-muted">
      <Spinner />
      {label}
    </div>
  );
}

export function Skeleton({className}: {className?: string}) {
  return <div className={cn('animate-pulse rounded-md bg-hover', className)} />;
}
