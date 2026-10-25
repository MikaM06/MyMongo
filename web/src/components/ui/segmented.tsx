import type {ReactNode} from 'react';
import {cn} from '../../lib/cn';

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: {value: T; label: string; icon?: ReactNode}[];
  size?: 'sm' | 'md';
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded border border-line bg-panel-2 p-0.5"
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md font-medium transition-colors [&_svg]:size-3.5',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
            value === option.value
              ? 'bg-panel text-text shadow-sm ring-1 ring-line'
              : 'text-muted hover:text-text',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
