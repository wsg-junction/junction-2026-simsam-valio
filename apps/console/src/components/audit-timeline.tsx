import { Bot, MousePointerClick, Server, Truck, UserCheck } from 'lucide-react';
import type { AuditEvent } from '@/lib/api';
import { actor, relative, time, type ActorKind } from '@/lib/format';
import { cn } from '@/lib/utils';

export const ACTOR_STYLE: Record<ActorKind, { icon: typeof Bot; label: string; className: string }> = {
  agent: { icon: Bot, label: 'Agent', className: 'bg-primary/10 text-primary' },
  buyer: { icon: MousePointerClick, label: 'You, in the chat', className: 'bg-chart-4/15 text-chart-4' },
  human: { icon: UserCheck, label: 'Person', className: 'bg-warning/20 text-warning-foreground' },
  gateway: { icon: Server, label: 'Valio Aimo', className: 'bg-muted text-muted-foreground' },
  supplier: { icon: Truck, label: 'Supplier', className: 'bg-destructive/10 text-destructive' },
};

const short = (amount: string) => amount.replace(/,$/, '').replace(/\.00$/, '');

/** Plain wording for the simple view; the exact log text is shown with technical details on. */
function friendly(e: AuditEvent): string {
  const s = e.summary;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^Placed order \S+ from quote \S+ \((€[\d,.]+)\)$/))) return `Placed an order (${short(m[1])})`;
  if ((m = s.match(/^Issued signed quote \S+: (€[\d,.]+)/))) return `Gave a signed, fixed price: ${short(m[1])}`;
  if ((m = s.match(/^Sent to ([^,]+),.* for approval$/))) return `Asked ${m[1].split(' ')[0]} to approve`;
  if (s.startsWith('Confirmed automatically')) return 'Confirmed automatically, within your rules';
  if ((m = s.match(/^(Approved|Rejected) order \S+ \((€[\d,.]+)\)$/))) return `${m[1]} the order (${short(m[2])})`;
  if ((m = s.match(/^Returned (\d+) offer\(s\)/))) return `Found ${m[1]} offers`;
  if (s === 'Changed the agent mandate') return 'Changed the rules';
  if ((m = s.match(/^Created MCP token "(.+)"$/))) return `Connected a new assistant: ${m[1]}`;
  if ((m = s.match(/^Revoked MCP token "(.+)"$/))) return `Removed access for ${m[1]}`;
  if ((m = s.match(/^Asked for changes to order \S+: (.+)$/))) return `Approved with changes: ${m[1]}`;
  if ((m = s.match(/^Order \S+ revised as \S+ \((€[\d,.]+)\)$/))) return `Made a revised order (${short(m[1])})`;
  if (s.startsWith('Confirmed under')) return 'Confirmed, within the approver’s conditions';
  if ((m = s.match(/^Can't deliver (.+) for order \S+$/))) return `Can’t deliver ${m[1]}`;
  if ((m = s.match(/^Found (\d+) replacement/))) return `Found ${m[1]} replacement option${m[1] === '1' ? '' : 's'}`;
  if (s.startsWith('No replacement in stock')) return 'No replacement in stock';
  if (s.startsWith('Supplier problem on')) return 'Replacement ordered';
  if (s.startsWith('Recorded the delivery')) return 'Recorded the delivery';
  if ((m = s.match(/^Delivery of \S+ is short on (\d+) item\(s\), (€[\d,.]+) to credit$/)))
    return `Delivery is short on ${m[1]} item${m[1] === '1' ? '' : 's'}, ${short(m[2])} to credit`;
  if (/^Delivery of \S+ matches the order$/.test(s)) return 'Delivery matches the order';
  if (s.startsWith('Sent the delivery follow-up')) return 'Sent the follow-up to Valio Aimo';
  if ((m = s.match(/^Proposed basket \S+: (.+)$/))) return `Proposed a basket: ${m[1]}`;
  if (s.startsWith('Accepted the shortage')) return 'Accepted the shortage without a replacement';
  if ((m = s.match(/^Requested a quote for (.+)$/)) && m[1].split(' + ').length > 2)
    return `Requested a quote for ${m[1].split(' + ').length} products`;
  return s;
}

/**
 * Activity list. `showReasons` adds the "why" line; `technical` shows the exact log text, every reason, and the
 * sequence numbers and hashes.
 */
export function AuditTimeline({
  events,
  showReasons = true,
  technical = false,
  relativeTimes = false,
}: {
  events: AuditEvent[];
  showReasons?: boolean;
  technical?: boolean;
  relativeTimes?: boolean;
}) {
  return (
    <ol className="space-y-4">
      {events.map((e) => {
        const a = actor(e.actor);
        const style = ACTOR_STYLE[a.kind];
        return (
          <li
            key={e.seq}
            className="flex gap-3">
            <span
              className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', style.className)}
              title={`${style.label}: ${a.name}`}>
              <style.icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <p className="flex-1 text-sm leading-snug">{technical ? e.summary : friendly(e)}</p>
                <span
                  className="text-muted-foreground shrink-0 text-xs tabular-nums"
                  title={e.at}>
                  {relativeTimes ? relative(e.at) : time(e.at)}
                </span>
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">{a.name}</p>
              {showReasons && e.reason && (technical || a.kind !== 'gateway') && (
                <p className="text-muted-foreground mt-1 text-xs italic">
                  {technical ? `Why: ${e.reason}` : `“${e.reason}”`}
                </p>
              )}
              {technical && (
                <p
                  className="text-muted-foreground/70 mt-1 font-mono text-[10.5px]"
                  title={e.hash}>
                  #{e.seq} · {e.action} · {e.hash.slice(0, 16)}… ← {e.prevHash.slice(0, 8)}…
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
