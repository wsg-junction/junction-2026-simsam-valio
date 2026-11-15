import { Check, Lock, ShieldQuestion, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { api, eur, useLive, type Mandate } from '../api';
import { Row, Section, SettingsPage } from '../page';

type Draft = Pick<
  Mandate,
  'autoApproveLimit' | 'weeklyBudget' | 'allowedCategories' | 'requireOnTimeDelivery' | 'requireRequirementsMatch' | 'requireSubstituteApproval'
>;

const pick = (m: Mandate): Draft => ({
  autoApproveLimit: m.autoApproveLimit,
  weeklyBudget: m.weeklyBudget,
  allowedCategories: m.allowedCategories,
  requireOnTimeDelivery: m.requireOnTimeDelivery,
  requireRequirementsMatch: m.requireRequirementsMatch,
  requireSubstituteApproval: m.requireSubstituteApproval,
});

export function LimitsPage() {
  const { data: mandate, refresh } = useLive(api.mandate, 15000);
  const { data: info } = useLive(api.info, 60000);
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mandate && !draft) setDraft(pick(mandate));
  }, [mandate, draft]);

  if (!mandate || !draft || !info) {
    return (
      <SettingsPage
        title="Limits"
        description="How much Aimo may spend on its own.">
        <Skeleton className="h-96 rounded-2xl" />
      </SettingsPage>
    );
  }

  const dirty = JSON.stringify(pick(mandate)) !== JSON.stringify(draft);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.updateMandate(draft);
      setDraft(pick(r.mandate));
      refresh();
      toast.success('Limits saved', { description: r.changes.join('; ') || undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage
      title="Limits"
      description="How much Aimo may spend on its own. Anything above waits for your approval in the chat."
      actions={
        <div className="flex gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => setDraft(pick(mandate))}>
              Discard
            </Button>
          )}
          <Button
            disabled={!dirty || saving}
            onClick={save}>
            Save limits
          </Button>
        </div>
      }>
      <Section
        title="Spending"
        icon={<Wallet className="mt-0.5 size-5 text-emerald-600" />}>
        <div className="space-y-6">
          <Money
            label="Per order"
            hint="Aimo orders on its own up to this amount."
            value={draft.autoApproveLimit}
            max={5000}
            step={50}
            onChange={(v) => set('autoApproveLimit', v)}
          />
          <Money
            label="Per week"
            hint="All orders together, Monday to Sunday."
            value={draft.weeklyBudget}
            max={20000}
            step={100}
            onChange={(v) => set('weeklyBudget', v)}
          />
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Spent this week</span>
              <span className="tabular-nums">
                {eur(mandate.spentThisWeek)} of {eur(draft.weeklyBudget)}
              </span>
            </div>
            <Progress
              value={Math.min(100, (mandate.spentThisWeek / Math.max(1, draft.weeklyBudget)) * 100)}
              className="h-2"
            />
          </div>
        </div>
      </Section>

      <Section
        title="What Aimo may buy on its own"
        description="Other categories wait for your approval."
        icon={<Check className="mt-0.5 size-5 text-sky-600" />}>
        <div className="flex flex-wrap gap-2">
          {info.categories.map((c) => {
            const on = draft.allowedCategories.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => set('allowedCategories', on ? draft.allowedCategories.filter((x) => x !== c) : [...draft.allowedCategories, c])}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                  on ? 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'text-muted-foreground hover:bg-accent',
                )}>
                {on && <Check className="size-3.5" />}
                {c}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Also ask me when"
        icon={<ShieldQuestion className="mt-0.5 size-5 text-amber-600" />}>
        <div className="divide-y">
          {(
            [
              ['requireOnTimeDelivery', 'Part of an order would arrive later than needed'],
              ['requireRequirementsMatch', 'A product doesn’t match what was asked for'],
              ['requireSubstituteApproval', 'A supplier can’t deliver and the replacement is a different product'],
            ] as const
          ).map(([k, label]) => (
            <Row
              key={k}
              label={<span className="font-normal">{label}</span>}>
              <Switch
                checked={draft[k]}
                onCheckedChange={(v) => set(k, v)}
                aria-label={label}
              />
            </Row>
          ))}
        </div>
      </Section>

      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Lock className="size-3.5" />
        Aimo and any other connected assistant can read these limits, but only you can change them.
      </p>
    </SettingsPage>
  );
}

function Money({
  label,
  hint,
  value,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-3">
      <Row
        label={label}
        hint={hint}>
        <InputGroup className="w-40">
          <InputGroupAddon>
            <InputGroupText>€</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            type="number"
            min={0}
            step={step}
            value={value}
            aria-label={label}
            className="tabular-nums"
            onChange={(e) => onChange(Math.max(0, e.target.valueAsNumber || 0))}
          />
        </InputGroup>
      </Row>
      <Slider
        min={0}
        max={Math.max(max, value)}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        aria-label={`${label} slider`}
      />
    </div>
  );
}
