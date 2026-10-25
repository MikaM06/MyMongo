import {type ButtonHTMLAttributes, forwardRef} from 'react';
import {cn} from '../../lib/cn';
import {Spinner} from './spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'icon' | 'icon-sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover font-medium',
  secondary:
    'bg-panel text-text border border-line hover:bg-hover hover:border-line-strong',
  outline: 'border border-line text-text hover:bg-hover',
  ghost: 'text-muted hover:text-text hover:bg-hover',
  danger: 'bg-danger text-white hover:brightness-110 font-medium',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded',
  md: 'h-8 px-3 text-[13px] gap-2 rounded',
  icon: 'h-8 w-8 rounded justify-center',
  'icon-sm': 'h-7 w-7 rounded justify-center',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      loading,
      className,
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap transition-[background,color,border,filter] duration-100 select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
