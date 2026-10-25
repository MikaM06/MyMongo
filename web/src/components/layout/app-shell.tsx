import {useQueryClient} from '@tanstack/react-query';
import {Suspense, useEffect, useState} from 'react';
import {Outlet, useLocation} from 'react-router';
import {readPreference, writePreference} from '../../lib/history';
import {LoadingBlock} from '../ui/spinner';
import {Sidebar} from './sidebar';
import {ShortcutsDialog, Topbar} from './topbar';

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  return (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
    Boolean(element.closest('.cm-editor'))
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() =>
    readPreference('sidebarCollapsed', false),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const client = useQueryClient();
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setCollapsed(value => {
          writePreference('sidebarCollapsed', !value);
          return !value;
        });
        return;
      }
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        setShortcuts(true);
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        void client.invalidateQueries();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client]);

  const toggleCollapsed = () => {
    setCollapsed(value => {
      writePreference('sidebarCollapsed', !value);
      return !value;
    });
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenMobile={() => setMobileOpen(true)}
          onShowShortcuts={() => setShortcuts(true)}
        />
        <main className="min-w-0 flex-1">
          <Suspense fallback={<LoadingBlock />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </div>
  );
}

export function PageContainer({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={
        wide
          ? 'px-3 py-4 sm:px-5 sm:py-5'
          : 'mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6'
      }
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded border border-line bg-panel text-muted [&_svg]:size-4.5">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-text">
            {title}
          </h1>
          {subtitle ? (
            <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
