import { Boxes, CalendarDays, CalendarPlus, History, Play, Trash2, UtensilsCrossed } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { api, day, eur, qty, useLive, type AutomationsState, type EventView, type Meal } from '../api';
import { Row, Section, SettingsPage } from '../page';
import { useAssistant } from '../use-conversation';

export function AutomationsPage() {
  const { data, refresh, setData } = useLive(api.automations, 6000);
  const { data: events, refresh: refreshEvents } = useLive(api.events, 10000);

  const update = async (patch: Parameters<typeof api.updateAutomations>[0]) => {
    try {
      setData(await api.updateAutomations(patch));
      refreshEvents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <SettingsPage
      title="Automations"
      description="Let Aimo keep the kitchen stocked and get ready for big events. Everything it orders still follows your limits and requirements.">
      {!data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <>
          <StockAutopilot
            data={data}
            update={update}
            refresh={refresh}
          />
          <EventsSection
            data={data}
            events={events}
            update={update}
            refreshEvents={refreshEvents}
          />
          <Runs data={data} />
        </>
      )}
    </SettingsPage>
  );
}

function StockAutopilot({ data, update, refresh }: { data: AutomationsState; update: (p: Parameters<typeof api.updateAutomations>[0]) => void; refresh: () => void }) {
  const s = data.settings.stock;
  const stock = new Map(data.stock.items.map((i) => [i.key, i]));
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title="Stock autopilot"
      description="Watches stock and usage, and reorders before something runs out. Each reorder covers up to a week, never more than the product keeps."
      icon={<Boxes className="mt-0.5 size-5 text-sky-600" />}
      right={
        <Switch
          checked={s.enabled}
          onCheckedChange={(enabled) => update({ stock: { enabled } })}
          aria-label="Stock autopilot"
        />
      }>
      <div className={cn('space-y-5', !s.enabled && 'pointer-events-none opacity-50')}>
        <Row
          label="When stock runs low"
          hint={s.mode === 'auto' ? 'Orders on its own, within your limits.' : 'Suggests a reorder you confirm with one click.'}>
          <ToggleGroup
            type="single"
            variant="outline"
            value={s.mode}
            onValueChange={(mode) => mode && update({ stock: { mode: mode as 'ask' | 'auto' } })}>
            <ToggleGroupItem
              value="ask"
              className="px-3">
              Ask me first
            </ToggleGroupItem>
            <ToggleGroupItem
              value="auto"
              className="px-3">
              Order automatically
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>

        <div className="divide-y rounded-xl border">
          {data.items.map((item) => {
            const st = stock.get(item.key);
            const tone = st?.status === 'urgent' ? 'text-red-600' : st?.status === 'reorder' ? 'text-amber-600' : 'text-muted-foreground';
            return (
              <div
                key={item.key}
                className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{item.name}</div>
                  {st && (
                    <div className={cn('text-xs', tone)}>
                      {st.message.replace(`${st.name.replace(/ \d.*$/, '')} `, '').replace(/^: /, '')} · {qty(st.onHand, st.baseUnit)} left
                    </div>
                  )}
                </div>
                <Switch
                  checked={s.items[item.key] ?? false}
                  onCheckedChange={(on) => update({ stock: { items: { [item.key]: on } } })}
                  aria-label={`Autopilot for ${item.name}`}
                />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.simulateDay();
              refresh();
              setBusy(false);
              toast.success('One day of breakfast service used up', {
                description: s.mode === 'auto' ? 'The autopilot reorders anything that now runs low.' : 'Check Coming up on the chat page.',
              });
            }}>
            <UtensilsCrossed />
            Simulate a day of service
          </Button>
          {s.mode === 'auto' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api.runAutomations();
                refresh();
              }}>
              <Play />
              Check now
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function EventsSection({
  data,
  events,
  update,
  refreshEvents,
}: {
  data: AutomationsState;
  events?: EventView[];
  update: (p: Parameters<typeof api.updateAutomations>[0]) => void;
  refreshEvents: () => void;
}) {
  const e = data.settings.events;
  const { act } = useAssistant();
  return (
    <Section
      title="Big events"
      description="Plans a basket for each event and reminds you to order in good time. Deliveries arrive the day before."
      icon={<CalendarDays className="mt-0.5 size-5 text-violet-600" />}
      right={
        <Switch
          checked={e.enabled}
          onCheckedChange={(enabled) => update({ events: { enabled } })}
          aria-label="Event reminders"
        />
      }>
      <div className="space-y-5">
        <div className={cn('space-y-4', !e.enabled && 'pointer-events-none opacity-50')}>
          <Row
            label="Remind me"
            hint={`${e.remindDaysBefore} days before the event`}>
            <Slider
              className="w-56"
              min={1}
              max={21}
              step={1}
              value={[e.remindDaysBefore]}
              onValueCommit={([v]) => update({ events: { remindDaysBefore: v } })}
              aria-label="Days before"
            />
          </Row>
          <Row
            label="Order event baskets automatically"
            hint="When the reminder is due. Anything outside your limits still waits for you.">
            <Switch
              checked={e.autoOrder}
              onCheckedChange={(autoOrder) => update({ events: { autoOrder } })}
              aria-label="Auto-order events"
            />
          </Row>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Upcoming</h3>
            <AddEvent onAdded={refreshEvents} />
          </div>
          {!events ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : events.length === 0 ? (
            <p className="text-muted-foreground text-sm">No upcoming events.</p>
          ) : (
            <div className="divide-y rounded-xl border">
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <div className="bg-muted flex w-12 flex-col items-center rounded-lg py-1 text-center leading-tight">
                    <span className="text-muted-foreground text-[10px] uppercase">{day(ev.date).split(' ')[2]}</span>
                    <span className="text-lg font-semibold">{day(ev.date).split(' ')[1]}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{ev.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {ev.guests} guests{ev.vegan ? `, ${ev.vegan} vegan` : ''} · {ev.meal.replace('-', ' ')} · about {eur(ev.estimate.total)}
                      {ev.budget ? ` of ${eur(ev.budget)}` : ''}
                      {ev.status === 'planned' ? ` · order by ${day(ev.orderBy)}` : ''}
                    </div>
                  </div>
                  {ev.status === 'ordered' ? (
                    <Badge
                      variant="secondary"
                      className="border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                      {ev.orderStatus === 'pending_approval' ? 'Ordered, needs approval' : 'Ordered'}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      className="rounded-full"
                      onClick={async () => {
                        await act({ type: 'order-event', eventId: ev.id }, `Ordered for ${ev.name}`);
                        refreshEvents();
                      }}>
                      Order all
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${ev.name}`}
                    onClick={async () => {
                      await api.removeEvent(ev.id);
                      refreshEvents();
                    }}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function AddEvent({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const tomorrow = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({ name: '', date: tomorrow, meal: 'breakfast' as Meal, guests: 100, vegan: 10, budget: 0 });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm">
          <CalendarPlus />
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an event</DialogTitle>
          <DialogDescription>Aimo plans the basket from the number of guests and reminds you to order.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ev-name">Name</Label>
            <Input
              id="ev-name"
              placeholder="e.g. Midsummer conference"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ev-date">Date</Label>
              <Input
                id="ev-date"
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Meal</Label>
              <Select
                value={form.meal}
                onValueChange={(v) => set('meal', v as Meal)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="breakfast">Breakfast</SelectItem>
                  <SelectItem value="brunch">Brunch</SelectItem>
                  <SelectItem value="coffee-break">Coffee break</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ['guests', 'Guests'],
                ['vegan', 'Of them vegan'],
                ['budget', 'Budget €'],
              ] as const
            ).map(([k, label]) => (
              <div
                key={k}
                className="grid gap-2">
                <Label htmlFor={`ev-${k}`}>{label}</Label>
                <Input
                  id={`ev-${k}`}
                  type="number"
                  min={0}
                  value={form[k]}
                  placeholder={k === 'budget' ? 'Optional' : undefined}
                  onChange={(e) => set(k, Math.max(0, e.target.valueAsNumber || 0))}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                await api.addEvent({ ...form, budget: form.budget || undefined });
                toast.success(`${form.name} added`);
                setOpen(false);
                setForm({ ...form, name: '' });
                onAdded();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not add the event');
              }
            }}>
            Add event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Runs({ data }: { data: AutomationsState }) {
  return (
    <Section
      title="What the automations did"
      icon={<History className="text-muted-foreground mt-0.5 size-5" />}>
      {data.runs.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {data.runs.map((r, i) => (
            <li
              key={i}
              className="flex items-baseline gap-3">
              <span className="text-muted-foreground w-12 shrink-0 text-xs tabular-nums">
                {new Date(r.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="flex-1">{r.summary}</span>
              {r.status === 'pending_approval' && (
                <Badge
                  variant="secondary"
                  className="border-transparent bg-amber-500/15 text-amber-700">
                  Needs approval
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
