import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type {ReactNode} from 'react';
import {cn} from '../../lib/cn';

export function Menu({
  trigger,
  children,
  align = 'end',
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
}) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded border border-line bg-panel py-1 shadow-[0_2px_8px_rgb(0_0_0/0.12)]"
        >
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export function MenuItem({
  children,
  icon,
  onSelect,
  danger,
  disabled,
  hint,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <RadixMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-[13px] outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-4',
        danger ? 'text-danger' : 'text-text [&_svg]:text-muted',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </RadixMenu.Item>
  );
}

export function MenuLabel({children}: {children: ReactNode}) {
  return (
    <RadixMenu.Label className="px-2.5 pt-1.5 pb-1 text-xs text-faint">
      {children}
    </RadixMenu.Label>
  );
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="my-1 h-px bg-line" />;
}
