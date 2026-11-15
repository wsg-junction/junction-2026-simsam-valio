import { Leaf, Lock, Search, Truck } from 'lucide-react';
import { useState } from 'react';
import { Page } from '@/components/page';
import { Pill } from '@/components/status';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, useLive } from '@/lib/api';
import { day, eur, qty } from '@/lib/format';

export function AssortmentPage() {
  const { data } = useLive(api.assortment, [], 15000);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const categories =
    data?.categories
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (i) => !q || `${i.name} ${i.brand} ${i.id} ${i.certificates.join(' ')} ${i.dietary.join(' ')}`.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length) ?? [];

  return (
    <Page
      title="Assortment"
      description="What your agents can see: fixed list prices, stock, earliest delivery and certificates."
      actions={
        <InputGroup className="w-64">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Filter products…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
      }>
      {!data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        categories.map((c) => (
          <Card
            key={c.name}
            className="gap-2 pb-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{c.name}</CardTitle>
              {!c.items[0].withinMandate && (
                <Pill tone="warning">
                  <Lock className="size-3" />
                  Outside mandate: needs approval
                </Pill>
              )}
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Product</TableHead>
                    <TableHead className="hidden md:table-cell">Available</TableHead>
                    <TableHead className="hidden lg:table-cell">Labels</TableHead>
                    <TableHead className="pr-6 text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-6 whitespace-normal">
                        <div className="font-medium">{i.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {i.brand} · {i.packLabel} · <span className="font-mono">{i.id}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Truck className="text-muted-foreground size-3.5" />
                          {qty(i.inStock, i.baseUnit)} from {day(i.firstDelivery)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {i.certificates.map((x) => (
                            <Pill
                              key={x}
                              tone="success">
                              <Leaf className="size-3" />
                              {x}
                            </Pill>
                          ))}
                          {i.dietary
                            .filter((d) => d !== 'gluten-free')
                            .map((d) => (
                              <Pill
                                key={d}
                                tone="muted">
                                {d}
                              </Pill>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="font-medium tabular-nums">{eur(i.packPrice)}</div>
                        <div className="text-muted-foreground text-xs tabular-nums">
                          {eur(i.unitPrice)}/{i.baseUnit}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </Page>
  );
}
