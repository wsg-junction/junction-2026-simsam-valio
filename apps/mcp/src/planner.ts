import { record } from './audit';
import { catalog } from './catalog';
import * as gateway from './gateway';
import { ACTORS, GATEWAY, list, money } from './gateway';
import { mandate } from './mandate';
import { promiseGaps, promiseLabels, veganKitchen } from './sourcing';
import type { BasketLine, BasketResult, Meal, Product, Requirements } from './types';
import { formatDate, qty, round2, shortId } from './util';

// Menu → shopping basket: "Breakfast for 180 guests, 20 vegan, budget €450." Per-guest norms (synthetic,
// typical Nordic hotel buffet) turn a menu into quantities; each item is then filled with the pack choice
// that costs least once likely waste is counted, within the sourcing promise.

type Diet = 'all' | 'non-vegan' | 'vegan';

interface Norm {
  role: string;
  diet: Diet;
  /** Base units per guest */
  perGuest: number;
  groups: string[];
  /** Left out first when the basket is over budget (lowest number first) */
  optional?: number;
}

const MENUS: Record<Meal, { label: string; norms: Norm[] }> = {
  breakfast: {
    label: 'Breakfast',
    norms: [
      { role: 'Milk for coffee, tea and cereal', diet: 'non-vegan', perGuest: 0.12, groups: ['lf-milk-1.5', 'lf-milk-1.5-organic'] },
      { role: 'Oat drink for coffee and cereal', diet: 'vegan', perGuest: 0.15, groups: ['oat-barista'] },
      { role: 'Yoghurt', diet: 'non-vegan', perGuest: 0.1, groups: ['lf-yoghurt-natural'] },
      { role: 'Vegan yoghurt alternative', diet: 'vegan', perGuest: 0.12, groups: ['oat-snack-natural'] },
      { role: 'Butter', diet: 'non-vegan', perGuest: 0.012, groups: ['butter-unsalted'] },
      { role: 'Plant-based spread', diet: 'vegan', perGuest: 0.015, groups: ['plant-spread-60'] },
      { role: 'Sliced cheese', diet: 'non-vegan', perGuest: 0.035, groups: ['lf-edam-sliced'], optional: 2 },
      { role: 'Eggs (boiled and scrambled)', diet: 'non-vegan', perGuest: 1.0, groups: ['eggs-m-free-range'], optional: 3 },
      { role: 'Coffee', diet: 'all', perGuest: 0.012, groups: ['coffee-beans-medium'], optional: 1 },
    ],
  },
  brunch: {
    label: 'Brunch',
    norms: [
      { role: 'Milk for coffee, tea and cereal', diet: 'non-vegan', perGuest: 0.15, groups: ['lf-milk-1.5', 'lf-milk-1.5-organic'] },
      { role: 'Oat drink', diet: 'vegan', perGuest: 0.2, groups: ['oat-barista'] },
      { role: 'Yoghurt', diet: 'non-vegan', perGuest: 0.12, groups: ['lf-yoghurt-natural'] },
      { role: 'Vegan yoghurt alternative', diet: 'vegan', perGuest: 0.15, groups: ['oat-snack-natural'] },
      { role: 'Butter', diet: 'non-vegan', perGuest: 0.015, groups: ['butter-unsalted'] },
      { role: 'Plant-based spread', diet: 'vegan', perGuest: 0.02, groups: ['plant-spread-60'] },
      { role: 'Sliced cheese', diet: 'non-vegan', perGuest: 0.05, groups: ['lf-edam-sliced'], optional: 3 },
      { role: 'Eggs', diet: 'non-vegan', perGuest: 1.5, groups: ['eggs-m-free-range'], optional: 4 },
      { role: 'Whipped cream for waffles', diet: 'non-vegan', perGuest: 0.03, groups: ['lf-whipping-cream-35'], optional: 2 },
      { role: 'Coffee', diet: 'all', perGuest: 0.015, groups: ['coffee-beans-medium'], optional: 1 },
    ],
  },
  'coffee-break': {
    label: 'Coffee break',
    norms: [
      { role: 'Coffee', diet: 'all', perGuest: 0.012, groups: ['coffee-beans-medium'] },
      { role: 'Milk for coffee and tea', diet: 'non-vegan', perGuest: 0.04, groups: ['lf-milk-1.5', 'lf-milk-1.5-organic'] },
      { role: 'Oat drink for coffee', diet: 'vegan', perGuest: 0.05, groups: ['oat-barista'] },
    ],
  },
};

/** "12 g" for small kg amounts, "0.12 L", "1 pcs" */
const perGuest = (n: number, u: string) => (u === 'kg' && n < 1 ? `${Math.round(n * 1000)} g` : u === 'L' && n < 1 ? `${Math.round(n * 100) / 10} dl` : qty(n, u));

const baskets = new Map<string, BasketResult>();
gateway.onReset(() => baskets.clear());

export function getBasket(id: string) {
  return baskets.get(id);
}

function fill(norm: Norm, need: number, neededBy: string | undefined, req: Requirements) {
  const options = catalog
    .filter((p) => norm.groups.includes(p.equivalenceGroup) && !promiseGaps(p).length && !gateway.requirementGaps(p, req).length)
    .flatMap((p: Product) => {
      const { packs, deliveries } = gateway.allocate(p, Math.ceil(round2(need / p.packSize)));
      if (packs * p.packSize < need) return [];
      const line = gateway.toLine(p, packs, deliveries);
      const waste = gateway.wasteFor(p, line.quantity, need);
      const inTime = !neededBy || gateway.lastDelivery([line]) <= neededBy;
      return [{ p, line, waste, inTime, cost: line.lineTotal + waste.wasteValue }];
    })
    .sort((a, b) => Number(b.inTime) - Number(a.inTime) || a.cost - b.cost);
  return { chosen: options[0], runnerUp: options[1] };
}

export function planBasket(
  input: {
    meal: Meal;
    guests: number;
    vegan?: number;
    budget?: number;
    neededBy?: string;
    requirements?: Requirements;
    /** Leave out these roles, e.g. "Coffee" when it is bought elsewhere */
    exclude?: string[];
  },
  actor: string = ACTORS.agent,
  /** false = estimate only: nothing is stored or logged */
  keep = true,
): BasketResult {
  const menu = MENUS[input.meal];
  if (!menu) throw new gateway.GatewayError(`Unknown meal "${input.meal}". Use breakfast, brunch or coffee-break.`);
  const guests = Math.round(input.guests);
  // A vegan-only kitchen serves everyone the plant-based options.
  const allVegan = veganKitchen();
  const vegan = allVegan ? guests : Math.min(guests, Math.max(0, Math.round(input.vegan ?? 0)));
  if (guests <= 0) throw new gateway.GatewayError('Give the number of guests');
  const counts: Record<Diet, number> = { all: guests, 'non-vegan': guests - vegan, vegan };
  const req = input.requirements ?? {};
  const exclude = (input.exclude ?? []).map((e) => e.toLowerCase());

  const leftOut: BasketResult['leftOut'] = [];
  let lines: (BasketLine & { optional?: number })[] = [];
  for (const norm of menu.norms) {
    const count = counts[norm.diet];
    if (count === 0) continue;
    if (exclude.some((e) => norm.role.toLowerCase().includes(e))) {
      leftOut.push({ role: norm.role, reason: 'Left out as asked' });
      continue;
    }
    const need = round2(Math.ceil(norm.perGuest * count * 100) / 100);
    const { chosen, runnerUp } = fill(norm, need, input.neededBy, req);
    if (!chosen) {
      leftOut.push({ role: norm.role, reason: 'Nothing in stock that keeps your promise and requirements' });
      continue;
    }
    const u = chosen.p.baseUnit;
    const why = [
      `${count} ${norm.diet === 'vegan' ? 'vegan ' : ''}guests × ${perGuest(norm.perGuest, u)} = ${qty(need, u)}`,
      `${chosen.line.packs} × ${chosen.line.packLabel}`,
      runnerUp && runnerUp.cost > chosen.cost
        ? `${money(runnerUp.cost - chosen.cost)} cheaper than ${runnerUp.line.packs} × ${runnerUp.line.packLabel}${runnerUp.waste.wasteValue > 0 ? ' once likely waste is counted' : ''}`
        : '',
      chosen.waste.surplus > 0 ? chosen.waste.note.charAt(0).toLowerCase() + chosen.waste.note.slice(1) : '',
    ]
      .filter(Boolean)
      .join('; ');
    lines.push({
      role: norm.role,
      forWhom: norm.diet === 'all' ? `${guests} guests` : norm.diet === 'vegan' ? `${vegan} vegan guests` : `${guests - vegan} guests`,
      need,
      line: chosen.line,
      waste: chosen.waste,
      why,
      outsideRules: !gateway.categoryAllowed(chosen.p.category),
      arrivesInTime: chosen.inTime,
      optional: norm.optional,
    });
  }

  // Over budget: leave out optional items, least essential first, until it fits.
  const total = () => round2(lines.reduce((s, l) => s + l.line.lineTotal, 0));
  if (input.budget !== undefined) {
    const optional = lines.filter((l) => l.optional !== undefined).sort((a, b) => a.optional! - b.optional!);
    for (const l of optional) {
      if (total() <= input.budget) break;
      lines = lines.filter((x) => x !== l);
      leftOut.push({ role: l.role, reason: `Left out to stay within ${money(input.budget)} (${money(l.line.lineTotal)})` });
    }
  }

  const sum = total();
  const withinBudget = input.budget === undefined || sum <= input.budget;
  const wasted = lines.reduce((s, l) => s + l.waste.wasteValue, 0);
  const late = lines.filter((l) => !l.arrivesInTime);
  const outside = lines.filter((l) => l.outsideRules);
  const explanation = [
    `${menu.label} for ${guests} guests${allVegan ? ', all vegan because your kitchen is vegan only' : vegan ? ` (${vegan} vegan)` : ''}: ${lines.length} items for ${money(sum)}`,
    input.budget !== undefined
      ? withinBudget
        ? `${money(input.budget - sum)} under the ${money(input.budget)} budget`
        : `${money(sum - input.budget)} over the ${money(input.budget)} budget even after leaving out optional items`
      : '',
    input.neededBy ? (late.length ? `${list(late.map((l) => l.role.toLowerCase()))} arrive after ${formatDate(input.neededBy)}` : `everything arrives by ${formatDate(input.neededBy)}`) : '',
    wasted > 0 ? `about ${money(wasted)} may expire before use` : 'pack sizes chosen so nothing is likely to go to waste',
    outside.length ? `${list(outside.map((l) => l.role.toLowerCase()))} ${outside.length === 1 ? 'needs' : 'need'} approval (category not in your rules)` : '',
  ]
    .filter(Boolean)
    .join('; ')
    .concat('.');

  const result: BasketResult = {
    kind: 'basket',
    basketId: shortId('B'),
    meal: input.meal,
    guests,
    vegan,
    budget: input.budget,
    neededBy: input.neededBy,
    lines: lines.map(({ optional: _optional, ...l }) => l),
    total: sum,
    withinBudget,
    leftOut,
    explanation,
    promise: promiseLabels(),
    buyer: mandate.buyer,
  };
  if (!keep) return result;
  baskets.set(result.basketId, result);

  record(
    actor,
    'basket_planned',
    `Planned ${menu.label.toLowerCase()} for ${guests} guests${vegan ? `, ${vegan} vegan` : ''}${input.budget !== undefined ? `, budget ${money(input.budget)}` : ''}`,
    {},
  );
  record(GATEWAY, 'basket_proposed', `Proposed basket ${result.basketId}: ${lines.length} items, ${money(sum)}`, {}, explanation);
  return result;
}

export function basketText(b: BasketResult): string {
  return [
    `Basket ${b.basketId}: ${b.explanation}`,
    ...b.lines.map(
      (l) =>
        `- ${l.role} (${l.forWhom}): productId ${l.line.productId}, quantity ${l.line.quantity} ${l.line.baseUnit} = ${l.line.packs} × ${l.line.brand} ${l.line.packLabel}, ${money(l.line.lineTotal)}. ${l.why}${l.outsideRules ? ' [needs approval: category]' : ''}${l.arrivesInTime ? '' : ' [arrives late]'}`,
    ),
    ...b.leftOut.map((l) => `- Left out: ${l.role} (${l.reason})`),
    `To order, call request_quote with these lines, basketId ${b.basketId}${b.neededBy ? ` and neededBy ${b.neededBy}` : ''}. The user can also click "Get signed quote" in the widget.`,
  ].join('\n');
}

export function basketExplanation(basketId?: string) {
  return basketId ? baskets.get(basketId)?.explanation : undefined;
}
