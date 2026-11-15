// The buyer's agent mandate: what the purchasing agent may decide on its own. Policy as data, evaluated
// deterministically by the gateway — the agent cannot talk its way past it, and it has no tool to change it.
// Humans change it in the console (/mandate).
const defaults = {
  buyer: 'Hotel Aurora Helsinki',
  agent: 'Aurora procurement agent',
  approver: 'Maria Virtanen, Head Chef',
  currency: 'EUR',
  /** Orders up to this value are confirmed without a human */
  autoApproveLimit: 1500,
  /** Total spend allowed per calendar week */
  weeklyBudget: 6000,
  /** Already spent this week (synthetic starting point) */
  spentThisWeek: 3800,
  /** Top-level categories the agent may buy from */
  allowedCategories: ['Dairy', 'Plant-based', 'Eggs'],
  /** Deliveries later than the requested date need sign-off */
  requireOnTimeDelivery: true,
  /** Products not meeting the stated requirements (e.g. a substitute) need sign-off */
  requireRequirementsMatch: true,
  /** When a supplier can't deliver, switching to a different product needs sign-off */
  requireSubstituteApproval: true,
};

export type Mandate = typeof defaults;

export const mandate: Mandate = structuredClone(defaults);

export function resetMandate() {
  Object.assign(mandate, structuredClone(defaults));
}

export function describeMandate(): string {
  return [
    `Buyer: ${mandate.buyer} (agent: ${mandate.agent})`,
    `Auto-approve orders up to €${mandate.autoApproveLimit}; above that, ${mandate.approver} signs off.`,
    `Weekly budget €${mandate.weeklyBudget}, of which €${mandate.spentThisWeek.toFixed(2)} already spent (€${(mandate.weeklyBudget - mandate.spentThisWeek).toFixed(2)} left).`,
    `Allowed categories: ${mandate.allowedCategories.join(', ')}. Other categories need sign-off.`,
    [
      mandate.requireOnTimeDelivery ? 'Deliveries after the requested date need sign-off.' : '',
      mandate.requireRequirementsMatch ? 'Products not meeting stated requirements need sign-off.' : '',
      mandate.requireSubstituteApproval ? 'Replacing an undeliverable item with a different product needs sign-off.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    'The mandate can only be changed by a human in the Valio Aimo console, not by the agent.',
  ]
    .filter(Boolean)
    .join('\n');
}
