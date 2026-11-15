export const eur = (n: number) =>
  `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const eurShort = (n: number) => `€${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

export const qty = (n: number, unit: string) =>
  `${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${unit}`;

export const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function relative(iso?: string): string {
  if (!iso) return 'Never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 10) return 'Just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dateTime(iso);
}

export type ActorKind = 'agent' | 'buyer' | 'human' | 'gateway' | 'supplier';

export function actor(raw: string): { kind: ActorKind; name: string } {
  const [kind, ...rest] = raw.split(': ');
  const name = rest.join(': ') || raw;
  if (kind === 'agent') return { kind: 'agent', name };
  if (kind === 'buyer') return { kind: 'buyer', name: name.replace(/ \(via widget\)$/, ' · in widget') };
  if (kind === 'human') return { kind: 'human', name };
  if (kind === 'supplier') return { kind: 'supplier', name };
  return { kind: 'gateway', name };
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  }
}

/** "600 L Organic lactose-free milk drink 1.5% + 1 more" */
export function orderSummary(lines: { quantity: number; baseUnit: string; productName: string }[]): string {
  if (!lines.length) return '';
  const [first, ...rest] = lines;
  return `${qty(first.quantity, first.baseUnit)} ${first.productName}${rest.length ? ` + ${rest.length} more` : ''}`;
}

/** "€1,600" for whole euros, "€1.65" otherwise. */
export const money = (n: number) => eur(n).replace(/\.00$/, '');

/** Plain-language reason a failed mandate rule needs the buyer. */
export function ruleProblem(rule: string): string {
  const map: Record<string, string> = {
    'Within autonomous spend limit': 'Over your per-order limit',
    'Within weekly budget': 'Would go over this week’s budget',
    'Allowed product categories': 'Category not on your allowed list',
    'Delivered by requested date': 'Part of it arrives later than requested',
    'Meets stated requirements': 'Doesn’t meet your stated requirements',
    'Signed quote is valid': 'Quote could not be verified',
    'Same product as originally ordered': 'Replacement is a different product',
    "Meets the approver's conditions": 'Doesn’t meet your conditions',
    'Keeps the sourcing promise': 'Breaks your sourcing promise',
  };
  return map[rule] ?? rule;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
