import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FlaskConical,
  Lightbulb,
  Mail,
  PackageX,
  PencilLine,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { OrderStatus, Pill } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { api, type Order } from '@/lib/api';
import { copy, day, eur, money, orderSummary, qty } from '@/lib/format';
import { cn } from '@/lib/utils';

type Refresh = () => void;

async function attempt(fn: () => Promise<unknown>, success: string, done: Refresh) {
  try {
    await fn();
    toast.success(success);
    done();
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Something went wrong');
  }
}

/** "Why this purchase" plus the sourcing promise it keeps. */
export function WhyCard({ order }: { order: Order }) {
  if (!order.explanation && !order.promise?.rules.length) return null;
  return (
    <Card className="py-4">
      <CardContent className="space-y-3">
        {order.explanation && (
          <div className="flex gap-3">
            <Lightbulb className="text-primary mt-0.5 size-4 shrink-0" />
            <div>
              <div className="text-sm font-medium">Why this purchase</div>
              <p className="text-muted-foreground text-sm">{order.explanation}</p>
            </div>
          </div>
        )}
        {order.promise?.rules.length > 0 && (
          <div className="flex gap-3">
            <ShieldCheck className="text-success mt-0.5 size-4 shrink-0" />
            <div className="text-muted-foreground text-sm">
              Keeps your sourcing promise: {order.promise.rules.join(' · ')}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** After "approve with changes": what was asked, and the revision. */
export function ChangesPanel({ order, related }: { order: Order; related: Order[] }) {
  const ch = order.requestedChanges;
  const revision = related.find((o) => o.orderId === order.revisedAs);
  const original = related.find((o) => o.orderId === order.revisionOf);
  if (!ch && !original) return null;
  const parts = [
    ...(ch?.lines ?? []).map((l) => {
      const line = order.lines.find((x) => x.productId === l.productId);
      return line ? (l.quantity === 0 ? `Drop ${line.productName}` : `${qty(l.quantity, line.baseUnit)} ${line.productName} instead of ${qty(line.quantity, line.baseUnit)}`) : '';
    }),
    ch?.maxTotal !== undefined ? `Approve if the total stays at or below ${money(ch.maxTotal)}` : '',
  ].filter(Boolean);

  return (
    <Card className="border-primary/30 bg-primary/5 py-4">
      <CardContent className="space-y-3">
        {ch && (
          <div className="flex gap-3">
            <PencilLine className="text-primary mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <div className="text-sm font-medium">{ch.by.split(',')[0]} approved with changes</div>
              <ul className="text-muted-foreground text-sm">
                {parts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {ch.comment && <p className="text-muted-foreground text-sm italic">“{ch.comment}”</p>}
              {order.status === 'changes_requested' && (
                <p className="text-sm">Waiting for the agent to propose a revision. It’s confirmed automatically if it meets these conditions.</p>
              )}
            </div>
          </div>
        )}
        {revision && <RelatedLink order={revision} label="Revised order" />}
        {original && <RelatedLink order={original} label="Revises" />}
      </CardContent>
    </Card>
  );
}

function RelatedLink({ order, label }: { order: Order; label: string }) {
  return (
    <Link
      to={`/orders/${order.orderId}`}
      className="hover:bg-background/60 flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm transition-colors">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{orderSummary(order.lines)}</span>
      <OrderStatus status={order.status} />
      <span className="tabular-nums">{eur(order.total)}</span>
      <ArrowRight className="text-muted-foreground size-4" />
    </Link>
  );
}

/** A supplier can't deliver part of the order: replacement options. */
export function DisruptionPanel({ order, related, refresh }: { order: Order; related: Order[]; refresh: Refresh }) {
  const d = order.disruption;
  const replacement = related.find((o) => o.orderId === d?.replacementOrderId);
  const original = related.find((o) => o.orderId === order.replacementFor?.orderId);
  if (original) return <RelatedLink order={original} label="Replaces part of" />;
  if (!d) return null;

  return (
    <Card className={cn('py-4', d.status === 'open' && 'border-destructive/40 bg-destructive/5')}>
      <CardContent className="space-y-4">
        <div className="flex gap-3">
          <PackageX className={cn('mt-0.5 size-4 shrink-0', d.status === 'open' ? 'text-destructive' : 'text-muted-foreground')} />
          <div className="flex-1">
            <div className="text-sm font-medium">
              {d.status === 'open' ? 'Supplier can’t deliver part of this order' : d.status === 'resolved' ? 'Supplier problem fixed' : 'Shortage accepted'}
            </div>
            <p className="text-muted-foreground text-sm">
              {qty(d.shortQuantity, d.baseUnit)} of {d.productName}. {d.reason}. {money(d.creditValue)} credited.
            </p>
          </div>
        </div>
        {d.status === 'open' && (
          <>
            <div className="space-y-2">
              {d.options.length === 0 && <p className="text-muted-foreground text-sm">Nothing in stock can replace it.</p>}
              {d.options.map((o) => (
                <div
                  key={o.optionId}
                  className="bg-background flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {o.line.brand} {o.line.productName}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {o.line.packs} × {o.line.packLabel} · {eur(o.line.lineTotal)} · arrives{' '}
                      {day(o.line.deliveries.at(-1)?.date ?? '')}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Pill tone={o.kind === 'same-product' ? 'success' : 'info'}>
                        {o.kind === 'same-product' ? 'Same product' : 'Substitute'}
                      </Pill>
                      <Pill tone={o.priceDiff > 0.005 ? 'warning' : 'success'}>
                        {Math.abs(o.priceDiff) < 0.01 ? 'Same price' : o.priceDiff > 0 ? `${money(o.priceDiff)} more` : `${money(-o.priceDiff)} less`}
                      </Pill>
                      <Pill tone={o.daysLater > 0 ? 'warning' : 'success'}>
                        {o.daysLater === 0 ? 'Same day' : o.daysLater > 0 ? `${o.daysLater} day${o.daysLater === 1 ? '' : 's'} later` : 'Earlier'}
                      </Pill>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={o.optionId === 'R1' ? 'default' : 'outline'}
                    onClick={() =>
                      attempt(() => api.resolveDisruption(order.orderId, o.optionId), 'Replacement ordered', refresh)
                    }>
                    Use this
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Your agent sees this too and can pick one; choosing here approves it.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => attempt(() => api.dismissDisruption(order.orderId), 'Shortage accepted', refresh)}>
                Do without
              </Button>
            </div>
          </>
        )}
        {replacement && <RelatedLink order={replacement} label="Replacement" />}
      </CardContent>
    </Card>
  );
}

/** Ordered vs picked vs received, and the follow-up draft. */
export function DeliveryPanel({ order, refresh }: { order: Order; refresh: Refresh }) {
  const d = order.delivery;
  if (!d) return null;
  const short = d.lines.some((l) => l.received < l.ordered);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-medium">
        Delivery check
        {short ? <Pill tone="warning">Short by {money(d.shortValue)}</Pill> : <Pill tone="success">Complete</Pill>}
      </h2>
      <Card className="py-2">
        <CardContent className="px-5">
          <div className="text-muted-foreground grid grid-cols-[1fr_repeat(3,5.5rem)] gap-2 border-b py-2 text-xs">
            <span>Product</span>
            <span className="text-right">Ordered</span>
            <span className="text-right">Picked</span>
            <span className="text-right">Received</span>
          </div>
          {d.lines.map((l) => (
            <div
              key={l.productId}
              className="grid grid-cols-[1fr_repeat(3,5.5rem)] items-baseline gap-2 border-b py-2.5 text-sm last:border-0">
              <span>
                {l.productName}
                {l.issue && <span className="text-destructive block text-xs">{l.issue}</span>}
              </span>
              <span className="text-right tabular-nums">{qty(l.ordered, l.baseUnit)}</span>
              <span className={cn('text-right tabular-nums', l.picked < l.ordered && 'text-destructive font-medium')}>
                {qty(l.picked, l.baseUnit)}
              </span>
              <span className={cn('text-right tabular-nums', l.received < l.picked && 'text-destructive font-medium')}>
                {qty(l.received, l.baseUnit)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      {d.followUp && (
        <Card className="py-4">
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" />
              Draft follow-up to Valio Aimo
              {d.followUp.sentAt && <Pill tone="success">Sent</Pill>}
            </div>
            <div className="text-sm font-medium">{d.followUp.subject}</div>
            <pre className="bg-muted text-muted-foreground max-h-64 overflow-auto rounded-lg p-3 font-sans text-sm whitespace-pre-wrap">
              {d.followUp.body}
            </pre>
            <div className="flex flex-wrap gap-2">
              {!d.followUp.sentAt && (
                <Button
                  size="sm"
                  onClick={() => attempt(() => api.sendFollowUp(order.orderId), 'Follow-up sent (demo)', refresh)}>
                  <Mail />
                  Send to Valio Aimo
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (await copy(`Subject: ${d.followUp!.subject}\n\n${d.followUp!.body}`)) toast.success('Copied');
                }}>
                <Copy />
                Copy
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/** Buttons for a confirmed order: record the delivery, plus demo controls. */
export function FulfilmentActions({ order, refresh }: { order: Order; refresh: Refresh }) {
  const [recording, setRecording] = useState(false);
  if (order.status !== 'confirmed' || order.delivery) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setRecording(true)}>
        <ClipboardCheck />
        Record delivery…
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground">
            <FlaskConical />
            Demo
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-72">
          <DropdownMenuLabel>Simulate (synthetic)</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={order.disruption?.status === 'open'}
            onClick={() => attempt(() => api.simulateDisruption(order.orderId), 'Supplier problem simulated', refresh)}
            className="flex-col items-start gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4" />
              Supplier can’t deliver an item
            </span>
            <span className="text-muted-foreground text-xs">Finds replacements with price and delivery differences</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => attempt(() => api.recordDelivery(order.orderId, { sample: true }), 'Delivery recorded with a sample shortage', refresh)}
            className="flex-col items-start gap-0.5">
            <span className="flex items-center gap-2 font-medium">
              <Truck className="size-4" />
              Delivery arrives a bit short
            </span>
            <span className="text-muted-foreground text-xs">One pack short-picked, one damaged on arrival</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RecordDeliveryDialog
        order={order}
        open={recording}
        onClose={() => setRecording(false)}
        refresh={refresh}
      />
    </div>
  );
}

function RecordDeliveryDialog({ order, open, onClose, refresh }: { order: Order; open: boolean; onClose: () => void; refresh: Refresh }) {
  const expected = (productId: string, quantity: number) =>
    order.disruption?.productId === productId ? quantity - order.disruption.shortQuantity : quantity;
  const [received, setReceived] = useState<Record<string, number>>({});
  const value = (productId: string, quantity: number) => received[productId] ?? expected(productId, quantity);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record delivery</DialogTitle>
          <DialogDescription>
            Enter what actually arrived. The gateway compares it with the order and the warehouse picking list, and
            drafts a follow-up if anything is missing.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-lg border">
          {order.lines.map((l) => (
            <div
              key={l.productId}
              className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{l.productName}</div>
                <div className="text-muted-foreground text-xs">
                  Ordered {qty(expected(l.productId, l.quantity), l.baseUnit)}
                </div>
              </div>
              <InputGroup className="w-36">
                <InputGroupInput
                  type="number"
                  min={0}
                  value={value(l.productId, l.quantity)}
                  aria-label={`Received ${l.productName}`}
                  className="tabular-nums"
                  onChange={(e) => setReceived({ ...received, [l.productId]: Math.max(0, e.target.valueAsNumber || 0) })}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{l.baseUnit}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              attempt(
                () =>
                  api.recordDelivery(order.orderId, {
                    received: order.lines.map((l) => ({ productId: l.productId, quantity: value(l.productId, l.quantity) })),
                  }),
                'Delivery recorded',
                () => {
                  onClose();
                  refresh();
                },
              )
            }>
            <CheckCircle2 />
            Save delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
