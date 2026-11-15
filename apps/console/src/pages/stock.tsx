import { CalendarClock, Copy, PackageCheck, Sparkles, Truck, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { Pill } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, useLive, type StockItem } from '@/lib/api';
import { copy, day, eur, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

const PROMPT = 'Check our kitchen stock and reorder what is running low.';

export function StockPage() {
  const { data, refresh } = useLive(api.stock, [], 10000);
  const [busy, setBusy] = useState(false);

  const simulate = async () => {
    setBusy(true);
    try {
      await api.simulateDay();
      await refresh();
      toast.success('One day of breakfast service used up', { description: 'Stock and run-out dates are updated.' });
    } finally {
      setBusy(false);
    }
  };

  const due = data?.items.filter((i) => i.suggestion) ?? [];

  return (
    <Page
      narrow
      title="Stock"
      description="What’s on the shelf, how fast it goes and what to reorder. Usage is simulated for the demo."
      actions={
        <Button
          variant="outline"
          disabled={busy}
          onClick={simulate}>
          <UtensilsCrossed />
          Simulate a day of service
        </Button>
      }>
      {!data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <>
          {due.length > 0 ? (
            <Card className="border-primary/20 bg-primary/5 py-4">
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Sparkles className="text-primary size-5 shrink-0" />
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    Suggested reorder: {due.length} {due.length === 1 ? 'item' : 'items'}, {eur(data.suggestedTotal)}
                  </div>
                  <div className="text-muted-foreground">Ask your assistant: “{PROMPT}”</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => (await copy(PROMPT)) && toast.success('Copied')}>
                  <Copy />
                  Copy prompt
                </Button>
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <PackageCheck className="size-4" />
              Nothing runs out this week.
            </p>
          )}

          <div className="space-y-3">
            {data.items.map((i) => (
              <StockRow
                key={i.key}
                item={i}
              />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

function StockRow({ item: i }: { item: StockItem }) {
  const tone = i.status === 'urgent' ? 'destructive' : i.status === 'reorder' ? 'warning' : 'success';
  const max = Math.max(...i.history);
  return (
    <Card className="py-4">
      <CardContent className="space-y-3">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{i.message}</div>
            <div className="text-muted-foreground text-sm">
              {qty(i.onHand, i.baseUnit)} on hand · about {qty(i.usagePerDay, i.baseUnit)} a day
            </div>
          </div>
          <div
            className="hidden h-8 items-end gap-0.5 sm:flex"
            title="Use over the last 14 days">
            {i.history.map((h, n) => (
              <span
                key={n}
                className="bg-muted-foreground/30 w-1.5 rounded-sm"
                style={{ height: `${Math.max(8, (h / max) * 100)}%` }}
              />
            ))}
          </div>
          <Pill tone={tone}>{i.status === 'ok' ? `${i.daysLeft >= 21 ? '3+ weeks' : `${i.daysLeft} days`}` : i.status === 'urgent' ? 'Urgent' : 'Reorder'}</Pill>
        </div>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className={cn('h-full rounded-full', tone === 'destructive' ? 'bg-destructive' : tone === 'warning' ? 'bg-warning' : 'bg-success')}
            style={{ width: `${Math.min(100, (i.daysLeft / 14) * 100)}%` }}
          />
        </div>
        {i.incoming.length > 0 && (
          <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {i.incoming.map((x) => (
              <span
                key={`${x.orderId}-${x.date}`}
                className="inline-flex items-center gap-1">
                <Truck className="size-3" />
                {qty(x.quantity, i.baseUnit)} on {day(x.date)}
              </span>
            ))}
          </div>
        )}
        {i.suggestion && (
          <div className="bg-muted/60 flex gap-3 rounded-lg p-3 text-sm">
            <CalendarClock className="text-primary mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">
                Reorder {i.suggestion.line.packs} × {i.suggestion.line.brand} {i.suggestion.line.packLabel} (
                {qty(i.suggestion.line.quantity, i.baseUnit)}, {eur(i.suggestion.line.lineTotal)}) by {day(i.suggestion.neededBy)}
              </div>
              <div className="text-muted-foreground">{i.suggestion.why}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
