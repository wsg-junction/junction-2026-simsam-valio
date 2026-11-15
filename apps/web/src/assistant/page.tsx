import type { ReactNode } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

/** Settings page frame: title, one-line description, content. */
export function SettingsPage({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 items-center px-3">
        <SidebarTrigger />
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 pt-4 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground max-w-xl text-sm">{description}</p>
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

export function Section({ title, description, icon, right, children, className }: { title: string; description?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('bg-card rounded-2xl border', className)}>
      <div className="flex items-start gap-3 border-b px-5 py-4">
        {icon}
        <div className="flex-1">
          <h2 className="font-medium">{title}</h2>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {right}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-muted-foreground text-sm">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
