import { Check, PencilLine, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, type Order } from '@/lib/api';
import { eur, money } from '@/lib/format';

type Mode = 'approve' | 'reject' | 'change';

/** Approve / Change / Reject, with an optional comment that goes to the agent and the audit trail. */
export function DecisionButtons({ order, onDone, size = 'sm' }: { order: Order; onDone?: () => void; size?: 'sm' | 'default' }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [capOn, setCapOn] = useState(false);
  const [cap, setCap] = useState(0);

  const open = (m: Mode) => {
    setMode(m);
    setQuantities(Object.fromEntries(order.lines.map((l) => [l.productId, l.quantity])));
    // A sensible starting point for the cap: the per-order amount just above the current total, rounded.
    setCap(Math.max(100, Math.floor((order.total * 0.9) / 50) * 50));
    setCapOn(false);
  };

  const changedLines = order.lines
    .filter((l) => quantities[l.productId] !== undefined && quantities[l.productId] !== l.quantity)
    .map((l) => ({ productId: l.productId, quantity: quantities[l.productId] }));
  const canChange = changedLines.length > 0 || capOn;

  const submit = async () => {
    if (!mode) return;
    setBusy(true);
    try {
      if (mode === 'change') {
        const detail = await api.requestChanges(
          order.orderId,
          { lines: changedLines.length ? changedLines : undefined, maxTotal: capOn ? cap : undefined },
          comment,
        );
        const revised = detail.related.find((o) => o.revisionOf === order.orderId);
        toast.success(
          revised
            ? revised.status === 'confirmed'
              ? `Revised order confirmed at ${eur(revised.total)}`
              : `Revised order at ${eur(revised.total)} needs your approval`
            : detail.order.status === 'confirmed'
              ? 'Approved: the total is already within your limit'
              : 'Sent to the agent to revise',
          { description: revised ? 'The gateway made the revised quote from your quantities.' : 'It’s confirmed automatically if it meets your conditions.' },
        );
      } else {
        await api.decide(order.orderId, mode === 'approve', comment);
        toast.success(`Order ${order.orderId} ${mode === 'approve' ? 'approved' : 'rejected'}`, {
          description: 'The agent sees the decision on its next status check.',
        });
      }
      setMode(null);
      setComment('');
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the decision');
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Mode, string> = {
    approve: `Approve order ${order.orderId}?`,
    reject: `Reject order ${order.orderId}?`,
    change: 'Approve with changes',
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size={size}
          onClick={() => open('approve')}>
          <Check />
          Approve
        </Button>
        <Button
          size={size}
          variant="outline"
          onClick={() => open('change')}>
          <PencilLine />
          Change…
        </Button>
        <Button
          size={size}
          variant="ghost"
          onClick={() => open('reject')}>
          <X />
          Reject
        </Button>
      </div>
      <Dialog
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className={mode === 'change' ? 'sm:max-w-lg' : undefined}>
          <DialogHeader>
            <DialogTitle>{mode && titles[mode]}</DialogTitle>
            <DialogDescription>
              {mode === 'approve'
                ? `Commits ${eur(order.total)} at the signed quote price and adds it to this week's spend.`
                : mode === 'reject'
                  ? 'The agent is told the order was rejected and can propose something else.'
                  : 'Say yes, but… New quantities are re-quoted right away. With only a price cap, the agent proposes the revision.'}
            </DialogDescription>
          </DialogHeader>

          {mode === 'change' && (
            <div className="grid gap-5">
              <div className="grid gap-2">
                <Label>Quantities</Label>
                <div className="divide-y rounded-lg border">
                  {order.lines.map((l) => (
                    <div
                      key={l.productId}
                      className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="truncate font-medium">{l.productName}</div>
                        <div className="text-muted-foreground text-xs">
                          {l.packLabel} · ordered {l.quantity} {l.baseUnit}
                        </div>
                      </div>
                      <InputGroup className="w-36">
                        <InputGroupInput
                          type="number"
                          min={0}
                          step={l.quantity / l.packs}
                          value={quantities[l.productId] ?? l.quantity}
                          className="tabular-nums"
                          aria-label={`Quantity of ${l.productName}`}
                          onChange={(e) =>
                            setQuantities({ ...quantities, [l.productId]: Math.max(0, e.target.valueAsNumber || 0) })
                          }
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>{l.baseUnit}</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-4">
                  <Label
                    htmlFor="cap"
                    className="font-normal">
                    Approve automatically if the total stays at or below
                  </Label>
                  <Switch
                    id="cap"
                    checked={capOn}
                    onCheckedChange={setCapOn}
                  />
                </div>
                {capOn && (
                  <InputGroup className="w-44">
                    <InputGroupAddon>
                      <InputGroupText>€</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      type="number"
                      min={1}
                      step={50}
                      value={cap}
                      className="tabular-nums"
                      aria-label="Maximum total"
                      onChange={(e) => setCap(Math.max(1, e.target.valueAsNumber || 0))}
                    />
                  </InputGroup>
                )}
                {capOn && cap >= order.total && changedLines.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    The current total ({money(order.total)}) is already within this, so this approves it as it is.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="comment">Comment for the agent and the audit trail (optional)</Label>
            <Textarea
              id="comment"
              value={comment}
              placeholder={
                mode === 'approve'
                  ? 'e.g. Organic is fine for the gala dinner'
                  : mode === 'change'
                    ? 'e.g. The gala only needs 600 L'
                    : 'e.g. Too expensive this week'
              }
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant={mode === 'reject' ? 'destructive' : 'default'}
              disabled={busy || (mode === 'change' && !canChange)}
              onClick={submit}>
              {mode === 'approve' ? 'Approve order' : mode === 'reject' ? 'Reject order' : 'Send changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
