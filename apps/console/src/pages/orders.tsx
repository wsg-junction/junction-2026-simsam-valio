import { AlertTriangle, ArrowLeft, BadgeCheck, CheckCircle2, ChevronDown, Package, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AuditTimeline } from '@/components/audit-timeline';
import { DecisionButtons } from '@/components/decision-dialog';
import { ChangesPanel, DeliveryPanel, DisruptionPanel, FulfilmentActions, WhyCard } from '@/components/order-panels';
import { Page } from '@/components/page';
import { OrderStatus } from '@/components/status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, useLive, type Order } from '@/lib/api';
import { actor, dateTime, day, eur, orderSummary, qty, relative, ruleProblem } from '@/lib/format';

const failedChecks = (o: Order) => o.checks.filter((c) => !c.passed);

// --- approvals --------------------------------------------------------------------

export function ApprovalsPage({ refreshShell }: { refreshShell: () => void }) {
  const { data: orders, refresh } = useLive(api.orders);
  const pending = orders?.filter((o) => o.status === 'pending_approval') ?? [];
  const done = () => {
    refresh();
    refreshShell();
  };

  return (
    <Page
      narrow
      title="Approvals"
      description="Your agent placed these, but they’re outside your rules. Nothing is ordered until you decide.">
      {!orders ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : pending.length === 0 ? (
        <Empty className="border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BadgeCheck />
            </EmptyMedia>
            <EmptyTitle>You’re all caught up</EmptyTitle>
            <EmptyDescription>New requests show up here, and the agent waits for you.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        pending.map((o) => (
          <Card
            key={o.orderId}
            className="gap-4">
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">{orderSummary(o.lines)}</div>
                  <div className="text-muted-foreground text-sm">
                    Requested by {actor(o.placedBy).name} · {relative(o.createdAt).toLowerCase()}
                  </div>
                </div>
                <div className="text-xl font-semibold tabular-nums">{eur(o.total)}</div>
              </div>
              <div className="bg-warning/10 text-warning-foreground flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{failedChecks(o).map((c) => ruleProblem(c.rule)).join(' · ')}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground -ml-3"
                  asChild>
                  <Link to={`/orders/${o.orderId}`}>View details</Link>
                </Button>
                <DecisionButtons
                  order={o}
                  onDone={done}
                />
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </Page>
  );
}

// --- orders list ------------------------------------------------------------------

export function OrdersPage() {
  const { data: orders } = useLive(api.orders);
  const [filter, setFilter] = useState<'all' | Order['status']>('all');
  const navigate = useNavigate();
  const shown =
    orders?.filter(
      (o) => filter === 'all' || o.status === filter || (filter === 'pending_approval' && o.status === 'changes_requested'),
    ) ?? [];

  return (
    <Page
      narrow
      title="Orders"
      actions={
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="confirmed">Confirmed</TabsTrigger>
            <TabsTrigger value="pending_approval">Waiting</TabsTrigger>
          </TabsList>
        </Tabs>
      }>
      {!orders ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : shown.length === 0 ? (
        <Empty className="border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Package />
            </EmptyMedia>
            <EmptyTitle>No orders yet</EmptyTitle>
            <EmptyDescription>Ask your agent in Claude to order something.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-2">
          <CardContent className="divide-y px-2">
            {shown.map((o) => (
              <button
                key={o.orderId}
                onClick={() => navigate(`/orders/${o.orderId}`)}
                className="hover:bg-accent/50 flex w-full items-center gap-4 rounded-md px-3 py-3 text-left transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{orderSummary(o.lines)}</div>
                  <div className="text-muted-foreground text-xs">{dateTime(o.createdAt)}</div>
                </div>
                <OrderStatus status={o.status} />
                <div className="w-24 text-right font-medium tabular-nums">{eur(o.total)}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}

// --- order detail -----------------------------------------------------------------

export function OrderDetailPage({ refreshShell }: { refreshShell: () => void }) {
  const { orderId = '' } = useParams();
  const { data, error, refresh } = useLive(() => api.order(orderId), [orderId]);
  const [showChecks, setShowChecks] = useState(false);

  if (error) {
    return (
      <Page
        narrow
        title="Order not found">
        <p className="text-muted-foreground">{error}. The demo may have been reset.</p>
        <Button
          variant="outline"
          className="self-start"
          asChild>
          <Link to="/orders">
            <ArrowLeft />
            Back to orders
          </Link>
        </Button>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page
        narrow
        title="Order">
        <Skeleton className="h-64 rounded-xl" />
      </Page>
    );
  }

  const { order, events, related } = data;
  const done = () => {
    refresh();
    refreshShell();
  };
  const failed = failedChecks(order);
  const passed = order.checks.filter((c) => c.passed);

  return (
    <Page
      narrow
      title={orderSummary(order.lines)}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <OrderStatus status={order.status} />
          <span>
            {eur(order.total)} · requested by {actor(order.placedBy).name} · {dateTime(order.createdAt)}
          </span>
        </span>
      }>
      {order.status === 'pending_approval' && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <div className="font-medium">Needs your decision</div>
              <ul className="text-muted-foreground mt-1 space-y-0.5 text-sm">
                {failed.map((c) => (
                  <li key={c.rule}>
                    {ruleProblem(c.rule)} <span className="text-xs">({c.detail})</span>
                  </li>
                ))}
              </ul>
            </div>
            <DecisionButtons
              order={order}
              onDone={done}
            />
          </CardContent>
        </Card>
      )}

      {order.decidedBy && (order.status === 'confirmed' || order.status === 'rejected') && (
        <Alert className={order.status === 'confirmed' ? 'border-success/40 bg-success/5' : ''}>
          <CheckCircle2 />
          <AlertTitle>
            {order.status === 'confirmed' ? (order.revisionOf ? 'Approved with changes' : 'Approved') : 'Rejected'} by{' '}
            {order.decidedBy.split(',')[0]}
          </AlertTitle>
          {order.decisionComment && <AlertDescription>“{order.decisionComment}”</AlertDescription>}
        </Alert>
      )}

      <ChangesPanel
        order={order}
        related={related}
      />
      <DisruptionPanel
        order={order}
        related={related}
        refresh={done}
      />
      <WhyCard order={order} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">What’s ordered</h2>
          <FulfilmentActions
            order={order}
            refresh={done}
          />
        </div>
        <Card className="py-2">
          <CardContent className="divide-y px-5">
            {order.lines.map((l) => (
              <div
                key={l.productId}
                className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{l.productName}</div>
                  <div className="text-muted-foreground text-sm">
                    {l.brand} · {l.packs} × {l.packLabel}
                  </div>
                  <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 text-xs">
                    {l.deliveries.map((d) => (
                      <span
                        key={d.date}
                        className="inline-flex items-center gap-1">
                        <Truck className="size-3" />
                        {qty(d.quantity, l.baseUnit)} on {day(d.date)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="font-medium tabular-nums">{eur(l.lineTotal)}</div>
              </div>
            ))}
            <div className="flex justify-between py-3 text-sm">
              <span className="text-muted-foreground">Total, fixed price excl. VAT</span>
              <span className="font-semibold tabular-nums">{eur(order.total)}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <DeliveryPanel
        order={order}
        refresh={done}
      />

      <section className="space-y-3">
        <button
          onClick={() => setShowChecks(!showChecks)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm">
          <CheckCircle2 className="text-success size-4" />
          {passed.length} of {order.checks.length} rules passed
          <ChevronDown className={`size-4 transition-transform ${showChecks ? 'rotate-180' : ''}`} />
        </button>
        {showChecks && (
          <Card className="py-4">
            <CardContent className="space-y-2">
              {order.checks.map((c) => (
                <div
                  key={c.rule}
                  className="flex items-start gap-2 text-sm">
                  {c.passed ? (
                    <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" />
                  ) : (
                    <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
                  )}
                  <span>
                    {c.rule} <span className="text-muted-foreground">· {c.detail}</span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="font-medium">History</h2>
        <AuditTimeline events={events} />
      </section>
    </Page>
  );
}
