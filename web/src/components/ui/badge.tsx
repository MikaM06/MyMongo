import type {ReactNode} from 'react';
import {cn} from '../../lib/cn';

type Tone = 'neutral' | 'brand' | 'danger' | 'warn' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-panel-2 text-muted border-line',
  brand: 'bg-brand-soft text-brand-ink border-brand-ink/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  info: 'bg-panel-2 text-info border-line',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({children}: {children: ReactNode}) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-panel-2 px-1 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}
