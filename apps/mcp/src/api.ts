import type { IncomingMessage, ServerResponse } from 'node:http';
import { allTopCategories, catalog } from './catalog';
import * as assistant from './assistant';
import * as automations from './automations';
import * as events from './events';
import * as fulfilment from './fulfilment';
import { kitchenItems } from './kitchen';
import { ALLOW_ANONYMOUS, PUBLIC_URL } from './config';
import * as gateway from './gateway';
import { mandate } from './mandate';
import { promiseSummary } from './promise-page';
import { jwks, keyId } from './signing';
import { PROMISE_KINDS, promiseGaps, sanitizeRules, sourcing, updatePromise, type PromiseRule } from './sourcing';
import { simulateDay } from './kitchen';
import { createToken, listTokens, PRESETS, renameToken, revokeToken, SCOPES, type Scope } from './tokens';

// JSON API for the Agent Console (apps/console). Mock: no login — anyone who can reach the console can manage
// the buyer's tokens and mandate. A real deployment would put this behind the buyer's SSO.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const connectorUrl = (token: string) => `${PUBLIC_URL}/mcp/${token}`;

function info() {
  return {
    publicUrl: PUBLIC_URL,
    mcpUrl: `${PUBLIC_URL}/mcp`,
    jwksUrl: `${PUBLIC_URL}/.well-known/jwks.json`,
    signingKeyId: keyId,
    signingKey: jwks.keys[0],
    anonymousAllowed: ALLOW_ANONYMOUS,
    scopes: SCOPES,
    presets: PRESETS,
    categories: allTopCategories,
    buyer: mandate.buyer,
    approver: mandate.approver,
    assistant: assistant.engineInfo(),
  };
}

/** Products a set of promise rules rules out. */
function promiseImpact(rules: PromiseRule[]) {
  return catalog.flatMap((p) => {
    const gaps = promiseGaps(p, rules);
    return gaps.length ? [{ id: p.id, name: p.name, brand: p.brand, packLabel: p.packLabel, origin: p.origin, reason: gaps.join('; ') }] : [];
  });
}

function promiseState() {
  return {
    promise: sourcing,
    kinds: PROMISE_KINDS,
    excluded: promiseImpact(sourcing.rules),
    productCount: catalog.length,
    summary: promiseSummary(),
    publicUrl: `${PUBLIC_URL}/promise`,
  };
}

function overview() {
  const orders = gateway.listOrders();
  const stock = fulfilment.replenishment();
  const { events, chainValid } = gateway.fullAuditLog();
  const tokens = listTokens();
  return {
    mandate,
    pending: orders.filter((o) => o.status === 'pending_approval'),
    orderCounts: {
      total: orders.length,
      confirmed: orders.filter((o) => o.status === 'confirmed').length,
      pending: orders.filter((o) => o.status === 'pending_approval').length,
      rejected: orders.filter((o) => o.status === 'rejected').length,
    },
    confirmedValue: orders.filter((o) => o.status === 'confirmed').reduce((s, o) => s + o.total, 0),
    tokens: {
      active: tokens.filter((t) => !t.revokedAt).length,
      lastUsedAt: tokens.map((t) => t.lastUsedAt).filter(Boolean).sort().at(-1),
    },
    recent: events.slice(-8).reverse(),
    chainValid,
    stockAlerts: stock.items.filter((i) => i.status !== 'ok').map((i) => ({ key: i.key, message: i.message, status: i.status })),
    disruptions: fulfilment.openDisruptions().orders,
    changesRequested: orders.filter((o) => o.status === 'changes_requested'),
    awaitingDelivery: orders.filter((o) => o.status === 'confirmed' && !o.delivery).length,
    shortDeliveries: orders.filter((o) => o.delivery?.followUp && !o.delivery.followUp.sentAt),
  };
}

/** Returns true if the request was handled. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';
  const parts = path.slice('/api/'.length).split('/');

  try {
    const [resource, id, sub] = parts;

    if (resource === 'info' && method === 'GET') return json(res, 200, info()), true;
    if (resource === 'overview' && method === 'GET') return json(res, 200, overview()), true;

    if (resource === 'tokens') {
      if (!id && method === 'GET') return json(res, 200, listTokens()), true;
      if (!id && method === 'POST') {
        const body = await readJson(req);
        const preset = typeof body.preset === 'string' ? PRESETS[body.preset] : undefined;
        const scopes = Array.isArray(body.scopes) ? (body.scopes as Scope[]) : preset;
        const created = createToken({ name: typeof body.name === 'string' ? body.name : undefined, scopes });
        return json(res, 201, { ...created, connectorUrl: connectorUrl(created.token) }), true;
      }
      if (id && method === 'PATCH') {
        const body = await readJson(req);
        const updated = renameToken(id, String(body.name ?? ''));
        if (!updated) throw new ApiError(404, 'Token not found or empty name');
        return json(res, 200, updated), true;
      }
      if (id && method === 'DELETE') {
        const revoked = revokeToken(id);
        if (!revoked) throw new ApiError(404, 'Token not found');
        return json(res, 200, revoked), true;
      }
    }

    if (resource === 'orders') {
      if (!id && method === 'GET') return json(res, 200, gateway.listOrders()), true;
      if (id && !sub && method === 'GET') return json(res, 200, gateway.orderDetail(id)), true;
      if (id && sub === 'decision' && method === 'POST') {
        const body = await readJson(req);
        const comment = typeof body.comment === 'string' ? body.comment.trim() : undefined;
        const changes = body.changes as { lines?: unknown; maxTotal?: unknown } | undefined;
        if (changes && typeof changes === 'object') {
          const lines = Array.isArray(changes.lines)
            ? (changes.lines as { productId?: unknown; quantity?: unknown }[]).flatMap((l) =>
                typeof l.productId === 'string' && typeof l.quantity === 'number' ? [{ productId: l.productId, quantity: l.quantity }] : [],
              )
            : undefined;
          const maxTotal = typeof changes.maxTotal === 'number' && changes.maxTotal > 0 ? changes.maxTotal : undefined;
          gateway.requestChanges(id, { lines, maxTotal, comment });
        } else {
          gateway.decide(id, body.approve === true, comment);
        }
        return json(res, 200, gateway.orderDetail(id)), true;
      }
      const action = parts[3];
      if (id && sub === 'disruption' && method === 'POST') {
        const body = await readJson(req);
        if (action === 'resolve') {
          fulfilment.resolveDisruption({ orderId: id, optionId: String(body.optionId ?? '') }, gateway.ACTORS.approver(), true);
        } else if (action === 'dismiss') {
          fulfilment.dismissDisruption(id);
        } else {
          fulfilment.simulateDisruption(id, typeof body.productId === 'string' ? body.productId : undefined);
        }
        return json(res, 200, gateway.orderDetail(id)), true;
      }
      if (id && sub === 'delivery' && method === 'POST') {
        const body = await readJson(req);
        const received = Array.isArray(body.received)
          ? (body.received as { productId?: unknown; quantity?: unknown }[]).flatMap((l) =>
              typeof l.productId === 'string' && typeof l.quantity === 'number' ? [{ productId: l.productId, quantity: l.quantity }] : [],
            )
          : undefined;
        fulfilment.recordDelivery(id, { received, sample: body.sample === true }, gateway.ACTORS.approver());
        return json(res, 200, gateway.orderDetail(id)), true;
      }
      if (id && sub === 'follow-up' && method === 'POST') {
        fulfilment.markFollowUpSent(id);
        return json(res, 200, gateway.orderDetail(id)), true;
      }
    }

    if (resource === 'mandate') {
      if (method === 'GET') return json(res, 200, mandate), true;
      if (method === 'PUT') {
        const body = await readJson(req);
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
        const changes = gateway.updateMandate({
          autoApproveLimit: num(body.autoApproveLimit),
          weeklyBudget: num(body.weeklyBudget),
          allowedCategories: Array.isArray(body.allowedCategories)
            ? (body.allowedCategories as string[]).filter((c) => allTopCategories.includes(c))
            : undefined,
          requireOnTimeDelivery: typeof body.requireOnTimeDelivery === 'boolean' ? body.requireOnTimeDelivery : undefined,
          requireRequirementsMatch:
            typeof body.requireRequirementsMatch === 'boolean' ? body.requireRequirementsMatch : undefined,
          requireSubstituteApproval:
            typeof body.requireSubstituteApproval === 'boolean' ? body.requireSubstituteApproval : undefined,
        });
        return json(res, 200, { mandate, changes }), true;
      }
    }

    if (resource === 'stock') {
      if (!id && method === 'GET') return json(res, 200, fulfilment.replenishment()), true;
      if (id === 'simulate-day' && method === 'POST') {
        simulateDay();
        automations.runAutomations();
        return json(res, 200, fulfilment.replenishment()), true;
      }
    }

    if (resource === 'assistant') {
      if (id === 'chat' && method === 'POST') {
        const body = await readJson(req);
        const conversation = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 64) : undefined;
        const history = Array.isArray(body.history)
          ? (body.history as { role?: unknown; text?: unknown }[])
              .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
              .slice(-20)
              .map((h) => ({ role: h.role as 'user' | 'assistant', text: String(h.text) }))
          : [];
        return json(res, 200, await assistant.chatTurn(String(body.message ?? ''), conversation ?? 'default', history)), true;
      }
      if (id === 'action' && method === 'POST') {
        const body = await readJson(req);
        if (!body.action || typeof body.action !== 'object') throw new ApiError(400, 'Missing action');
        return json(res, 200, assistant.action(body.action as assistant.Action)), true;
      }
      if (id === 'attention' && method === 'GET') return json(res, 200, assistant.attention()), true;
    }

    if (resource === 'automations') {
      const state = () => ({
        settings: automations.settings,
        runs: automations.automationRuns(),
        items: kitchenItems().map((i) => ({ key: i.key, name: i.name })),
        stock: fulfilment.replenishment(),
      });
      if (!id && method === 'GET') return json(res, 200, state()), true;
      if (!id && method === 'PUT') {
        const body = await readJson(req);
        automations.updateSettings(body as Parameters<typeof automations.updateSettings>[0]);
        return json(res, 200, state()), true;
      }
      if (id === 'run' && method === 'POST') {
        automations.runAutomations();
        return json(res, 200, state()), true;
      }
    }

    if (resource === 'events') {
      if (!id && method === 'GET') return json(res, 200, events.listEvents()), true;
      if (!id && method === 'POST') {
        const body = await readJson(req);
        const meals = ['breakfast', 'brunch', 'coffee-break'];
        const created = events.addEvent({
          name: String(body.name ?? '').slice(0, 80),
          date: String(body.date ?? ''),
          meal: (meals.includes(String(body.meal)) ? body.meal : 'breakfast') as events.KitchenEvent['meal'],
          guests: Number(body.guests),
          vegan: Number(body.vegan ?? 0),
          budget: typeof body.budget === 'number' && body.budget > 0 ? body.budget : undefined,
          notes: typeof body.notes === 'string' ? body.notes.slice(0, 300) : undefined,
        });
        return json(res, 201, created), true;
      }
      if (id && !sub && method === 'DELETE') {
        events.removeEvent(id);
        return json(res, 200, { ok: true }), true;
      }
      if (id && sub === 'order' && method === 'POST') {
        return json(res, 200, assistant.action({ type: 'order-event', eventId: id })), true;
      }
    }

    if (resource === 'promise') {
      if (!id && method === 'GET') return json(res, 200, promiseState()), true;
      if (id === 'preview' && method === 'POST') {
        const body = await readJson(req);
        return json(res, 200, { excluded: promiseImpact(sanitizeRules(body.rules, allTopCategories)) }), true;
      }
      if (!id && method === 'PUT') {
        const body = await readJson(req);
        const changes = updatePromise({
          rules: Array.isArray(body.rules) ? sanitizeRules(body.rules, allTopCategories) : undefined,
          statement: typeof body.statement === 'string' ? body.statement.slice(0, 600) : undefined,
          published: typeof body.published === 'boolean' ? body.published : undefined,
        });
        return json(res, 200, { ...promiseState(), changes }), true;
      }
    }

    if (resource === 'audit' && method === 'GET') return json(res, 200, gateway.fullAuditLog()), true;
    if (resource === 'assortment' && method === 'GET') return json(res, 200, gateway.browseAssortment()), true;
    if (resource === 'reset' && method === 'POST') {
      gateway.resetDemo();
      return json(res, 200, { ok: true }), true;
    }

    throw new ApiError(404, `No route ${method} ${path}`);
  } catch (err) {
    if (err instanceof ApiError) json(res, err.status, { error: err.message });
    else if (err instanceof gateway.GatewayError) json(res, 400, { error: err.message });
    else {
      console.error(err);
      json(res, 500, { error: 'Internal server error' });
    }
    return true;
  }
}
