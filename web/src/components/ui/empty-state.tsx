import type {ReactNode} from 'react';

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-md border border-line bg-panel-2 text-muted [&_svg]:size-5">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {children ? (
        <div className="mt-1.5 max-w-sm text-[13px] text-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {message}
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 cursor-pointer font-medium underline-offset-2 hover:underline"
          >
            Réessayer
          </button>
        ) : null}
      </div>
    </div>
  );
}
