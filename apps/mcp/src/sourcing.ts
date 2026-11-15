import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { record } from './audit';
import { topCategory } from './catalog';
import { PROMISE_FILE } from './config';
import { mandate } from './mandate';
import type { Product, PromiseAttestation } from './types';
import { canonicalJson, sha256, shortId } from './util';

// The buyer's sourcing promise: what the kitchen promises its guests (e.g. "our dairy is Finnish", "EU origin
// only"). Unlike the mandate, this is not something an approver can wave through: the gateway never offers,
// quotes or orders a product that breaks it. It is stored on the backend, signed into every quote, and can be
// published as a public page for guests (/promise).

export const PROMISE_KINDS = {
  'finnish-origin': { label: 'Finnish origin only', short: 'Finnish' },
  'eu-origin': { label: 'EU origin only', short: 'from the EU' },
  organic: { label: 'Organic only (EU Organic)', short: 'organic' },
  'free-range': { label: 'Free-range only', short: 'free-range' },
  fairtrade: { label: 'Fairtrade only', short: 'Fairtrade' },
  'no-allergen': { label: 'Never contains an allergen', short: 'free of' },
  vegan: { label: 'Vegan only', short: 'vegan' },
  'lactose-free': { label: 'Lactose-free only', short: 'lactose-free' },
  'gluten-free': { label: 'Gluten-free only', short: 'gluten-free' },
} as const;
export type PromiseKind = keyof typeof PROMISE_KINDS;

export interface PromiseRule {
  id: string;
  kind: PromiseKind;
  /** Top-level categories it applies to; empty = everything */
  categories: string[];
  /** For no-allergen */
  allergen?: string;
}

export interface SourcingPromise {
  rules: PromiseRule[];
  /** What guests read on the public page */
  statement: string;
  published: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

const EU = new Set(
  'Austria Belgium Bulgaria Croatia Cyprus Czechia Denmark Estonia Finland France Germany Greece Hungary Ireland Italy Latvia Lithuania Luxembourg Malta Netherlands Poland Portugal Romania Slovakia Slovenia Spain Sweden'.split(
    ' ',
  ),
);

const defaults = (): SourcingPromise => ({
  rules: [
    { id: 'P-DAIRY', kind: 'finnish-origin', categories: ['Dairy'] },
    { id: 'P-EGGS', kind: 'free-range', categories: ['Eggs'] },
    { id: 'P-COFFEE', kind: 'fairtrade', categories: ['Coffee & Tea'] },
  ],
  statement:
    'At Hotel Aurora our dairy is Finnish, our eggs are free-range and our coffee is Fairtrade. Our purchasing agent cannot buy anything else.',
  published: true,
  version: 1,
  updatedAt: new Date().toISOString(),
  updatedBy: 'default',
});

function load(): SourcingPromise {
  if (!existsSync(PROMISE_FILE)) return defaults();
  try {
    return { ...defaults(), ...(JSON.parse(readFileSync(PROMISE_FILE, 'utf8')) as SourcingPromise) };
  } catch (err) {
    console.error(`Could not read ${PROMISE_FILE}:`, err);
    return defaults();
  }
}

export const sourcing: SourcingPromise = load();

function save() {
  mkdirSync(dirname(PROMISE_FILE), { recursive: true });
  writeFileSync(PROMISE_FILE, JSON.stringify(sourcing, null, 2));
}

// --- wording ----------------------------------------------------------------------

const scope = (r: PromiseRule) => (r.categories.length ? r.categories.join(' & ') : 'Everything');

/** "Dairy: Finnish origin only" */
export function ruleLabel(r: PromiseRule): string {
  if (r.kind === 'no-allergen') return `${scope(r)}: never contains ${r.allergen ?? 'the allergen'}`;
  return `${scope(r)}: ${PROMISE_KINDS[r.kind].label.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}`;
}

export const promiseLabels = (rules = sourcing.rules) => rules.map(ruleLabel);

/** True when the kitchen only serves vegan dairy/egg products (e.g. "Everything: vegan only"). */
export const veganKitchen = () =>
  sourcing.rules.some((r) => r.kind === 'vegan' && (!r.categories.length || r.categories.includes('Dairy')));

export function describePromise(): string {
  if (!sourcing.rules.length) return 'Sourcing promise: none set.';
  return [
    `Sourcing promise to guests (hard rule, enforced by the gateway; products breaking it are never offered or quoted, and no approver can override it): ${promiseLabels().join('; ')}.`,
  ].join('\n');
}

// --- checks -----------------------------------------------------------------------

const applies = (r: PromiseRule, p: Product) => !r.categories.length || r.categories.includes(topCategory(p.category));
const hasCert = (p: Product, c: string) => p.certificates.some((x) => x.toLowerCase() === c.toLowerCase());

function breaks(r: PromiseRule, p: Product): string | undefined {
  switch (r.kind) {
    case 'finnish-origin':
      return p.origin === 'Finland' ? undefined : `from ${p.origin}`;
    case 'eu-origin':
      return EU.has(p.origin) ? undefined : `from ${p.origin}, outside the EU`;
    case 'organic':
      return hasCert(p, 'EU Organic') ? undefined : 'not organic';
    case 'free-range':
      return hasCert(p, 'Free range') ? undefined : 'not free-range';
    case 'fairtrade':
      return hasCert(p, 'Fairtrade') ? undefined : 'not Fairtrade';
    case 'no-allergen':
      return r.allergen && p.allergens.includes(r.allergen.toLowerCase()) ? `contains ${r.allergen}` : undefined;
    case 'vegan':
    case 'lactose-free':
    case 'gluten-free':
      return p.dietary.includes(r.kind) ? undefined : `not ${r.kind}`;
  }
}

/** How a product breaks the promise, e.g. ["Dairy: Finnish origin only (this is from Greece)"]. Empty = keeps it. */
export function promiseGaps(p: Product, rules = sourcing.rules): string[] {
  return rules.flatMap((r) => {
    if (!applies(r, p)) return [];
    const why = breaks(r, p);
    return why ? [`${ruleLabel(r)} (this is ${why})`] : [];
  });
}

export function fingerprint(rules = sourcing.rules): string {
  return sha256(canonicalJson(rules.map(({ kind, categories, allergen }) => ({ kind, categories, allergen }))));
}

export function attestation(): PromiseAttestation {
  return { version: sourcing.version, fingerprint: fingerprint(), rules: promiseLabels(), kept: true };
}

// --- administration (humans, via the console) -----------------------------------------

export function sanitizeRules(input: unknown, categories: string[]): PromiseRule[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw): PromiseRule[] => {
    const r = raw as Partial<PromiseRule>;
    if (!r.kind || !(r.kind in PROMISE_KINDS)) return [];
    const allergen = typeof r.allergen === 'string' ? r.allergen.trim().toLowerCase() : undefined;
    if (r.kind === 'no-allergen' && !allergen) return [];
    return [
      {
        id: typeof r.id === 'string' && r.id ? r.id : shortId('P'),
        kind: r.kind,
        categories: Array.isArray(r.categories) ? r.categories.filter((c) => categories.includes(c)) : [],
        allergen: r.kind === 'no-allergen' ? allergen : undefined,
      },
    ];
  });
}

export function updatePromise(patch: { rules?: PromiseRule[]; statement?: string; published?: boolean }): string[] {
  const changes: string[] = [];
  if (patch.rules && fingerprint(patch.rules) !== fingerprint()) {
    const before = new Set(promiseLabels());
    const after = new Set(promiseLabels(patch.rules));
    const added = [...after].filter((l) => !before.has(l));
    const removed = [...before].filter((l) => !after.has(l));
    if (added.length) changes.push(`Added: ${added.join('; ')}`);
    if (removed.length) changes.push(`Removed: ${removed.join('; ')}`);
    sourcing.rules = patch.rules;
    sourcing.version += 1;
  } else if (patch.rules) {
    sourcing.rules = patch.rules.map((r, i) => ({ ...r, id: sourcing.rules[i]?.id ?? r.id }));
  }
  if (patch.statement !== undefined && patch.statement.trim() !== sourcing.statement) {
    sourcing.statement = patch.statement.trim();
    changes.push('Updated the text for guests');
  }
  if (patch.published !== undefined && patch.published !== sourcing.published) {
    sourcing.published = patch.published;
    changes.push(patch.published ? 'Published the promise page' : 'Unpublished the promise page');
  }
  if (changes.length) {
    sourcing.updatedAt = new Date().toISOString();
    sourcing.updatedBy = mandate.approver;
    save();
    record(`human: ${mandate.approver}`, 'promise_changed', 'Changed the sourcing promise', {}, changes.join('; '));
  }
  return changes;
}
