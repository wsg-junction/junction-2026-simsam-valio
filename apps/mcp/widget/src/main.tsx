import { createContext, Fragment, StrictMode, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AssortmentResult,
  AuditResult,
  BasketResult,
  DisruptionsResult,
  Offer,
  OfferLine,
  OffersResult,
  Order,
  OrderResult,
  QuoteResult,
  ReconciliationResult,
  ReplenishmentResult,
  WidgetPayload,
} from '../../src/types';
import { app, openLink, runTool, say, tellModel, useWidgetState } from './bridge';
import './styles.css';

// --- formatting ----------------------------------------------------------------

const eur = (n: number) =>
  `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number) => eur(n).replace(/\.00$/, '');
const qty = (n: number, unit: string) => `${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${unit}`;
const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const BADGES: Record<Offer['badge'], { label: string; tone: string }> = {
  'best-value': { label: 'Best value', tone: 'ok' },
  premium: { label: 'Premium', tone: 'info' },
  partial: { label: 'Partial', tone: 'warn' },
  alternative: { label: 'Alternative', tone: 'muted' },
};

// --- navigation inside one widget ----------------------------------------------
// Clicking a button shows the next step (quote → order → audit) in the same widget; "Back" returns.

const Nav = createContext<{ push: (p: WidgetPayload) => void; back?: () => void }>({ push: () => {} });

function ProductImage({ src, name }: { src?: string; name: string }) {
 const [failed,setFailed]=useState(false);
 if (!src || failed) return <span role="img" aria-label="Product image unavailable">??</span>;
 return <img src={src} alt={name} loading="lazy" onError={()=>setFailed(true)} style={{width:72,height:72,objectFit:'contain',background:'white',borderRadius:8,flexShrink:0}} />;
}

// --- shared bits ----------------------------------------------------------------

function Brand({ right }: { right?: React.ReactNode }) {
  const { back } = useContext(Nav);
  return (
    <div className="brand">
      {back && (
        <button
          className="link"
          onClick={back}>
          ← Back
        </button>
      )}
      <span className="logo">Valio Aimo</span>
      <span className="muted">Agent Gateway</span>
      <span className="spacer" />
      {right}
    </div>
  );
}

function Deliveries({ line, neededBy }: { line: OfferLine; neededBy?: string }) {
  return (
    <div className="chips">
      {line.deliveries.map((d) => (
        <span
          key={d.date}
          className={`chip ${neededBy && d.date > neededBy ? 'warn' : ''}`}
          title={neededBy && d.date > neededBy ? 'After the requested date' : undefined}>
          {qty(d.quantity, line.baseUnit)} · {day(d.date)}
        </span>
      ))}
    </div>
  );
}

/**
 * Runs a gateway tool directly from the widget. If the host doesn't allow that, falls back to asking the agent
 * in the chat.
 */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (
    tool: string,
    args: Record<string, unknown>,
    onDone: (payload: WidgetPayload) => void,
    fallbackMessage: string,
  ) => {
    setBusy(true);
    setError(undefined);
    const outcome = await runTool(tool, args);
    setBusy(false);
    if (outcome.ok) return onDone(outcome.payload);
    if (outcome.unsupported) {
      const sent = await say(fallbackMessage);
      setError(sent ? 'Asked the agent in the chat instead.' : outcome.error);
    } else {
      setError(outcome.error.replace(/^Error: /, ''));
    }
  };
  return { busy, error, run };
}

function ErrorLine({ error }: { error?: string }) {
  return error ? <div className="small danger">{error}</div> : null;
}

/** "✓ Keeps your promise" with the rules on hover. */
function PromiseChip({ rules }: { rules: string[] }) {
  if (!rules.length) return null;
  return (
    <span
      className="chip ok"
      title={`Your sourcing promise, enforced on every order:\n${rules.join('\n')}`}>
      ✓ Keeps your promise
    </span>
  );
}

function WasteChip({ waste, unit }: { waste: Offer['waste']; unit: string }) {
  if (waste.likelyWaste > 0)
    return (
      <span
        className="chip warn"
        title={waste.note}>
        ~{money(waste.wasteValue)} may go to waste
      </span>
    );
  if (waste.surplus > 0)
    return (
      <span
        className="chip"
        title={waste.note}>
        +{qty(waste.surplus, unit)} extra, gets used
      </span>
    );
  return null;
}

// --- offers ---------------------------------------------------------------------

function OfferCard({ offer, result }: { offer: Offer; result: OffersResult }) {
  const { push } = useContext(Nav);
  const [open, setOpen] = useState(offer.rank === 1);
  const { busy, error, run } = useAction();
  const badge = BADGES[offer.badge];
  const certs = [...new Set(offer.lines.flatMap((l) => l.certificates))];
  const co2 = offer.lines[0].co2eRange;

  const requestQuote = () =>
    run(
      'widget_request_quote',
      {
        lines: offer.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        neededBy: result.neededBy,
        requirements: result.requirements,
        searchId: result.searchId,
        offerId: offer.offerId,
      },
      (payload) => {
        push(payload);
        if (payload.kind === 'quote') {
          tellModel(
            `The buyer requested signed quote ${payload.quote.quoteId} (${eur(payload.quote.total)}) for offer ${offer.offerId} "${offer.title}" in the widget. Nothing is ordered yet; they can place the order from the quote widget or ask you to.`,
          );
        }
      },
      `Request a signed quote for offer ${offer.offerId} (${offer.title}).`,
    );

  return (
    <div className={`card offer ${offer.rank === 1 ? 'top' : ''}`}>
      <div className="row">
        <span className={`pill ${badge.tone}`}>{badge.label}</span>
        <span className="spacer" />
        <span className="price">{eur(offer.total)}</span>
      </div>
      <ProductImage src={offer.lines[0]?.image} name={offer.title} /><div className="title">{offer.title}</div>
      {offer.explanation && <div className="why">{offer.explanation}</div>}
      <div className="muted small">
        {qty(offer.quantity, offer.baseUnit)} · {eur(offer.total / offer.quantity)}/{offer.baseUnit} · on time{' '}
        {Math.round(Math.min(...offer.lines.map((l) => l.onTimeRate)) * 100)}%
      </div>
      {offer.lines.map((l) => (
        <div
          key={l.productId}
          className="line">
          <span className="small">
            {l.packs} × {l.brand} {l.packLabel}
          </span>
          <Deliveries
            line={l}
            neededBy={result.neededBy}
          />
        </div>
      ))}
      <div className="chips">
        {certs.map((c) => (
          <span
            key={c}
            className="chip cert">
            {c}
          </span>
        ))}
        <span
          className="chip"
          title="Category-level estimate (synthetic)">
          {co2[0]}–{co2[1]} kg CO₂e/{offer.baseUnit}
        </span>
        <WasteChip
          waste={offer.waste}
          unit={offer.baseUnit}
        />
      </div>
      <button
        className="link"
        onClick={() => setOpen(!open)}>
        {open ? 'Hide reasoning' : 'Why this ranking?'}
      </button>
      {open && (
        <ul className="reasons">
          {offer.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button
          className={offer.rank === 1 ? 'primary' : ''}
          disabled={busy}
          onClick={requestQuote}>
          {busy ? 'Requesting…' : 'Get signed quote'}
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function OffersView({ result }: { result: OffersResult }) {
  const req = [
    ...(result.requirements.dietary ?? []),
    ...(result.requirements.certificates ?? []),
    ...(result.requirements.excludeAllergens ?? []).map((a) => `no ${a}`),
  ];
  return (
    <>
      <Brand right={<span className="muted small">{result.buyer}</span>} />
      <div className="heading">
        {result.quantity ? `${result.quantity.toLocaleString('en-GB')} × ` : ''}“{result.query}”
        {result.neededBy && <span className="muted"> by {day(result.neededBy)}</span>}
      </div>
      {(req.length > 0 || result.promise?.length > 0) && (
        <div className="chips">
          {req.map((r) => (
            <span
              key={r}
              className="chip">
              {r}
            </span>
          ))}
          <PromiseChip rules={result.promise ?? []} />
        </div>
      )}
      {result.usageNote && <div className="card notice info small">Heads-up: {result.usageNote}</div>}
      {result.offers.length === 0 && <div className="card muted">No matching products in the assortment.</div>}
      <div className="offers">
        {result.offers.map((o) => (
          <OfferCard
            key={o.offerId}
            offer={o}
            result={result}
          />
        ))}
      </div>
      {result.excluded.length > 0 && (
        <details className="excluded">
          <summary className="muted small">
            {result.excluded.length} product(s) left out
            {result.excluded.some((e) => e.promise) ? ', some because of your sourcing promise' : ''}
          </summary>
          <ul>
            {result.excluded.map((e) => (
              <li
                key={e.productName}
                className="small">
                {e.productName}: <span className="muted">{e.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// --- quote ----------------------------------------------------------------------

function useCountdown(until: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, Date.parse(until) - now);
  return {
    expired: ms === 0,
    label: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`,
  };
}

function QuoteView({ result }: { result: QuoteResult }) {
  const { push } = useContext(Nav);
  const q = result.quote;
  const { expired, label } = useCountdown(q.expiresAt);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  const placeOrder = () =>
    run(
      'widget_place_order',
      { quoteId: q.quoteId },
      (payload) => {
        push(payload);
        if (payload.kind === 'order') {
          const o = payload.order;
          tellModel(
            o.status === 'confirmed'
              ? `The buyer placed order ${o.orderId} (${eur(o.total)}) from quote ${q.quoteId} in the widget. It passed all mandate checks and is confirmed.`
              : `The buyer placed order ${o.orderId} (${eur(o.total)}) from quote ${q.quoteId} in the widget. It is waiting for approval by ${o.approver} because: ${o.checks
                  .filter((c) => !c.passed)
                  .map((c) => `${c.rule} (${c.detail})`)
                  .join('; ')}.`,
          );
        }
      },
      `Place the order for quote ${q.quoteId}.`,
    );

  return (
    <>
      <Brand
        right={
          <span
            className="pill ok"
            title={`Ed25519 signature, key ${q.signature?.kid}`}>
            ✓ Signed by Valio Aimo
          </span>
        }
      />
      <div className="row">
        <div className="heading">Quote {q.quoteId}</div>
        <span className="spacer" />
        <span className={`small ${expired ? 'danger' : 'muted'}`}>{expired ? 'Expired' : `Valid ${label}`}</span>
      </div>
      <div className="card">
        {q.lines.map((l) => (
          <div
            key={l.productId}
            className="line">
            <div className="row">
              <span>
                <b>
                  <ProductImage src={l.image} name={l.productName} />{l.brand} {l.productName}
                </b>
                <br />
                <span className="muted small">
                  {l.packs} × {l.packLabel} · {eur(l.packPrice)} each
                </span>
              </span>
              <span className="spacer" />
              <span className="num">{eur(l.lineTotal)}</span>
            </div>
            <Deliveries
              line={l}
              neededBy={q.neededBy}
            />
          </div>
        ))}
        <div className="row total">
          <span>Total, fixed price excl. VAT</span>
          <span className="spacer" />
          <span className="price">{eur(q.total)}</span>
        </div>
      </div>
      <div className="chips">
        <span className={`chip ${q.meetsDeadline ? 'ok' : 'warn'}`}>
          {q.neededBy
            ? q.meetsDeadline
              ? `Arrives by ${day(q.neededBy)}`
              : `Partly after ${day(q.neededBy)}`
            : 'No deadline given'}
        </span>
        <span className={`chip ${q.meetsRequirements ? 'ok' : 'warn'}`}>
          {q.meetsRequirements ? 'Meets requirements' : 'Outside requirements'}
        </span>
        <PromiseChip rules={q.promise?.rules ?? []} />
      </div>
      {q.explanation && <div className="why">{q.explanation}</div>}
      {confirming ? (
        <div className="card notice info">
          <b>Order {eur(q.total)} at the signed price?</b>
          <div className="small">
            The gateway checks it against your rules. If it’s outside them, it goes to your approver instead of
            being confirmed.
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={busy || expired}
              onClick={placeOrder}>
              {busy ? 'Placing…' : 'Confirm order'}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button
            className="primary"
            disabled={expired}
            onClick={() => setConfirming(true)}>
            Place order…
          </button>
          <button onClick={() => openLink(result.verifyUrl)}>Verify signature</button>
        </div>
      )}
      <ErrorLine error={error} />
    </>
  );
}

// --- order ----------------------------------------------------------------------

const STATUS: Record<Order['status'], { label: string; tone: string }> = {
  confirmed: { label: 'Confirmed', tone: 'ok' },
  pending_approval: { label: 'Waiting for approval', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'danger' },
  changes_requested: { label: 'Approved with changes', tone: 'info' },
  revised: { label: 'Revised', tone: 'muted' },
};

const waiting = (o: Order) => o.status === 'pending_approval' || o.status === 'changes_requested';

function changesText(o: Order): string {
  const ch = o.requestedChanges;
  if (!ch) return '';
  const parts = (ch.lines ?? []).map((l) => {
    const line = o.lines.find((x) => x.productId === l.productId);
    return line ? (l.quantity === 0 ? `drop ${line.productName}` : `${qty(l.quantity, line.baseUnit)} ${line.productName}`) : '';
  });
  if (ch.maxTotal !== undefined) parts.push(`total at most ${money(ch.maxTotal)}`);
  return parts.filter(Boolean).join(' · ');
}

function OrderView({ result }: { result: OrderResult }) {
  const { push } = useContext(Nav);
  const [order, setOrder] = useState<Order>(result.order);
  const [live, setLive] = useState(true);
  const announced = useRef<string>(result.order.status);
  const { busy, error, run } = useAction();

  // While waiting for a decision (or a revision), poll the gateway through the host so it shows up live.
  useEffect(() => {
    if (!waiting(order) || !live) return;
    const t = setInterval(async () => {
      const outcome = await runTool('get_order_status', { orderId: order.orderId });
      if (outcome.ok && outcome.payload.kind === 'order') setOrder(outcome.payload.order);
      else if (!outcome.ok && outcome.unsupported) setLive(false);
    }, 4000);
    return () => clearInterval(t);
  }, [order.status, order.orderId, live]);

  // Tell the model about decisions so its next answer is accurate.
  useEffect(() => {
    if (announced.current === order.status) return;
    announced.current = order.status;
    const who = order.decidedBy ?? 'the approver';
    const note = order.decisionComment ? ` ("${order.decisionComment}")` : '';
    const messages: Partial<Record<Order['status'], string>> = {
      confirmed: `Order ${order.orderId} was approved by ${who}${note}.`,
      rejected: `Order ${order.orderId} was rejected by ${who}${note}.`,
      changes_requested: `${who} approved order ${order.orderId} with changes: ${changesText(order)}${note}. Propose a revision with revise_order.`,
      revised: `Order ${order.orderId} was revised as order ${order.revisedAs}. Check it with get_order_status.`,
    };
    if (messages[order.status]) tellModel(messages[order.status]!);
  }, [order]);

  const status = STATUS[order.status];
  const failed = order.checks.filter((c) => !c.passed);
  const show = (tool: string, args: Record<string, unknown>, fallback: string) => run(tool, args, push, fallback);

  return (
    <>
      <Brand right={<span className={`pill ${status.tone}`}>{status.label}</span>} />
      <div className="row">
        <div className="heading">Order {order.orderId}</div>
        <span className="spacer" />
        <span className="price">{eur(order.total)}</span>
      </div>
      {order.explanation && <div className="why">{order.explanation}</div>}
      <div className="card">
        <div className="row">
          <span className="small muted label">Your rules</span>
          <span className="spacer" />
          <span className="small muted">
            {order.checks.length - failed.length} of {order.checks.length} passed
          </span>
        </div>
        {order.checks.map((c) => (
          <div
            key={c.rule}
            className="check">
            <span className={`mark ${c.passed ? 'ok' : 'warn'}`}>{c.passed ? '✓' : '!'}</span>
            <span>
              {c.rule}
              <br />
              <span className="muted small">{c.detail}</span>
            </span>
          </div>
        ))}
      </div>
      {order.status === 'pending_approval' && (
        <div className="card notice warn">
          <b>Needs sign-off from {order.approver}.</b>
          <div className="small">
            Neither the agent nor this chat can approve it. {live ? 'This view updates when they decide.' : ''}
          </div>
          <div className="actions">
            {result.approvalUrl && (
              <button
                className="primary"
                onClick={() => openLink(result.approvalUrl!)}>
                Open approval console
              </button>
            )}
          </div>
        </div>
      )}
      {order.status === 'changes_requested' && (
        <div className="card notice info">
          <b>{(order.decidedBy ?? 'The approver').split(',')[0]} approved with changes</b>
          <div className="small">{changesText(order)}</div>
          {order.decisionComment && <div className="small">“{order.decisionComment}”</div>}
          <div className="actions">
            <button
              className="primary"
              onClick={() => say(`Revise order ${order.orderId} to meet the approver's changes (${changesText(order)}).`)}>
              Ask the agent to revise
            </button>
          </div>
        </div>
      )}
      {order.status === 'revised' && order.revisedAs && (
        <div className="card notice ok">
          <b>Revised as order {order.revisedAs}</b>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => show('get_order_status', { orderId: order.revisedAs }, `Show order ${order.revisedAs}.`)}>
              Show revised order
            </button>
          </div>
        </div>
      )}
      {(order.status === 'confirmed' || order.status === 'rejected') && order.decidedBy && (
        <div className={`card notice ${status.tone}`}>
          <b>
            {order.status === 'confirmed' ? (order.revisionOf ? 'Approved with changes' : 'Approved') : 'Rejected'} by{' '}
            {order.decidedBy}
          </b>
          {order.decisionComment && <div className="small">“{order.decisionComment}”</div>}
        </div>
      )}
      {order.disruption?.status === 'open' && (
        <div className="card notice warn">
          <b>Supplier problem</b>
          <div className="small">{order.disruption.reason}.</div>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => show('check_disruptions', {}, 'Show the supplier problems and replacement options.')}>
              See replacements
            </button>
          </div>
        </div>
      )}
      <div className="actions">
        {order.delivery && (
          <button
            disabled={busy}
            onClick={() =>
              show('reconcile_delivery', { orderId: order.orderId }, `Check the delivery of order ${order.orderId}.`)
            }>
            Delivery check
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => show('get_audit_trail', { orderId: order.orderId }, `Show the audit trail for order ${order.orderId}.`)}>
          {busy ? 'Loading…' : 'Show audit trail'}
        </button>
      </div>
      <ErrorLine error={error} />
    </>
  );
}

// --- basket ---------------------------------------------------------------------

const MEALS: Record<BasketResult['meal'], string> = { breakfast: 'Breakfast', brunch: 'Brunch', 'coffee-break': 'Coffee break' };

function BasketView({ result }: { result: BasketResult }) {
  const { push } = useContext(Nav);
  const { busy, error, run } = useAction();
  const used = result.budget ? Math.min(100, (result.total / result.budget) * 100) : 0;

  const quote = () =>
    run(
      'widget_request_quote',
      {
        lines: result.lines.map((l) => ({ productId: l.line.productId, quantity: l.line.quantity })),
        neededBy: result.neededBy,
        basketId: result.basketId,
      },
      (payload) => {
        push(payload);
        if (payload.kind === 'quote')
          tellModel(
            `The buyer requested signed quote ${payload.quote.quoteId} (${eur(payload.quote.total)}) for basket ${result.basketId} in the widget. Nothing is ordered yet.`,
          );
      },
      `Get a signed quote for basket ${result.basketId}.`,
    );

  return (
    <>
      <Brand right={<span className="muted small">{result.buyer}</span>} />
      <div className="row">
        <div className="heading">
          {MEALS[result.meal]} for {result.guests} guests
          {result.vegan > 0 && <span className="muted"> · {result.vegan} vegan</span>}
        </div>
        <span className="spacer" />
        <span className="price">{eur(result.total)}</span>
      </div>
      {result.budget !== undefined && (
        <div>
          <div className="row small muted">
            <span>
              {result.withinBudget
                ? `${money(result.budget - result.total)} under budget`
                : `${money(result.total - result.budget)} over budget`}
            </span>
            <span className="spacer" />
            <span>Budget {money(result.budget)}</span>
          </div>
          <div className={`bar ${result.withinBudget ? '' : 'danger'}`}>
            <span style={{ width: `${used}%` }} />
          </div>
        </div>
      )}
      <div className="why">{result.explanation}</div>
      <div className="card">
        {result.lines.map((l) => (
          <div
            key={l.line.productId}
            className="line">
            <div className="row">
              <span>
                <b>{l.role}</b>
                <br />
                <span className="muted small">
                  {l.line.packs} × {l.line.brand} {l.line.packLabel} · {l.forWhom}
                </span>
              </span>
              <span className="spacer" />
              <span className="num">{eur(l.line.lineTotal)}</span>
            </div>
            <div className="small muted">{l.why}</div>
            <div className="chips">
              <WasteChip
                waste={l.waste}
                unit={l.line.baseUnit}
              />
              {l.outsideRules && <span className="chip warn">Needs approval: category</span>}
              {!l.arrivesInTime && <span className="chip warn">Arrives late</span>}
            </div>
          </div>
        ))}
      </div>
      {result.leftOut.length > 0 && (
        <div className="small muted">
          Left out: {result.leftOut.map((l) => `${l.role} (${l.reason})`).join('; ')}
        </div>
      )}
      <div className="chips">
        <PromiseChip rules={result.promise} />
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={busy || result.lines.length === 0}
          onClick={quote}>
          {busy ? 'Requesting…' : 'Get signed quote'}
        </button>
      </div>
      <ErrorLine error={error} />
    </>
  );
}

// --- stock ----------------------------------------------------------------------

function StockView({ result }: { result: ReplenishmentResult }) {
  const { push } = useContext(Nav);
  const { busy, error, run } = useAction();
  const due = result.items.filter((i) => i.suggestion);
  const neededBy = due.map((i) => i.suggestion!.neededBy).sort()[0];

  const quote = () =>
    run(
      'widget_request_quote',
      { lines: due.map((i) => ({ productId: i.suggestion!.line.productId, quantity: i.suggestion!.line.quantity })), neededBy },
      (payload) => {
        push(payload);
        if (payload.kind === 'quote')
          tellModel(`The buyer requested signed quote ${payload.quote.quoteId} (${eur(payload.quote.total)}) for the suggested reorder in the widget. Nothing is ordered yet.`);
      },
      'Get a signed quote for the suggested reorder.',
    );

  return (
    <>
      <Brand right={<span className="muted small">{result.buyer}</span>} />
      <div className="heading">Kitchen stock</div>
      <div className="card">
        {result.items.map((i) => {
          const tone = i.status === 'urgent' ? 'danger' : i.status === 'reorder' ? 'warn' : 'ok';
          return (
            <div
              key={i.key}
              className="line">
              <div className="row">
                <span>
                  <b>{i.message}</b>
                  <br />
                  <span className="muted small">
                    {qty(i.onHand, i.baseUnit)} on hand · ~{qty(i.usagePerDay, i.baseUnit)}/day
                    {i.incoming.length > 0 && ` · ${qty(i.incoming.reduce((s, x) => s + x.quantity, 0), i.baseUnit)} incoming`}
                  </span>
                </span>
                <span className="spacer" />
                <span className={`pill ${tone}`}>{i.status === 'ok' ? `${i.daysLeft}+ days` : i.status === 'urgent' ? 'Urgent' : 'Reorder'}</span>
              </div>
              <div className={`bar ${tone === 'ok' ? '' : tone}`}>
                <span style={{ width: `${Math.min(100, (i.daysLeft / 14) * 100)}%` }} />
              </div>
              {i.suggestion && (
                <div className="small">
                  Suggest {i.suggestion.line.packs} × {i.suggestion.line.brand} {i.suggestion.line.packLabel} (
                  {eur(i.suggestion.line.lineTotal)}) by {day(i.suggestion.neededBy)}.{' '}
                  <span className="muted">{i.suggestion.why}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {due.length > 0 ? (
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={quote}>
            {busy ? 'Requesting…' : `Get signed quote for the reorder (${eur(result.suggestedTotal)})`}
          </button>
        </div>
      ) : (
        <div className="small muted">Nothing needs reordering this week.</div>
      )}
      <ErrorLine error={error} />
    </>
  );
}

// --- supplier problems ---------------------------------------------------------------

function DisruptionsView({ result }: { result: DisruptionsResult }) {
  const { push } = useContext(Nav);
  const { busy, error, run } = useAction();
  if (!result.orders.length)
    return (
      <>
        <Brand />
        <div className="card notice ok">No supplier problems. Every confirmed order is on track.</div>
      </>
    );
  return (
    <>
      <Brand />
      {result.orders.map(({ orderId, summary, disruption: d }) => (
        <div
          key={orderId}
          className="card">
          <div className="row">
            <span className="pill warn">Supplier problem</span>
            <span className="spacer" />
            <span className="small muted">Order {orderId}</span>
          </div>
          <div className="title">{summary}</div>
          <div className="small muted">
            {d.reason}. {money(d.creditValue)} credited for the missing part.
          </div>
          {d.options.length === 0 && <div className="small">No replacement in stock.</div>}
          {d.options.map((o) => (
            <div
              key={o.optionId}
              className="line">
              <div className="row">
                <span>
                  <b>
                    {o.line.brand} {o.line.productName}
                  </b>
                  <br />
                  <span className="muted small">
                    {o.line.packs} × {o.line.packLabel} · {day(o.line.deliveries.at(-1)?.date ?? '')}
                  </span>
                </span>
                <span className="spacer" />
                <span className="num">{eur(o.line.lineTotal)}</span>
              </div>
              <div className="chips">
                <span className={`chip ${o.kind === 'same-product' ? 'ok' : 'info'}`}>
                  {o.kind === 'same-product' ? 'Same product' : 'Substitute'}
                </span>
                <span className={`chip ${o.priceDiff > 0.005 ? 'warn' : 'ok'}`}>
                  {Math.abs(o.priceDiff) < 0.01 ? 'Same price' : o.priceDiff > 0 ? `+${money(o.priceDiff)}` : `−${money(-o.priceDiff)}`}
                </span>
                <span className={`chip ${o.daysLater > 0 ? 'warn' : 'ok'}`}>
                  {o.daysLater === 0 ? 'Same day' : o.daysLater > 0 ? `${o.daysLater} day(s) later` : 'Earlier'}
                </span>
                {o.needsApproval && <span className="chip warn">Needs approval</span>}
              </div>
              <div className="actions">
                <button
                  className={o.optionId === 'R1' ? 'primary' : ''}
                  disabled={busy}
                  onClick={() =>
                    run(
                      'widget_resolve_disruption',
                      { orderId, optionId: o.optionId },
                      (payload) => {
                        push(payload);
                        if (payload.kind === 'order')
                          tellModel(
                            `The buyer chose replacement ${o.optionId} for order ${orderId} in the widget: order ${payload.order.orderId} is ${payload.order.status}.`,
                          );
                      },
                      `Order replacement ${o.optionId} for order ${orderId}.`,
                    )
                  }>
                  Use this
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
      <ErrorLine error={error} />
    </>
  );
}

// --- delivery check -------------------------------------------------------------------

function ReconciliationView({ result }: { result: ReconciliationResult }) {
  const { push } = useContext(Nav);
  const { busy, error, run } = useAction();
  const [copied, setCopied] = useState(false);
  const d = result.delivery;
  const short = d.lines.filter((l) => l.received < l.ordered);

  const copyDraft = async () => {
    if (!d.followUp) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${d.followUp.subject}\n\n${d.followUp.body}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <Brand right={<span className={`pill ${short.length ? 'warn' : 'ok'}`}>{short.length ? `Short by ${money(d.shortValue)}` : 'Complete'}</span>} />
      <div className="heading">Delivery check · {result.orderId}</div>
      <div className="card">
        <div className="grid3">
          <span className="h">Product</span>
          <span className="h n">Ordered</span>
          <span className="h n">Picked</span>
          <span className="h n">Received</span>
          {d.lines.map((l) => (
            <Fragment key={l.productId}>
              <span key={`${l.productId}-n`}>
                {l.productName}
                {l.issue && <div className="small danger">{l.issue}</div>}
              </span>
              <span
                key={`${l.productId}-o`}
                className="n">
                {qty(l.ordered, l.baseUnit)}
              </span>
              <span
                key={`${l.productId}-p`}
                className={`n ${l.picked < l.ordered ? 'danger' : ''}`}>
                {qty(l.picked, l.baseUnit)}
              </span>
              <span
                key={`${l.productId}-r`}
                className={`n ${l.received < l.picked ? 'danger' : ''}`}>
                {qty(l.received, l.baseUnit)}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
      {d.followUp && (
        <div className="card">
          <div className="row">
            <span className="small muted label">Draft follow-up</span>
            <span className="spacer" />
            {d.followUp.sentAt && <span className="pill ok">Sent</span>}
          </div>
          <b className="small">{d.followUp.subject}</b>
          <pre className="draft">{d.followUp.body}</pre>
          <div className="actions">
            <button onClick={copyDraft}>{copied ? 'Copied' : 'Copy draft'}</button>
            <button
              disabled={busy}
              onClick={() =>
                run(
                  'widget_request_quote',
                  { lines: short.map((l) => ({ productId: l.productId, quantity: Math.round((l.ordered - l.received) * 100) / 100 })) },
                  push,
                  `Get a quote for the items missing from order ${result.orderId}.`,
                )
              }>
              Quote the missing items
            </button>
          </div>
        </div>
      )}
      <ErrorLine error={error} />
    </>
  );
}

// --- audit ----------------------------------------------------------------------

function actorKind(actor: string) {
  return actor.startsWith('human') || actor.startsWith('buyer')
    ? 'human'
    : actor.startsWith('agent')
      ? 'agent'
      : 'gateway';
}

function AuditView({ result }: { result: AuditResult }) {
  return (
    <>
      <Brand
        right={
          <span
            className={`pill ${result.chainValid ? 'ok' : 'danger'}`}
            title="Each entry's SHA-256 hash covers the previous one">
            {result.chainValid ? '✓ Hash chain intact' : 'Hash chain broken'}
          </span>
        }
      />
      <div className="heading">Audit trail · {result.orderId}</div>
      <ol className="timeline">
        {result.events.map((e) => (
          <li
            key={e.seq}
            className={actorKind(e.actor)}>
            <div className="row small muted">
              <span className={`who ${actorKind(e.actor)}`}>{e.actor.replace(/^\w+: /, '')}</span>
              <span className="spacer" />
              <span title={e.at}>{time(e.at)}</span>
            </div>
            <div>{e.summary}</div>
            {e.reason && <div className="small muted">Why: {e.reason}</div>}
            <div
              className="hash"
              title={e.hash}>
              #{e.seq} · {e.hash.slice(0, 12)}…
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

// --- assortment -----------------------------------------------------------------

function AssortmentView({ result }: { result: AssortmentResult }) {
  const count = result.categories.reduce((n, c) => n + c.items.length, 0);
  return (
    <>
      <Brand right={<span className="muted small">{result.buyer}</span>} />
      <div className="heading">
        Assortment <span className="muted">· {count} products</span>
      </div>
      {result.categories.map((c) => (
        <div
          key={c.name}
          className="card">
          <div className="row">
            <span className="small muted label">{c.name}</span>
            <span className="spacer" />
            {!c.items[0]?.withinMandate && <span className="pill warn">Needs approval</span>}
          </div>
          {c.items.map((i) => (
            <div
              key={i.id}
              className="line">
              <div className="row">
                <span>
                  <ProductImage src={i.image} name={i.name} /><b>{i.name}</b>
                  <br />
                  <span className="muted small">
                    {i.brand} · {i.packLabel} · {i.id}
                  </span>
                </span>
                <span className="spacer" />
                <span className="num">
                  {eur(i.packPrice)}
                  <br />
                  <span className="muted small">
                    {eur(i.unitPrice)}/{i.baseUnit}
                  </span>
                </span>
              </div>
              <div className="chips">
                <span className="chip">
                  {qty(i.inStock, i.baseUnit)} from {day(i.firstDelivery)}
                </span>
                <span className="chip">{i.origin}</span>
                {i.breaksPromise && (
                  <span
                    className="chip danger"
                    title={i.breaksPromise}>
                    Breaks your promise
                  </span>
                )}
                {i.certificates.map((x) => (
                  <span
                    key={x}
                    className="chip cert">
                    {x}
                  </span>
                ))}
                {i.dietary
                  .filter((d) => d !== 'gluten-free')
                  .map((d) => (
                    <span
                      key={d}
                      className="chip">
                      {d}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// --- root -----------------------------------------------------------------------

function View({ payload }: { payload: WidgetPayload }) {
  switch (payload.kind) {
    case 'offers':
      return <OffersView result={payload} />;
    case 'quote':
      return <QuoteView result={payload} />;
    case 'order':
      return (
        <OrderView
          key={payload.order.orderId}
          result={payload}
        />
      );
    case 'audit':
      return <AuditView result={payload} />;
    case 'assortment':
      return <AssortmentView result={payload} />;
    case 'basket':
      return <BasketView result={payload} />;
    case 'replenishment':
      return <StockView result={payload} />;
    case 'disruptions':
      return <DisruptionsView result={payload} />;
    case 'reconciliation':
      return <ReconciliationView result={payload} />;
  }
}

function Widget() {
  const { status, payload, error } = useWidgetState();
  const [stack, setStack] = useState<WidgetPayload[]>([]);

  // A new tool result from the host starts a fresh stack.
  useEffect(() => {
    if (payload) setStack([payload]);
  }, [payload]);

  if (status === 'error') return <div className="card notice danger">{error}</div>;
  const current = stack.at(-1);
  if (!current)
    return (
      <>
        <Brand />
        <div className="card muted loading">Contacting Valio Aimo…</div>
      </>
    );
  return (
    <Nav.Provider
      value={{
        push: (p) => setStack((s) => [...s, p]),
        back: stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined,
      }}>
      <View
        key={stack.length}
        payload={current}
      />
    </Nav.Provider>
  );
}

// `app` is imported for its side effect of connecting to the host as early as possible.
void app;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Widget />
  </StrictMode>,
);
