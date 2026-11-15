import type {
  BasketResult,
  DisruptionsResult,
  EventView,
  OffersResult,
  Order,
  OrderResult,
  ReconciliationResult,
  ReplenishmentResult,
} from '@gateway/types';
import { CalendarDays, Check, CheckCircle2, Clock, Leaf, Lightbulb, Package, PackageX, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { day, eur, qty, type AssistantAction, type AssistantCard } from './api';
import { useAssistant } from './use-conversation';
import { useChats } from './chats';

/** Renders one structured card from an assistant reply. Buttons act inside the conversation. */
export function CardView({ card, conversationId }: { card: AssistantCard; conversationId: string }) {
  switch (card.type) {
    case 'supplier-quote': {
      const q = card.data;
      return <Shell title="Combined supplier estimate" right={<span className="font-semibold">{eur(q.total)}</span>}>
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{q.source === 'mock' ? 'Mock prices and availability' : 'Live API prices'} · Delivery {day(q.requestedDate)} · Excl. VAT</p>
          {q.lines.map((l) => <div key={l.productId} className="flex justify-between gap-3 border-b pb-2 text-sm">
            <ProductImage src={l.image} name={l.name} /><div>{l.name}<span className="text-muted-foreground block text-xs">{l.salesUnits} {l.salesUnit}{l.quantity !== undefined ? ` · ${qty(l.quantity, l.baseUnit ?? '')}` : ''} · available {day(l.availableDate)}</span>
              {l.terminal && <span className="block text-xs text-amber-700">Supplier-held product: actual stock quantity is unknown.</span>}
            </div><span>{eur(l.total)}</span>
          </div>)}
          <div className="flex justify-between font-medium"><span>Total excl. VAT</span><span>{eur(q.total)}</span></div>
          <p className="text-muted-foreground text-xs">Checked {new Date(q.checkedAt).toLocaleTimeString()}. Non-binding estimate; stock is not reserved. The challenge API does not support order submission.</p>
        </div>
      </Shell>;
    }
    case 'supplier-products': {
      const s = card.data;
      return <Shell title={`${s.query} · ${day(s.requestedDate)}`}>
        <div className="space-y-3">
          {!s.offers.length && <p className="text-sm">No matching products in the supplier catalogue.</p>}
          {s.offers.map((o) => <div key={o.product.productId} className="border-b pb-2 text-sm">
            <div className="flex justify-between gap-3"><ProductImage src={o.product.image} name={o.product.name} /><span>{o.product.name}</span><span>{o.unitPrice !== undefined ? `${eur(o.unitPrice)}/${o.salesUnit ?? 'sales unit'}` : 'No price'}</span></div>
            <p className="text-muted-foreground text-xs">Code {o.product.productId} · {o.terminal ? 'Stock quantity unknown (supplier-held)' : `${o.availableSalesUnits} ${o.salesUnit ?? 'sales units'} available`}{o.availableDate ? ` · ${day(o.availableDate)}` : ''}</p>
            {o.issues.length > 0 && <p className="text-xs text-amber-700">{o.issues.join('; ')}</p>}
          </div>)}
          <p className="text-muted-foreground text-xs">{s.source === 'mock' ? 'Mock prices and stock from the local demo catalogue.' : 'Live price and availability check.'} Ask Aimo to combine the selected products into one estimate.</p>
        </div>
      </Shell>;
    }
    case 'quote': {
      const q = card.data.quote;
      return <Shell title="Your total quote" right={<span className="font-semibold">{eur(q.total)}</span>}>
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">Nothing ordered · Prices exclude VAT</p>
          {q.lines.map((l) => <div key={l.productId} className="flex justify-between gap-3 border-b pb-2 text-sm">
            <ProductImage src={l.image} name={l.productName} /><div>{l.brand} · {l.productName}<span className="text-muted-foreground block text-xs">{qty(l.quantity, l.baseUnit)} · {lineText(l)} · arrives {day(l.deliveries.at(-1)?.date ?? '')}</span></div>
            <span>{eur(l.lineTotal)}</span>
          </div>)}
          <div className="flex justify-between font-medium"><span>Total excl. VAT</span><span>{eur(q.total)}</span></div>
          <Why text={q.explanation} />
          {!q.meetsDeadline && <p className="text-sm text-amber-700">Some items arrive after your requested date.</p>}
          <p className="text-muted-foreground text-xs">Quote valid until {new Date(q.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Orders outside your limits will need approval.</p>
          <ActionButton action={{ type: 'place-quote', quoteId: q.quoteId }} label={`Order all · ${eur(q.total)}`} conversationId={conversationId} done="Submitted" />
        </div>
      </Shell>;
    }
    case 'offers':
      return <Offers data={card.data} conversationId={conversationId} />;
    case 'order':
      return <OrderCard data={card.data} conversationId={conversationId} />;
    case 'basket':
      return <Basket data={card.data} conversationId={conversationId} />;
    case 'stock':
      return <Stock data={card.data} conversationId={conversationId} />;
    case 'disruptions':
      return <Disruptions data={card.data} conversationId={conversationId} />;
    case 'reconciliation':
      return <Reconciliation data={card.data} conversationId={conversationId} />;
    case 'events':
      return <Events data={card.data} conversationId={conversationId} />;
    case 'orders':
      return <Orders data={card.data} />;
    case 'limits':
      return <Limits data={card.data} />;
    case 'requirements':
      return <Requirements data={card.data} />;
  }
}

function ProductImage({ src, name }: { src?: string; name: string }) {
 const [failed,setFailed]=useState(false);
 if (!src || failed) return <Package className="my-2 size-8 text-muted-foreground" role="img" aria-label="Product image unavailable" />;
 return <img src={src} alt={name} loading="lazy" onError={()=>setFailed(true)} style={{width:72,height:72,objectFit:'contain',background:'white',borderRadius:8,flexShrink:0}} />;
}

// --- shared --------------------------------------------------------------------------

function Shell({ title, icon: Icon, right, children }: { title: string; icon?: typeof Check; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card overflow-hidden rounded-2xl border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        {Icon && <Icon className="text-muted-foreground size-4" />}
        <span className="text-sm font-medium">{title}</span>
        <span className="flex-1" />
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** Button that runs an action once and then shows it as done. */
function ActionButton({
  action,
  label,
  conversationId,
  variant = 'default',
  done = 'Done',
}: {
  action: AssistantAction;
  label: string;
  conversationId: string;
  variant?: 'default' | 'outline' | 'ghost';
  done?: string;
}) {
  const { act } = useAssistant();
  const chats = useChats();
  const alreadySubmitted = action.type === 'place-quote' && chats.find((c) => c.id === conversationId)?.messages.some((m) => m.cards?.some((c) => c.type === 'order' && c.data.order.quoteId === action.quoteId));
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  return (
    <Button
      size="sm"
      variant={state === 'done' ? 'ghost' : variant}
      className="rounded-full"
      disabled={state !== 'idle' || !!alreadySubmitted}
      onClick={async () => {
        setState('busy');
        const reply = await act(action, label, conversationId);
        setState(reply ? 'done' : 'idle');
      }}>
      {state === 'done' || alreadySubmitted ? (
        <>
          <Check />
          {done}
        </>
      ) : state === 'busy' ? (
        'Working…'
      ) : (
        label
      )}
    </Button>
  );
}

function Why({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="bg-muted/60 text-muted-foreground flex gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <span>{text}</span>
    </p>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  confirmed: { label: 'Confirmed', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  pending_approval: { label: 'Needs your approval', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  rejected: { label: 'Rejected', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  changes_requested: { label: 'Waiting for revision', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  revised: { label: 'Revised', className: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, className: '' };
  return (
    <Badge
      variant="secondary"
      className={cn('border-transparent', s.className)}>
      {s.label}
    </Badge>
  );
}

const lineText = (l: { packs: number; brand: string; packLabel: string }) => `${l.packs} × ${l.brand} ${l.packLabel}`;

// --- cards ---------------------------------------------------------------------------

const BADGES: Record<string, { label: string; className: string }> = {
  'best-value': { label: 'Best value', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  premium: { label: 'Premium', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  partial: { label: 'Partial', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  alternative: { label: 'Alternative', className: 'bg-muted text-muted-foreground' },
};

function Offers({ data, conversationId }: { data: OffersResult; conversationId: string }) {
  const [all, setAll] = useState(true);
  const shown = all ? data.offers : data.offers.slice(0, 1);
  return (
    <Shell
      title={`${data.quantity ? `${data.quantity.toLocaleString('en-GB')} × ` : ''}${data.query}${data.neededBy ? ` · by ${day(data.neededBy)}` : ''}`}
      right={data.offers.length > 0 && data.promise.length > 0 && <PromiseBadge rules={data.promise} />}>
      <div className="space-y-3">
        {shown.map((o) => (
          <div
            key={o.offerId}
            className={cn('space-y-2 rounded-xl border p-3', o.badge === 'best-value' && 'border-emerald-500/40')}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Badge
                  variant="secondary"
                  className={cn('mb-1 border-transparent', BADGES[o.badge].className)}>
                  {BADGES[o.badge].label}
                </Badge>
                <ProductImage src={o.lines[0]?.image} name={o.title} /><div className="text-sm font-medium">{o.title}</div>
                <div className="text-muted-foreground text-xs">
                  {o.lines.map(lineText).join(' + ')} · {eur(o.total / o.quantity)}/{o.baseUnit} · arrives {day(o.lastDeliveryDate)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">{eur(o.total)}</div>
                {o.waste.likelyWaste > 0 && <div className="text-xs text-amber-600">~{eur(o.waste.wasteValue)} waste</div>}
              </div>
            </div>
            <Why text={o.explanation} />
            <ActionButton
              action={{ type: 'quote-offer', searchId: data.searchId, offerId: o.offerId }}
              label={`Get total quote · ${eur(o.total)}`}
              conversationId={conversationId}
              variant={o.badge === 'best-value' ? 'default' : 'outline'}
              done="Quoted"
            />
          </div>
        ))}
        {data.offers.length > 1 && (
          <Button
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Compare ${data.offers.length - 1} other options`}
          </Button>
        )}
        {data.excluded.some((e) => e.promise) && (
          <details className="text-muted-foreground text-xs"><summary className="cursor-pointer">Some products were excluded by your requirements</summary><p className="mt-2">
            Left out because of your requirements: {data.excluded.filter((e) => e.promise).map((e) => e.productName).join(', ')}
          </p></details>
        )}
      </div>
    </Shell>
  );
}

function PromiseBadge({ rules }: { rules: string[] }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"
      title={rules.join('\n')}>
      <ShieldCheck className="size-3.5" />
      Meets your requirements
    </span>
  );
}

function OrderCard({ data, conversationId }: { data: OrderResult; conversationId: string }) {
  const o = data.order;
  const failed = o.checks.filter((c) => !c.passed);
  return (
    <Shell
      title={`Order ${o.orderId}`}
      right={<StatusBadge status={o.status} />}>
      <div className="space-y-3">
        <div className="divide-y text-sm">
          {o.lines.map((l) => (
            <div
              key={l.productId}
              className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0">
                {l.productName}
                <span className="text-muted-foreground block text-xs">
                  {lineText(l)} · {l.deliveries.map((d) => `${qty(d.quantity, l.baseUnit)} ${day(d.date)}`).join(', ')}
                </span>
              </span>
              <span className="tabular-nums">{eur(l.lineTotal)}</span>
            </div>
          ))}
          <div className="flex justify-between py-1.5 font-medium">
            <span>Total excl. VAT</span>
            <span className="tabular-nums">{eur(o.total)}</span>
          </div>
        </div>
        <Why text={o.explanation} />
        {o.status === 'pending_approval' && (
          <div className="space-y-2 rounded-xl bg-amber-500/10 p-3">
            <p className="text-sm">
              Approval needed: {failed.map((c) => c.detail).join('; ')}. Approve it?
            </p>
            <div className="flex gap-2">
              <ActionButton
                action={{ type: 'decide', orderId: o.orderId, approve: true }}
                label="Approve"
                conversationId={conversationId}
                done="Approved"
              />
              <ActionButton
                action={{ type: 'decide', orderId: o.orderId, approve: false }}
                label="Reject"
                variant="outline"
                conversationId={conversationId}
                done="Rejected"
              />
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Basket({ data, conversationId }: { data: BasketResult; conversationId: string }) {
  const meal = { breakfast: 'Breakfast', brunch: 'Brunch', 'coffee-break': 'Coffee break' }[data.meal];
  return (
    <Shell
      title={`${meal} · ${data.guests} guests${data.vegan ? ` · ${data.vegan} vegan` : ''}`}
      right={<span className="font-semibold tabular-nums">{eur(data.total)}</span>}>
      <div className="space-y-3">
        {data.budget !== undefined && (
          <div className="space-y-1">
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>{data.withinBudget ? `${eur(data.budget - data.total)} under budget` : `${eur(data.total - data.budget)} over budget`}</span>
              <span>Budget {eur(data.budget)}</span>
            </div>
            <Progress
              value={Math.min(100, (data.total / data.budget) * 100)}
              className="h-1.5"
            />
          </div>
        )}
        <div className="divide-y text-sm">
          {data.lines.map((l) => (
            <div
              key={l.line.productId}
              className="flex justify-between gap-3 py-2">
              <span className="min-w-0">
                {l.role}
                <span className="text-muted-foreground block text-xs">
                  {lineText(l.line)} · {l.forWhom}
                  {l.outsideRules && <span className="text-amber-600"> · needs approval</span>}
                  {l.waste.likelyWaste > 0 && <span className="text-amber-600"> · ~{eur(l.waste.wasteValue)} may expire</span>}
                </span>
              </span>
              <span className="tabular-nums">{eur(l.line.lineTotal)}</span>
            </div>
          ))}
        </div>
        {data.leftOut.length > 0 && (
          <p className="text-muted-foreground text-xs">Left out: {data.leftOut.map((l) => `${l.role} (${l.reason})`).join('; ')}</p>
        )}
        <Why text={data.explanation} />
        <ActionButton
          action={{ type: 'quote-basket', basketId: data.basketId }}
          label={`Get total quote · ${eur(data.total)}`}
          conversationId={conversationId}
          done="Quoted"
        />
      </div>
    </Shell>
  );
}

function Stock({ data, conversationId }: { data: ReplenishmentResult; conversationId: string }) {
  const due = data.items.filter((i) => i.suggestion);
  return (
    <Shell
      title="Kitchen stock"
      icon={Truck}>
      <div className="space-y-3">
        {data.items.map((i) => {
          const tone = i.status === 'urgent' ? 'bg-red-500' : i.status === 'reorder' ? 'bg-amber-500' : 'bg-emerald-500';
          return (
            <div
              key={i.key}
              className="space-y-1">
              <div className="flex justify-between gap-3 text-sm">
                <span className={cn(i.status !== 'ok' && 'font-medium')}>{i.message}</span>
                <span className="text-muted-foreground shrink-0 text-xs">{qty(i.onHand, i.baseUnit)}</span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn('h-full rounded-full', tone)}
                  style={{ width: `${Math.min(100, (i.daysLeft / 14) * 100)}%` }}
                />
              </div>
              {i.suggestion && (
                <p className="text-muted-foreground text-xs">
                  Reorder {lineText(i.suggestion.line)} ({eur(i.suggestion.line.lineTotal)}) by {day(i.suggestion.neededBy)}
                </p>
              )}
            </div>
          );
        })}
        {due.length > 0 && (
          <ActionButton
            action={{ type: 'order-stock' }}
            label={`Reorder all · ${eur(data.suggestedTotal)}`}
            conversationId={conversationId}
            done="Reordered"
          />
        )}
      </div>
    </Shell>
  );
}

function Disruptions({ data, conversationId }: { data: DisruptionsResult; conversationId: string }) {
  return (
    <div className="space-y-3">
      {data.orders.map(({ orderId, summary, disruption: d }) => (
        <Shell
          key={orderId}
          title="Supplier problem"
          icon={PackageX}>
          <div className="space-y-3">
            <p className="text-sm">
              {summary}. <span className="text-muted-foreground">{eur(d.creditValue)} credited.</span>
            </p>
            {d.options.map((o) => (
              <div
                key={o.optionId}
                className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                <div className="min-w-0 flex-1 text-sm">
                  {o.line.brand} {o.line.productName}
                  <span className="text-muted-foreground block text-xs">{o.note}</span>
                </div>
                <ActionButton
                  action={{ type: 'resolve-disruption', orderId, optionId: o.optionId }}
                  label={`Use · ${eur(o.line.lineTotal)}`}
                  conversationId={conversationId}
                  variant={o.optionId === 'R1' ? 'default' : 'outline'}
                  done="Ordered"
                />
              </div>
            ))}
          </div>
        </Shell>
      ))}
    </div>
  );
}

function Reconciliation({ data, conversationId }: { data: ReconciliationResult; conversationId: string }) {
  const d = data.delivery;
  return (
    <Shell
      title={`Delivery check · ${data.orderId}`}
      icon={Truck}
      right={
        d.shortValue > 0 ? (
          <Badge className="border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400">Short {eur(d.shortValue)}</Badge>
        ) : (
          <Badge className="border-transparent bg-emerald-500/15 text-emerald-700">Complete</Badge>
        )
      }>
      <div className="space-y-3">
        <div className="text-sm">
          <div className="text-muted-foreground grid grid-cols-[1fr_repeat(3,4.5rem)] gap-2 pb-1 text-xs">
            <span>Product</span>
            <span className="text-right">Ordered</span>
            <span className="text-right">Picked</span>
            <span className="text-right">Received</span>
          </div>
          {d.lines.map((l) => (
            <div
              key={l.productId}
              className="grid grid-cols-[1fr_repeat(3,4.5rem)] gap-2 border-t py-1.5">
              <span>
                {l.productName}
                {l.issue && <span className="block text-xs text-red-600">{l.issue}</span>}
              </span>
              <span className="text-right tabular-nums">{qty(l.ordered, l.baseUnit)}</span>
              <span className={cn('text-right tabular-nums', l.picked < l.ordered && 'text-red-600')}>{qty(l.picked, l.baseUnit)}</span>
              <span className={cn('text-right tabular-nums', l.received < l.picked && 'text-red-600')}>{qty(l.received, l.baseUnit)}</span>
            </div>
          ))}
        </div>
        {d.followUp && (
          <>
            <div className="bg-muted/60 rounded-lg p-3 text-xs whitespace-pre-wrap">
              <div className="mb-1 font-medium">{d.followUp.subject}</div>
              {d.followUp.body}
            </div>
            {!d.followUp.sentAt && (
              <ActionButton
                action={{ type: 'send-follow-up', orderId: data.orderId }}
                label="Send follow-up"
                conversationId={conversationId}
                done="Sent"
              />
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

function Events({ data, conversationId }: { data: EventView[]; conversationId: string }) {
  return (
    <Shell
      title="Upcoming events"
      icon={CalendarDays}
      right={
        <Link
          to="/automations"
          className="text-muted-foreground hover:text-foreground text-xs">
          Manage
        </Link>
      }>
      <div className="divide-y">
        {data.map((e) => (
          <div
            key={e.id}
            className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{e.name}</div>
              <div className="text-muted-foreground text-xs">
                {day(e.date)} · {e.guests} guests{e.vegan ? `, ${e.vegan} vegan` : ''} · about {eur(e.estimate.total)}
              </div>
            </div>
            {e.status === 'ordered' ? (
              <StatusBadge status={e.orderStatus ?? 'confirmed'} />
            ) : (
              <ActionButton
                action={{ type: 'order-event', eventId: e.id }}
                label="Order all"
                variant="outline"
                conversationId={conversationId}
                done="Ordered"
              />
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Orders({ data }: { data: Order[] }) {
  return (
    <Shell
      title="Orders"
      icon={Clock}>
      <div className="divide-y text-sm">
        {data.map((o) => (
          <div
            key={o.orderId}
            className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <span className="min-w-0 flex-1 truncate">
              {qty(o.lines[0].quantity, o.lines[0].baseUnit)} {o.lines[0].productName}
              {o.lines.length > 1 ? ` + ${o.lines.length - 1} more` : ''}
            </span>
            <StatusBadge status={o.status} />
            <span className="w-20 text-right tabular-nums">{eur(o.total)}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Limits({ data }: { data: { perOrder: number; perWeek: number; spent: number } }) {
  return (
    <Shell
      title="Spending limits"
      icon={Wallet}
      right={
        <Link
          to="/limits"
          className="text-muted-foreground hover:text-foreground text-xs">
          Change
        </Link>
      }>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">On its own, per order</div>
          <div className="text-lg font-semibold tabular-nums">{eur(data.perOrder)}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Per week</div>
          <div className="text-lg font-semibold tabular-nums">{eur(data.perWeek)}</div>
        </div>
        <div className="col-span-2 space-y-1">
          <Progress
            value={Math.min(100, (data.spent / data.perWeek) * 100)}
            className="h-1.5"
          />
          <div className="text-muted-foreground text-xs">{eur(data.spent)} spent this week</div>
        </div>
      </div>
    </Shell>
  );
}

function Requirements({ data }: { data: { rules: string[] } }) {
  return (
    <Shell
      title="Your requirements"
      icon={Leaf}
      right={
        <Link
          to="/requirements"
          className="text-muted-foreground hover:text-foreground text-xs">
          Change
        </Link>
      }>
      <div className="flex flex-wrap gap-2">
        {data.rules.length === 0 && <span className="text-muted-foreground text-sm">None set</span>}
        {data.rules.map((r) => (
          <Badge
            key={r}
            variant="secondary"
            className="gap-1">
            <CheckCircle2 className="size-3 text-emerald-600" />
            {r}
          </Badge>
        ))}
      </div>
    </Shell>
  );
}
