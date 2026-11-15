import { round2, today } from './util';

// The buyer's kitchen stock (synthetic): what is on the shelf and how fast it is used. Usage history is
// simulated; "Simulate a day of service" in the console consumes a day's worth. Deliveries recorded in the
// console add to it. Used for replenishment suggestions and for waste estimates (pack surplus vs usage).

export interface KitchenItem {
  key: string;
  name: string;
  /** Equivalence groups that refill this item */
  groups: string[];
  baseUnit: 'L' | 'kg' | 'pcs';
  onHand: number;
  /** Last 14 days, oldest first */
  history: number[];
}

/** Hotel breakfast: weekends are busier. Index = getUTCDay(). */
const WEEKDAY_FACTOR = [1.2, 0.92, 0.9, 0.92, 0.95, 1.05, 1.25];

const SEED: { key: string; name: string; groups: string[]; baseUnit: KitchenItem['baseUnit']; usage: number; days: number }[] = [
  { key: 'lf-milk', name: 'Lactose-free milk 1.5%', groups: ['lf-milk-1.5', 'lf-milk-1.5-organic'], baseUnit: 'L', usage: 42, days: 4.6 },
  { key: 'eggs', name: 'Free-range eggs', groups: ['eggs-m-free-range'], baseUnit: 'pcs', usage: 150, days: 2.2 },
  { key: 'butter', name: 'Butter, unsalted', groups: ['butter-unsalted'], baseUnit: 'kg', usage: 1.1, days: 5.5 },
  { key: 'oat', name: 'Oat drink barista', groups: ['oat-barista'], baseUnit: 'L', usage: 9, days: 8 },
  { key: 'yoghurt', name: 'Lactose-free natural yoghurt', groups: ['lf-yoghurt-natural'], baseUnit: 'kg', usage: 6, days: 9.5 },
  { key: 'cheese', name: 'Lactose-free Edam-style cheese', groups: ['lf-edam-sliced'], baseUnit: 'kg', usage: 2, days: 15 },
  { key: 'cream', name: 'Lactose-free whipping cream', groups: ['lf-whipping-cream-35'], baseUnit: 'L', usage: 1.5, days: 12 },
  { key: 'coffee', name: 'Coffee beans', groups: ['coffee-beans-medium'], baseUnit: 'kg', usage: 2.4, days: 16 },
];

/** Deterministic pseudo-random numbers, so the demo looks the same after every reset. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const items = new Map<string, KitchenItem>();
let simulatedDays = 0;

function weekday(daysAgo: number) {
  return (new Date(`${today()}T00:00:00Z`).getUTCDay() - daysAgo + 70) % 7;
}

export function resetKitchen() {
  items.clear();
  simulatedDays = 0;
  for (const s of SEED) {
    const rand = rng(s.key);
    const history = Array.from({ length: 14 }, (_, i) => {
      const factor = WEEKDAY_FACTOR[weekday(14 - i)];
      return round2(s.usage * factor * (0.88 + rand() * 0.24));
    });
    items.set(s.key, { key: s.key, name: s.name, groups: s.groups, baseUnit: s.baseUnit, onHand: round2(s.usage * s.days), history });
  }
}
resetKitchen();

export const kitchenItems = () => [...items.values()];

export const averageUsage = (item: KitchenItem) => {
  const avg = item.history.reduce((a, b) => a + b, 0) / item.history.length;
  return item.baseUnit === 'pcs' ? Math.round(avg) : Math.round(avg * 10) / 10;
};

/** Expected use on a given date (weekday pattern applied to the average). */
export const usageOn = (item: KitchenItem, date: string) =>
  averageUsage(item) * WEEKDAY_FACTOR[new Date(`${date}T00:00:00Z`).getUTCDay()];

export function itemForGroup(group: string): KitchenItem | undefined {
  return [...items.values()].find((i) => i.groups.includes(group));
}

/** Usage and stock for an equivalence group, if the kitchen tracks it. */
export function usageFor(group: string): { usagePerDay: number; onHand: number } | undefined {
  const item = itemForGroup(group);
  return item && { usagePerDay: averageUsage(item), onHand: item.onHand };
}

/** Demo: one day of breakfast service consumes stock (with some noise). */
export function simulateDay(): { key: string; used: number }[] {
  simulatedDays += 1;
  return [...items.values()].map((item) => {
    const rand = rng(`${item.key}-${simulatedDays}`);
    const used = round2(Math.min(item.onHand, averageUsage(item) * (0.85 + rand() * 0.3)));
    item.onHand = round2(item.onHand - used);
    item.history = [...item.history.slice(1), used];
    return { key: item.key, used };
  });
}

/** A recorded delivery adds what was actually received. */
export function receive(group: string, quantity: number) {
  const item = itemForGroup(group);
  if (item) item.onHand = round2(item.onHand + quantity);
}
