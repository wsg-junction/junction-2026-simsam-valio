import { Search, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';
import { AuditTimeline } from '@/components/audit-timeline';
import { Page } from '@/components/page';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, useLive } from '@/lib/api';
import { actor } from '@/lib/format';

type Filter = 'all' | 'agents' | 'people';

export function AuditPage() {
  const { data } = useLive(api.audit);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [technical, setTechnical] = useState(false);

  const q = query.trim().toLowerCase();
  const events = (data?.events ?? [])
    .filter((e) => {
      const kind = actor(e.actor).kind;
      if (filter === 'agents' && kind !== 'agent') return false;
      if (filter === 'people' && kind !== 'human' && kind !== 'buyer') return false;
      // Valio Aimo's own entries mostly echo each step; keep only the outcomes unless technical details are on.
      if (kind === 'gateway' && !technical) return /approval_requested|order_confirmed/.test(e.action);
      return true;
    })
    .filter(
      (e) => !q || `${e.actor} ${e.summary} ${e.reason ?? ''} ${Object.values(e.refs).join(' ')}`.toLowerCase().includes(q),
    )
    .reverse();

  return (
    <Page
      narrow
      title="Activity"
      description="Everything your agents and your team did, newest first. Valio Aimo sees the same record.">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
          </TabsList>
        </Tabs>
        <InputGroup className="max-w-56 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            id="technical"
            checked={technical}
            onCheckedChange={setTechnical}
          />
          <Label
            htmlFor="technical"
            className="text-muted-foreground text-sm font-normal">
            Technical details
          </Label>
        </div>
      </div>

      {technical && data && (
        <p className={`flex items-center gap-2 text-sm ${data.chainValid ? 'text-success-foreground' : 'text-destructive'}`}>
          {data.chainValid ? <ShieldCheck className="size-4" /> : <ShieldX className="size-4" />}
          {data.chainValid
            ? 'Tamper check passed: every entry’s hash matches the one before it.'
            : 'Tamper check failed: the log was modified.'}
        </p>
      )}

      <Card>
        <CardContent>
          {!data ? (
            <Skeleton className="h-48" />
          ) : events.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>Nothing here</EmptyTitle>
                <EmptyDescription>
                  {data.events.length ? 'Try a different filter.' : 'Activity appears as your agents work.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <AuditTimeline
              events={events}
              technical={technical}
            />
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
