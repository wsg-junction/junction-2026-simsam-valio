import { ArrowRight, Bot, Boxes, CheckCircle2, PackageX, PencilLine, Truck } from 'lucide-react';
import { Link } from 'react-router';
import { AuditTimeline } from '@/components/audit-timeline';
import { CreateTokenButton } from '@/components/create-token';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { Overview } from '@/lib/api';
import { eur, eurShort, greeting, money, orderSummary, relative, ruleProblem } from '@/lib/format';
import { cn } from '@/lib/utils';

export function OverviewPage({ overview, refresh }: { overview?: Overview; refresh: () => void }) {
  if (!overview) {
    return (
      <Page title="Home">
        <Skeleton className="h-40 rounded-xl" />
      </Page>
    );
  }
  const m = overview.mandate;
  const name = m.approver.split(' ')[0];
  const pending = overview.pending;

  return (
    <Page
      narrow
      title={`${greeting()}, ${name}`}
      description={
        pending.length
          ? `${pending.length} ${pending.length === 1 ? 'order needs' : 'orders need'} your decision.`
          : 'Nothing needs you right now. Orders within your rules are confirmed automatically.'
      }>
      {overview.tokens.active === 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
              <Bot className="size-5" />
            </div>
            <div className="flex-1">
              <div className="font-medium">Connect your AI assistant</div>
              <p className="text-muted-foreground text-sm">One click, then paste the link into Claude or ChatGPT.</p>
            </div>
            <CreateTokenButton onCreated={refresh} />
          </CardContent>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          {pending.slice(0, 3).map((o) => (
            <Link
              key={o.orderId}
              to={`/orders/${o.orderId}`}
              className="group block">
              <Card className="border-warning/40 group-hover:border-warning py-4 transition-colors">
                <CardContent className="flex items-center gap-4">
                  <span className="bg-warning size-2 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{orderSummary(o.lines)}</div>
                    <div className="text-muted-foreground text-sm">
                      {ruleProblem(o.checks.find((c) => !c.passed)?.rule ?? '')}
                    </div>
                  </div>
                  <div className="text-right font-semibold tabular-nums">{eur(o.total)}</div>
                  <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 transition-colors" />
                </CardContent>
              </Card>
            </Link>
          ))}
          {pending.length > 3 && (
            <Button
              variant="link"
              className="px-0"
              asChild>
              <Link to="/approvals">See all {pending.length}</Link>
            </Button>
          )}
        </section>
      )}

      <Attention overview={overview} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="py-5">
          <CardContent className="space-y-3">
            <div className="text-muted-foreground text-sm">Spent this week</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{eurShort(m.spentThisWeek)}</span>
              <span className="text-muted-foreground text-sm">of {eurShort(m.weeklyBudget)}</span>
            </div>
            <Progress
              value={Math.min(100, (m.spentThisWeek / m.weeklyBudget) * 100)}
              className="h-1.5"
            />
          </CardContent>
        </Card>
        <Link
          to="/agents"
          className="group">
          <Card className="group-hover:bg-accent/40 h-full py-5 transition-colors">
            <CardContent className="space-y-3">
              <div className="text-muted-foreground text-sm">Connected agents</div>
              <div className="text-2xl font-semibold tabular-nums">{overview.tokens.active}</div>
              <div className="text-muted-foreground text-sm">Last active {relative(overview.tokens.lastUsedAt).toLowerCase()}</div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Latest activity</h2>
          <Button
            variant="ghost"
            size="sm"
            asChild>
            <Link to="/activity">
              All activity <ArrowRight />
            </Link>
          </Button>
        </div>
        {overview.recent.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4" />
            No activity yet. Ask your agent to order something.
          </p>
        ) : (
          <AuditTimeline
            events={overview.recent.filter((e) => !e.actor.startsWith('gateway')).slice(0, 5)}
            showReasons={false}
            relativeTimes
          />
        )}
      </section>
    </Page>
  );
}

/** Things that aren't approvals but want a look: stock running out, supplier problems, short deliveries. */
function Attention({ overview }: { overview: Overview }) {
  const items = [
    ...overview.disruptions.map((d) => ({
      key: `d-${d.orderId}`,
      to: `/orders/${d.orderId}`,
      icon: PackageX,
      tone: 'text-destructive',
      title: 'Supplier can’t deliver',
      text: d.summary,
    })),
    ...overview.stockAlerts.map((a) => ({
      key: `s-${a.key}`,
      to: '/stock',
      icon: Boxes,
      tone: a.status === 'urgent' ? 'text-destructive' : 'text-warning',
      title: a.message,
      text: 'A reorder is suggested on the Stock page',
    })),
    ...overview.shortDeliveries.map((o) => ({
      key: `r-${o.orderId}`,
      to: `/orders/${o.orderId}`,
      icon: Truck,
      tone: 'text-warning',
      title: `Delivery short by ${money(o.delivery?.shortValue ?? 0)}`,
      text: `${orderSummary(o.lines)}: a follow-up is drafted`,
    })),
    ...overview.changesRequested.map((o) => ({
      key: `c-${o.orderId}`,
      to: `/orders/${o.orderId}`,
      icon: PencilLine,
      tone: 'text-primary',
      title: 'Waiting for the agent to revise',
      text: orderSummary(o.lines),
    })),
  ];
  if (!items.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-sm font-medium">Also worth a look</h2>
      <Card className="py-2">
        <CardContent className="divide-y px-2">
          {items.slice(0, 6).map((i) => (
            <Link
              key={i.key}
              to={i.to}
              className="hover:bg-accent/50 flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors">
              <i.icon className={cn('size-4 shrink-0', i.tone)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{i.title}</div>
                <div className="text-muted-foreground truncate text-xs">{i.text}</div>
              </div>
              <ArrowRight className="text-muted-foreground size-4" />
            </Link>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
