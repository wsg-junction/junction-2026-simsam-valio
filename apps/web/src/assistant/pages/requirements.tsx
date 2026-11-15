import { Check, ChevronDown, Egg, ExternalLink, Globe2, Leaf, MapPin, Milk, Sprout, Wheat, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { api, useLive, type ExcludedProduct, type PromiseKind, type PromiseRule } from '../api';
import { Section, SettingsPage } from '../page';

/** The requirements, as switches. Each maps to a promise rule the gateway enforces. */
const OPTIONS: { kind: PromiseKind; title: string; text: string; icon: typeof Leaf; scope: string[] }[] = [
  { kind: 'vegan', title: 'Vegan only', text: 'No animal products at all. Baskets plan plant-based options for every guest.', icon: Sprout, scope: [] },
  { kind: 'lactose-free', title: 'Lactose-free only', text: 'Every product must be lactose-free.', icon: Milk, scope: [] },
  { kind: 'gluten-free', title: 'Gluten-free only', text: 'Every product must be gluten-free.', icon: Wheat, scope: [] },
  { kind: 'organic', title: 'Organic only', text: 'EU Organic certified products only.', icon: Leaf, scope: [] },
  { kind: 'eu-origin', title: 'EU origin only', text: 'Nothing from outside the European Union.', icon: Globe2, scope: [] },
  { kind: 'finnish-origin', title: 'Finnish origin', text: 'Made in Finland.', icon: MapPin, scope: ['Dairy'] },
  { kind: 'free-range', title: 'Free-range eggs', text: 'Eggs from free-range hens only.', icon: Egg, scope: ['Eggs'] },
  { kind: 'fairtrade', title: 'Fairtrade coffee & tea', text: 'Fairtrade certified only.', icon: Leaf, scope: ['Coffee & Tea'] },
];

const ALLERGENS = ['milk', 'egg', 'oats', 'gluten', 'nuts', 'soy'];

interface Draft {
  rules: PromiseRule[];
  statement: string;
  published: boolean;
}

export function RequirementsPage() {
  const { data, refresh } = useLive(api.promise, 20000);
  const { data: info } = useLive(api.info, 60000);
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

  const rulesKey = JSON.stringify(draft?.rules);
  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => api.previewPromise(draft.rules).then((r) => setExcluded(r.excluded)).catch(() => {}), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesKey]);

  const dirty = useMemo(
    () => !!data && !!draft && JSON.stringify({ rules: data.promise.rules, statement: data.promise.statement, published: data.promise.published }) !== JSON.stringify(draft),
    [data, draft],
  );

  if (!data || !draft || !info) {
    return (
      <SettingsPage
        title="Requirements"
        description="What your kitchen serves.">
        <Skeleton className="h-96 rounded-2xl" />
      </SettingsPage>
    );
  }

  const ruleFor = (kind: PromiseKind) => draft.rules.find((r) => r.kind === kind);
  const setRules = (rules: PromiseRule[]) => setDraft({ ...draft, rules });
  const toggle = (kind: PromiseKind, scope: string[]) => {
    const existing = ruleFor(kind);
    setRules(existing ? draft.rules.filter((r) => r !== existing) : [...draft.rules, { id: `new-${kind}`, kind, categories: scope }]);
  };
  const allergens = draft.rules.filter((r) => r.kind === 'no-allergen');
  const toggleAllergen = (a: string) => {
    const existing = allergens.find((r) => r.allergen === a);
    setRules(existing ? draft.rules.filter((r) => r !== existing) : [...draft.rules, { id: `new-${a}`, kind: 'no-allergen', categories: [], allergen: a }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.updatePromise(draft);
      setDraft({ rules: r.promise.rules, statement: r.promise.statement, published: r.promise.published });
      refresh();
      toast.success('Requirements saved', { description: 'Aimo only buys products that meet them, from now on.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage
      title="Requirements"
      description="What your kitchen serves. Aimo never buys anything that breaks these, and no one can approve an exception."
      actions={
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => setDraft({ rules: data.promise.rules, statement: data.promise.statement, published: data.promise.published })}>
              Discard
            </Button>
          )}
          <Button
            disabled={!dirty || saving}
            onClick={save}>
            Save requirements
          </Button>
        </div>
      }>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => {
          const rule = ruleFor(o.kind);
          const on = !!rule;
          return (
            <div
              key={o.kind}
              className={cn('bg-card rounded-2xl border p-4 transition-colors', on && 'border-emerald-500/50 bg-emerald-500/5')}>
              <div className="flex items-start gap-3">
                <o.icon className={cn('mt-0.5 size-5', on ? 'text-emerald-600' : 'text-muted-foreground')} />
                <div className="flex-1">
                  <div className="font-medium">{o.title}</div>
                  <p className="text-muted-foreground text-sm">{o.text}</p>
                </div>
                <Switch
                  checked={on}
                  onCheckedChange={() => toggle(o.kind, o.scope)}
                  aria-label={o.title}
                />
              </div>
              {rule && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-8">
                  <span className="text-muted-foreground mr-1 text-xs">For</span>
                  <Chip
                    on={rule.categories.length === 0}
                    onClick={() => setRules(draft.rules.map((r) => (r === rule ? { ...r, categories: [] } : r)))}>
                    Everything
                  </Chip>
                  {info.categories.map((c) => {
                    const sel = rule.categories.includes(c);
                    return (
                      <Chip
                        key={c}
                        on={sel}
                        onClick={() =>
                          setRules(
                            draft.rules.map((r) =>
                              r === rule ? { ...r, categories: sel ? r.categories.filter((x) => x !== c) : [...r.categories, c] } : r,
                            ),
                          )
                        }>
                        {c}
                      </Chip>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Section
        title="Never contains"
        description="Allergens your kitchen keeps out completely.">
        <div className="flex flex-wrap gap-2">
          {ALLERGENS.map((a) => {
            const on = allergens.some((r) => r.allergen === a);
            return (
              <Chip
                key={a}
                on={on}
                large
                onClick={() => toggleAllergen(a)}>
                {on ? <X className="size-3.5" /> : null}
                {a}
              </Chip>
            );
          })}
        </div>
      </Section>

      <Section
        title="Effect on the assortment"
        description="Updates as you change the switches.">
        <button
          type="button"
          onClick={() => setShowExcluded(!showExcluded)}
          className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">
            Rules out {excluded.length} of {data.productCount} products
          </span>
          <ChevronDown className={cn('size-4 transition-transform', showExcluded && 'rotate-180')} />
        </button>
        {showExcluded && (
          <ul className="text-muted-foreground mt-3 space-y-1 text-sm">
            {excluded.length === 0 && <li>Nothing is ruled out.</li>}
            {excluded.map((p) => (
              <li key={p.id}>
                <span className="text-foreground">
                  {p.brand} {p.name}
                </span>{' '}
                ({p.packLabel}): {p.reason}
              </li>
            ))}
          </ul>
        )}
        {excluded.length > data.productCount * 0.6 && (
          <p className="mt-3 text-sm text-amber-600">That rules out most of the assortment; some menus may not be possible.</p>
        )}
      </Section>

      <Section
        title="Tell your guests"
        description="A public page you can link from your menu or website."
        right={
          <Button
            variant="ghost"
            size="sm"
            asChild>
            <a
              href={data.publicUrl}
              target="_blank"
              rel="noreferrer">
              <ExternalLink />
              Open
            </a>
          </Button>
        }>
        <div className="space-y-3">
          <Label htmlFor="statement">What guests read</Label>
          <Textarea
            id="statement"
            value={draft.statement}
            maxLength={600}
            onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
          />
          <div className="flex items-center justify-between gap-4">
            <Label
              htmlFor="published"
              className="font-normal">
              Publish the page
            </Label>
            <Switch
              id="published"
              checked={draft.published}
              onCheckedChange={(published) => setDraft({ ...draft, published })}
            />
          </div>
        </div>
      </Section>
    </SettingsPage>
  );
}

function Chip({ on, onClick, children, large }: { on: boolean; onClick: () => void; children: React.ReactNode; large?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border transition-colors',
        large ? 'px-3 py-1.5 text-sm capitalize' : 'px-2.5 py-0.5 text-xs',
        on ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:bg-accent',
      )}>
      {on && !large && <Check className="size-3" />}
      {children}
    </button>
  );
}
