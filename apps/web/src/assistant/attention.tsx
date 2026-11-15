import { AlertTriangle, BadgeCheck, Boxes, CalendarDays, Clock, MessageCircle, PackageX, Truck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { day, type AttentionItem } from './api';
import { useAssistant } from './use-conversation';

const KIND = {
  approval: { icon: BadgeCheck, label: 'Approval' },
  disruption: { icon: PackageX, label: 'Supplier' },
  late: { icon: Clock, label: 'Delivery' },
  delivery: { icon: Truck, label: 'Delivery' },
  stock: { icon: Boxes, label: 'Stock' },
  event: { icon: CalendarDays, label: 'Event' },
} as const;

const TONE = {
  urgent: 'bg-red-500/10 text-red-600 dark:text-red-400',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  info: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
};

/** "Needs attention": upcoming shortages, events and decisions, each with a one-click action. */
export function AttentionFeed({ items, onChanged }: { items?: AttentionItem[]; onChanged: () => void }) {
  if (!items) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }
  if (!items.length) {
    return (
      <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
        <BadgeCheck className="size-4" />
        Nothing needs you right now. Stock, deliveries and events are on track.
      </p>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <AttentionCard
          key={item.id}
          item={item}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function AttentionCard({ item, onChanged }: { item: AttentionItem; onChanged: () => void }) {
  const { act, send } = useAssistant();
  const [busy, setBusy] = useState(false);
  const kind = KIND[item.kind];
  return (
    <div className="bg-card hover:border-ring/40 flex flex-col gap-3 rounded-2xl border p-4 text-left transition-colors">
      <div className="flex items-start gap-3">
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', TONE[item.tone])}>
          {item.tone === 'urgent' && item.kind !== 'disruption' ? <AlertTriangle className="size-4" /> : <kind.icon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>{kind.label}</span>
            {item.date && (
              <>
                <span>·</span>
                <span>{day(item.date)}</span>
              </>
            )}
          </div>
          <div className="text-sm leading-snug font-medium">{item.title}</div>
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{item.detail}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        {item.action && (
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await act(item.action!.action, item.action!.label.replace(/ · .*/, ''));
              setBusy(false);
              onChanged();
            }}>
            {busy ? 'Working…' : item.action.label}
          </Button>
        )}
        {item.ask && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground rounded-full"
            onClick={() => send(item.ask!)}>
            <MessageCircle />
            Ask
          </Button>
        )}
      </div>
    </div>
  );
}
