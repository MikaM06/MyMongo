import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import {cn} from '../../lib/cn';

const FIELD =
  'rounded border border-line bg-panel px-3 text-[13px] text-text placeholder:text-faint transition-colors hover:border-line-strong focus:border-info focus:outline-none focus:ring-1 focus:ring-info/15 disabled:opacity-50';

function sized(className: string | undefined): string {
  const custom = className ?? '';
  return cn(
    FIELD,
    /(^|\s)w-/.test(custom) ? null : 'w-full',
    /(^|\s)h-/.test(custom) ? null : 'h-8',
    custom,
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({className, ...props}, ref) => (
  <input ref={ref} className={sized(className)} {...props} />
));
Input.displayName = 'Input';

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({className, children, ...props}, ref) => (
  <select
    ref={ref}
    className={cn(sized(className), 'cursor-pointer pr-8')}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5',
        disabled && 'opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        className="mt-0.5 size-4 cursor-pointer accent-[var(--brand-ink)]"
      />
      <span>
        <span className="block text-[13px] text-text">{label}</span>
        {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
      </span>
    </label>
  );
}
