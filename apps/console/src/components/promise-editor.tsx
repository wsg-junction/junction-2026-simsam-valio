import { Check, ChevronDown, ExternalLink, Plus, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, useLive, type ExcludedProduct, type PromiseKind, type PromiseRule } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Draft {
  rules: PromiseRule[];
  statement: string;
  published: boolean;
}

/** Categories that make sense by default for each kind of promise. */
const DEFAULT_SCOPE: Partial<Record<PromiseKind, string[]>> = {
  'free-range': ['Eggs'],
  fairtrade: ['Coffee & Tea'],
};

/**
 * The buyer's sourcing promise to guests: hard rules the gateway enforces on every quote and order, with a
 * public page guests can read.
 */
export function PromiseEditor({ categories }: { categories: string[] }) {
  const { data, refresh } = useLive(api.promise, [], 15000);
  const [draft, setDraft] = useState<Draft>();
  const [excluded, setExcluded] = useState<ExcludedProduct[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !draft) {
      setDraft({ rules: data.promise.rules, statement: data.promise.statement, published: data.promise.published });
      setExcluded(data.excluded);
    }
  }, [data, draft]);

  const dirty = useMemo(
    () =>
      !!data &&
      !!draft &&
      JSON.stringify({ rules: data.promise.rules, statement: data.promise.statement, published: data.promise.published }) !==
        JSON.stringify(draft),
    [data, draft],
  );

  // Show what the draft rules would rule out, as they're edited.
  const rulesKey = JSON.stringify(draft?.rules);
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      api
        .previewPromise(draft.rules)
        .then((r) => setExcluded(r.excluded))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesKey]);

  if (!data || !draft) return <Skeleton className="h-72 rounded-xl" />;

  const kinds = data.kinds;
  const setRules = (rules: PromiseRule[]) => setDraft({ ...draft, rules });
  const update = (id: string, patch: Partial<PromiseRule>) =>
    setRules(draft.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = (kind: PromiseKind) =>
    setRules([
      ...draft.rules,
      { id: `new-${Date.now()}`, kind, categories: DEFAULT_SCOPE[kind] ?? [], allergen: kind === 'no-allergen' ? 'peanuts' : undefined },
    ]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.updatePromise(draft);
      setDraft({ rules: next.promise.rules, statement: next.promise.statement, published: next.promise.published });
      refresh();
      toast.success('Promise saved', {
        description: next.changes.length ? 'Every quote and order is checked against it from now on.' : undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <ShieldCheck className="text-success size-4" />
            Your promise to guests
          </h2>
          <p className="text-muted-foreground text-sm">
            Stricter than the rules above: agents can’t buy anything that breaks it, and no one can approve an
            exception.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          asChild>
          <a
            href={data.publicUrl}
            target="_blank"
            rel="noreferrer">
            <ExternalLink />
            Public page
          </a>
        </Button>
      </div>

      <Card>
        <CardContent className="divide-y">
          <div className="space-y-3 pb-5">
            {draft.rules.length === 0 && <p className="text-muted-foreground text-sm">No promises yet.</p>}
            {draft.rules.map((r) => (
              <div
                key={r.id}
                className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-medium">{kinds[r.kind].label}</span>
                  {r.kind === 'no-allergen' && (
                    <Input
                      value={r.allergen ?? ''}
                      onChange={(e) => update(r.id, { allergen: e.target.value })}
                      placeholder="e.g. peanuts"
                      aria-label="Allergen"
                      className="h-8 w-36"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove promise"
                    onClick={() => setRules(draft.rules.filter((x) => x.id !== r.id))}>
                    <X />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground mr-1 text-xs">For</span>
                  <Chip
                    on={r.categories.length === 0}
                    onClick={() => update(r.id, { categories: [] })}>
                    Everything
                  </Chip>
                  {categories.map((c) => {
                    const on = r.categories.includes(c);
                    return (
                      <Chip
                        key={c}
                        on={on}
                        onClick={() => update(r.id, { categories: on ? r.categories.filter((x) => x !== c) : [...r.categories, c] })}>
                        {c}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm">
                  <Plus />
                  Add a promise
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(Object.keys(kinds) as PromiseKind[]).map((k) => (
                  <DropdownMenuItem
                    key={k}
                    onClick={() => add(k)}>
                    {kinds[k].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="space-y-2 py-5">
            <button
              type="button"
              onClick={() => setShowExcluded(!showExcluded)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm">
              Rules out {excluded.length} of {data.productCount} products
              <ChevronDown className={cn('size-4 transition-transform', showExcluded && 'rotate-180')} />
            </button>
            {showExcluded && (
              <ul className="text-muted-foreground space-y-1 text-sm">
                {excluded.length === 0 && <li>Nothing in the assortment is ruled out.</li>}
                {excluded.map((p) => (
                  <li key={p.id}>
                    <span className="text-foreground">
                      {p.brand} {p.name}
                    </span>{' '}
                    ({p.packLabel}, {p.origin}): {p.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3 pt-5">
            <div className="grid gap-2">
              <Label htmlFor="statement">What guests read</Label>
              <Textarea
                id="statement"
                value={draft.statement}
                maxLength={600}
                onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label
                htmlFor="published"
                className="text-sm font-normal">
                Show the promise on a public page you can link from your menu
              </Label>
              <Switch
                id="published"
                checked={draft.published}
                onCheckedChange={(published) => setDraft({ ...draft, published })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {data.summary.ordersChecked} {data.summary.ordersChecked === 1 ? 'order' : 'orders'} since the last change,{' '}
          {data.summary.ordersKeptPromise === data.summary.ordersChecked ? 'all' : data.summary.ordersKeptPromise} kept the
          promise. Version {data.promise.version}.
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() =>
                setDraft({ rules: data.promise.rules, statement: data.promise.statement, published: data.promise.published })
              }>
              Discard
            </Button>
          )}
          <Button
            disabled={!dirty || saving}
            onClick={save}>
            Save promise
          </Button>
        </div>
      </div>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
      )}>
      {on && <Check className="size-3" />}
      {children}
    </button>
  );
}
