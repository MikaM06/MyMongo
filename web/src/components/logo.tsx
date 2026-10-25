import {cn} from '../lib/cn';

export function LogoMark({className}: {className?: string}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('size-5 shrink-0', className)}
    >
      <path
        d="M12 1.5c3.9 3.6 5.9 7.3 5.9 10.8 0 3.4-2 6-5.9 7.7-3.9-1.7-5.9-4.3-5.9-7.7 0-3.5 2-7.2 5.9-10.8Z"
        className="fill-[#00a85a] dark:fill-[#00c46a]"
      />
      <path
        d="M12 6.5v16"
        className="stroke-[#00593d] dark:stroke-[#0f3d2b]"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({collapsed}: {collapsed?: boolean}) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      {collapsed ? null : (
        <span className="text-[15px] font-semibold text-text">MyMongo</span>
      )}
    </span>
  );
}
