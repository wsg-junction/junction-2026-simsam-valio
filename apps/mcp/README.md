# Valio Aimo Agent Gateway (mock)

An MCP server that lets an external purchasing agent (Claude, ChatGPT, or any MCP client) find products,
get a signed fixed-price quote and place an order — within a buyer mandate, with human approval for anything
outside it. Results render as interactive [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps)
widgets inside the chat. The buyer manages everything in the **Agent Console** (`apps/console`), served by this
gateway at `/app`. **All data is synthetic.**

## Quick start

```bash
npm install                # from the repo root
npm run build:gateway      # builds apps/console + apps/mcp
npm run start:gateway      # http://localhost:8787 → redirects to the console at /app
```

1. Open the console, go to **Agents** and click **Connect an assistant**.
2. Copy the connector URL (`https://<host>/mcp/<token>`) from the dialog.
3. In Claude: **Settings → Connectors → Add custom connector**, paste the URL, no authentication.

Claude connects from Anthropic's cloud, so it needs a **public HTTPS URL**: run a tunnel
(`cloudflared tunnel --url http://localhost:8787`) and start the gateway with `PUBLIC_URL` set to the tunnel URL,
or deploy the container. Create tokens *after* setting `PUBLIC_URL` so the connector URL is right.

## Access tokens

- One token = one agent identity. Its name appears in the audit trail ("Claude · Maria's laptop").
- Scopes decide which tools the agent even sees: **Full purchasing** (browse, quote, order), **Quotes only**,
  **Read only**. The mandate still decides what an order needs.
- Send it as part of the URL (`/mcp/<token>`, works in Claude's connector dialog) or as
  `Authorization: Bearer <token>`. `/mcp` without a token returns 401 unless `ALLOW_ANONYMOUS=true`.
- The gateway stores only SHA-256 hashes, in `DATA_DIR/tokens.json`, so tokens survive restarts. The console
  keeps the full token in the browser's localStorage so the user can copy it again.
- Revoking takes effect on the agent's next call.

## Features

| Feature | How it works |
| --- | --- |
| **Sourcing promise** | What the kitchen promises guests (e.g. *Dairy: Finnish origin only*, *Everything: EU origin only*, organic, free-range, Fairtrade, allergen-free). Stored on the backend (`DATA_DIR/promise.json`), edited on the console's **Rules** page. A hard rule: breaking products are never offered or quoted, and no approver can override it. Every quote carries a signed attestation (version + fingerprint); guests can read the promise at `/promise`. |
| **Menu → basket** | `plan_menu_basket`: "breakfast for 180 guests, 20 vegan, budget €450" → quantities from per-guest norms, waste-aware pack choice, optional items left out to fit the budget. |
| **Explain this purchase** | Every offer, quote and order carries one sentence: "Chose these packs because they cover the 1,000 L, arrive by Mon 16 Nov and cost €174 less than…". Shown in the widget and on the order page. |
| **Waste-aware purchasing** | Each product has a shelf life; pack-size surplus is compared with the kitchen's usage. Best value ranks on price + likely waste, and a heads-up appears when a request is more than normal use can consume before it expires. |
| **Smart replenishment** | `check_stock` / console **Stock**: stock, simulated usage and incoming deliveries → "Eggs will run out tomorrow" and a suggested reorder that never covers more than the product keeps. **Simulate a day of service** consumes stock. |
| **Approve with changes** | The approver changes quantities and/or sets "approve if the total stays at or below €1,600". New quantities are re-quoted at once; with only a cap, the agent proposes `revise_order`, which is confirmed straight away if it meets the conditions. |
| **Disruption recovery** | Order page → **Demo → Supplier can't deliver an item**. The gateway credits the missing part and finds replacements (same product first, then substitutes) with price and date differences. `check_disruptions` / `resolve_disruption`; a different product needs approval if the rules say so. |
| **Delivery reconciliation** | **Record delivery…** (or **Demo → Delivery arrives a bit short**, or `reconcile_delivery` with received quantities) compares ordered, picked and received, highlights shortages and drafts a follow-up to customer service. Received goods go into kitchen stock. |

## Aimo Assistant (apps/web)

A consumer chatbot at `/assistant`. With `GEMINI_API_KEY` set (in the environment or a gitignored `apps/mcp/.env`,
see `.env.example`), **Google Gemini** answers: `src/llm.ts` gives it the gateway functions as tools (search, order,
plan baskets, stock, events, supplier problems, deliveries), so limits, requirements, approvals and the audit trail
all apply. It has no tool to approve orders or change limits or requirements. The key stays on the server. Without a
key, or if Gemini fails, a rule-based mock (`src/assistant.ts`) answers instead. `GEMINI_MODEL` picks the model
(default `gemini-3.8-flash`). The home page has a big composer
and a **Coming up** feed (stock running out, events, supplier problems, short or late deliveries, approvals) with
one-click actions. The sidebar has **Automations** (stock autopilot: ask first or order automatically; big events
with reminders, one-click or automatic ordering), **Limits** (per order, per week, categories) and **Requirements**
(vegan / lactose-free / gluten-free / organic / EU / Finnish only, allergens). Chats are stored in the browser.
`/assistant/?q=…` starts a chat with that message. Dev: `npm run dev:assistant` (port 5170, proxies to the gateway).

## Tools

### Official challenge API in /assistant

Set `VALIO_API_KEY` in the gitignored `apps/mcp/.env` and restart the gateway. Optional settings are
`VALIO_API_URL` (defaults to `https://junction26.valioaimo.fi`) and `VALIO_CUSTOMER_ID` (defaults to `123`).
The key is sent as `X-API-Key` by the server only. The portal password is not needed for API calls.

The assistant downloads `/api/products/download` once into `DATA_DIR/supplier-products.json` and searches
that static catalogue locally. It then calls `/api/price` and `/api/availability` only for a shortlist of
up to 12 products, using the requested delivery date and customer. A combined estimate refreshes up to
24 selected products and merges duplicate product codes. Quantities are in supplier sales units; litres/kg
are shown only when explicit pack metadata supports the conversion. Terminal quantities are unknown,
not 999,999 units of confirmed stock. Missing dietary/origin/allergen evidence cannot satisfy active rules.

The supplied API has **no quote issuance, stock reservation or order submission endpoint**. The assistant
therefore displays one non-binding combined estimate, with no Order button. Its purchasing tools and old
demo card actions are disabled in this mode. The existing MCP gateway, Console, Automations and kitchen
simulations remain the local demo; they are not connected to supplier ordering. There is no fallback to
invented prices when the API fails. Gemini is needed for conversational multi-ingredient estimates.

The download JSON is expected to be an array or `{ "products": [...] }` with `code`/`productId`, `name`
(or English `names`), and optional categories, unit, origin, dietary, certificates and allergens. The
OpenAPI does not specify this file's schema; unsupported download formats produce an explicit error.
The older `data/products.json` is deliberately not used as the official challenge catalogue. To refresh
the static download after a challenge announcement, remove only `DATA_DIR/supplier-products.json` and restart.

Run `npm test --workspace @valio/mcp` for the supplier contract and combined-purchase regressions. The
supplier tests use injected HTTP fixtures and do not contact the challenge backend.

| Tool                | Widget | What it does                                                                 |
| ------------------- | :----: | ---------------------------------------------------------------------------- |
| `get_mandate`       |        | Spend limits, weekly budget, allowed categories, what needs sign-off, and the sourcing promise |
| `browse_assortment` |   ✓    | Whole assortment in one call: prices, stock, earliest delivery, origin, rule and promise fit |
| `search_products`   |   ✓    | Ranked offers (best value / premium / partial) with availability, waste check and explanation |
| `plan_menu_basket`  |   ✓    | Meal + guests (+ vegan, budget, date) → proposed basket                       |
| `check_stock`       |   ✓    | Run-out dates and waste-aware reorder suggestions                             |
| `request_quote`     |   ✓    | Binding fixed-price quote, Ed25519-signed, valid 30 min, with promise attestation |
| `place_order`       |   ✓    | Verifies the quote, checks the mandate → confirmed or sent for approval      |
| `revise_order`      |   ✓    | Revision after "approve with changes"                                         |
| `check_disruptions`, `resolve_disruption` | ✓ | Supplier problems and replacement orders                           |
| `reconcile_delivery` |  ✓    | Ordered vs picked vs received, shortages, draft follow-up                     |
| `get_order_status`  |   ✓    | Live status; the widget polls it while waiting for a decision                 |
| `get_audit_trail`   |   ✓    | Hash-chained log of what the agent, buyer, gateway and approver did and why  |
| `widget_request_quote`, `widget_place_order`, `widget_resolve_disruption` | app-only | Widget buttons; hidden from the model, logged as the **buyer** acting |

## HTTP routes

| Route                         | Purpose                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `/mcp/<token>`, `/mcp`        | MCP Streamable HTTP endpoint                                  |
| `/assistant/*`                | Aimo Assistant (apps/web): chat, Automations, Limits, Requirements; `/` redirects here |
| `/app/*`                      | Agent Console: Home, Approvals, Orders, Stock, Agents (tokens), Rules (mandate + promise), Activity (audit log) |
| `/promise`, `/promise.json`   | Public sourcing promise for guests                            |
| `/api/*`                      | JSON API used by the console                                  |
| `/quotes/:id`, `/.well-known/jwks.json` | Verify a quote's signature independently            |

## Demo script

> I need 1,000 litres of lactose-free milk by Monday for Hotel Aurora. Find an option that meets our
> requirements based on price and availability, and order it if it's within our mandate.

1. **Offers widget**: best value combines 10 L bags + 1 L cartons (€1,376, all by Monday); premium is organic
   (€1,790); the cheapest single pack size is flagged *partial*.
2. **Get signed quote** → **Place order… → Confirm order** in the widget, or let Claude do it.
3. €1,376 is under the €1,500 limit → **confirmed automatically**.
4. Ask for the organic option → **needs approval**. Approve it in the console (the widget link opens the order);
   the widget in Claude flips to *Approved* within seconds.
5. Ask Claude to raise its limit → it can't. Change it on the console's **Rules** page.
6. On a pending order, click **Change…**: 600 L, or "approve if the total stays at or below €1,600". The widget
   shows *Approved with changes*; with a cap only, Claude calls `revise_order`.
7. "Breakfast for 180 guests, 20 vegan, budget €450" → basket widget → **Get signed quote**.
8. "Check our stock" → eggs run out tomorrow, butter on Thursday → quote the suggested reorder.
9. On a confirmed order, **Demo → Supplier can't deliver an item**, then ask Claude "any supplier problems?".
   Then **Demo → Delivery arrives a bit short** and ask Claude to check the delivery.
10. Rules → add *EU origin only* for everything → the coconut drink (Thailand) disappears from searches; open
    `/promise`.

Tip: in Claude choose **Always allow** for this connector's tools. **Settings → Reset demo** in the console
clears orders and the log, restores the default mandate and refills kitchen stock (tokens and the sourcing
promise are kept).

## Configuration

| Env var          | Default                  | Purpose                                                              |
| ---------------- | ------------------------ | -------------------------------------------------------------------- |
| `PORT`           | `8787`                   |                                                                      |
| `HOST`           | `127.0.0.1`              | Bind address (`0.0.0.0` in the container)                            |
| `PUBLIC_URL`     | `http://localhost:$PORT` | Base for connector, approval and verify links; allowed Host header   |
| `ALLOWED_HOSTS`  | host of `PUBLIC_URL`     | Comma-separated Host allow-list; `*` disables the check              |
| `ALLOW_ANONYMOUS`| `false`                  | Allow `/mcp` without a token                                         |
| `DATA_DIR`       | `apps/mcp/data`          | Where token hashes and the sourcing promise are stored               |
| `CONSOLE_DIR`    | `apps/console/dist`      | Built console to serve at `/app`                                     |
| `GEMINI_API_KEY` | unset                    | Lets Gemini answer in Aimo Assistant; without it the rule-based mock answers |
| `GEMINI_MODEL`   | `gemini-3.8-flash`       | Gemini model for Aimo Assistant                                      |
| `SIGNING_KEY`    | generated on start       | Ed25519 PKCS#8 PEM, to keep quote signatures stable across restarts  |

## Mock limitations

- The console has no login: anyone who can reach `/app` can create tokens and approve orders. A real deployment
  would put it behind the buyer's SSO. Synthetic data only.
- Orders, quotes, the mandate, kitchen stock and the audit log are in memory (single instance; reset on restart).
  Tokens and the sourcing promise persist.
- One buyer (Hotel Aurora Helsinki); catalog in `src/catalog.ts` (20 synthetic products); stock is not reserved
  by orders. Menu norms, kitchen usage, supplier problems and picking shortages are simulated; "Send to Valio
  Aimo" for a delivery follow-up is only logged.

### Complete mock product data

The default is now mock data, including when VALIO_API_KEY is configured. Every local product uses its dataset price and reproducible stock of 250�1000 sales units, available on the requested date. Cards label these values as mock; estimates never submit real orders. Existing purchasing limits and sourcing requirements still apply. Set VALIO_DATA_MODE=live and restart to use the supplier price/availability APIs instead. Missing live prices are never replaced silently.
