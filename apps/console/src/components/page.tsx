import type { ReactNode } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';

export function Page({
  title,
  description,
  actions,
  children,
  narrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Single-column pages read better at a narrower width. */
  narrow?: boolean;
}) {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 p-4 md:p-10 ${narrow ? 'max-w-3xl' : 'max-w-5xl'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <SidebarTrigger className="mt-1 -ml-2 md:hidden" />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-muted-foreground max-w-xl text-sm">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
