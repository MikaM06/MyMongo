import * as RadixDialog from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import type {ReactNode} from 'react';
import {cn} from '../../lib/cn';

export function Modal({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const widths = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            ' fixed top-1/2 left-1/2 z-50 flex max-h-[min(88vh,900px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-line bg-panel shadow-pop focus:outline-none',
            widths[size],
          )}
        >
          <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div>
              <RadixDialog.Title className="text-[15px] font-semibold text-text">
                {title}
              </RadixDialog.Title>
              {subtitle ? (
                <div className="mt-1 text-[13px] text-muted">{subtitle}</div>
              ) : null}
            </div>
            <RadixDialog.Close
              className="-mt-1 -mr-1 rounded-md p-1.5 text-faint hover:bg-hover hover:text-text"
              aria-label="Fermer"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {children}
          </div>
          {footer ? (
            <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-md border-t border-line bg-panel-2 px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-line bg-panel shadow-pop focus:outline-none"
        >
          <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
            <RadixDialog.Title className="min-w-0 truncate text-sm font-semibold">
              {title}
            </RadixDialog.Title>
            <div className="flex items-center gap-1">
              {actions}
              <RadixDialog.Close
                className="rounded-md p-1.5 text-faint hover:bg-hover hover:text-text"
                aria-label="Fermer"
              >
                <X className="size-4" />
              </RadixDialog.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
