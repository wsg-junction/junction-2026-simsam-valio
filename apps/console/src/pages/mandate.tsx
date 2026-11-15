import { Check, Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Page } from '@/components/page';
import { PromiseEditor } from '@/components/promise-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, useLive, type Info, type Mandate } from '@/lib/api';
import { eurShort } from '@/lib/format';
import { cn } from '@/lib/utils';

type Draft = Pick<
  Mandate,
  | 'autoApproveLimit'
  | 'weeklyBudget'
  | 'allowedCategories'
  | 'requireOnTimeDelivery'
  | 'requireRequirementsMatch'
  | 'requireSubstituteApproval'
>;

const pick = (m: Mandate): Draft => ({
  autoApproveLimit: m.autoApproveLimit,
  weeklyBudget: m.weeklyBudget,
  allowedCategories: m.allowedCategories,
  requireOnTimeDelivery: m.requireOnTimeDelivery,
  requireRequirementsMatch: m.requireRequirementsMatch,
  requireSubstituteApproval: m.requireSubstituteApproval,
});

export function MandatePage({ info, refreshShell }: { info?: Info; refreshShell: () => void }) {
  const { data: mandate, refresh } = useLive(api.mandate, [], 10000);
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mandate && !draft) setDraft(pick(mandate));
  }, [mandate, draft]);

  const dirty = useMemo(
    () => !!mandate && !!draft && JSON.stringify(pick(mandate)) !== JSON.stringify(draft),
    [mandate, draft],
  );

  if (!mandate || !draft || !info) {
    return (
      <Page
        narrow
        title="Rules">
        <Skeleton className="h-96 rounded-xl" />
      </Page>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const approverName = mandate.approver.split(',')[0];

  const save = async () => {
    setSaving(true);
    try {
      const { mandate: next, changes } = await api.updateMandate(draft);
      setDraft(pick(next));
      refresh();
      refreshShell();
      toast.success('Rules saved', { description: changes.length ? 'Your agents follow them from their next step.' : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      narrow
      title="Rules"
      description={`What your agents may buy on their own. Anything else waits for ${approverName}.`}>
      <Card>
        <CardContent className="divide-y">
          <Row
            title="Order on its own up to"
            text="Bigger orders need your approval.">
            <Money
              id="limit"
              value={draft.autoApproveLimit}
              step={50}
              suffix="per order"
              onChange={(v) => set('autoApproveLimit', v)}
            />
          </Row>

          <Row
            title="Spend at most"
            text={`${eurShort(mandate.spentThisWeek)} spent so far this week.`}
            extra={
              <Progress
                value={Math.min(100, (mandate.spentThisWeek / Math.max(1, draft.weeklyBudget)) * 100)}
                className="mt-2 h-1.5 max-w-64"
              />
            }>
            <Money
              id="budget"
              value={draft.weeklyBudget}
              step={100}
              suffix="per week"
              onChange={(v) => set('weeklyBudget', v)}
            />
          </Row>

          <div className="space-y-3 py-5 first:pt-0">
            <div>
              <div className="font-medium">Only from these categories</div>
              <p className="text-muted-foreground text-sm">
                Other categories need your approval.{' '}
                <Link
                  to="/assortment"
                  className="text-primary hover:underline">
                  See products
                </Link>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {info.categories.map((c) => {
                const on = draft.allowedCategories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set('allowedCategories', on ? draft.allowedCategories.filter((x) => x !== c) : [...draft.allowedCategories, c])
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                      on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                    )}>
                    {on && <Check className="size-3.5" />}
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 py-5 last:pb-0">
            <div className="font-medium">Also ask me when</div>
            <Toggle
              id="late"
              label="Part of an order would arrive late"
              checked={draft.requireOnTimeDelivery}
              onChange={(v) => set('requireOnTimeDelivery', v)}
            />
            <Toggle
              id="req"
              label="A product doesn’t meet my requirements (e.g. a substitute)"
              checked={draft.requireRequirementsMatch}
              onChange={(v) => set('requireRequirementsMatch', v)}
            />
            <Toggle
              id="subst"
              label="A supplier can’t deliver and the replacement is a different product"
              checked={draft.requireSubstituteApproval}
              onChange={(v) => set('requireSubstituteApproval', v)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <Lock className="size-3.5" />
          Agents can read these rules, but only people can change them.
        </p>
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
            Save rules
          </Button>
        </div>
      </div>

      <PromiseEditor categories={info.categories} />
    </Page>
  );
}

function Row({
  title,
  text,
  extra,
  children,
}: {
  title: string;
  text: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-5 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-muted-foreground text-sm">{text}</p>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Money({
  id,
  value,
  step,
  suffix,
  onChange,
}: {
  id: string;
  value: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <InputGroup className="w-56">
      <InputGroupAddon>
        <InputGroupText>€</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        type="number"
        min={0}
        step={step}
        value={value}
        className="tabular-nums"
        onChange={(e) => onChange(Math.max(0, e.target.valueAsNumber || 0))}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{suffix}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label
        htmlFor={id}
        className="text-sm font-normal">
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}
