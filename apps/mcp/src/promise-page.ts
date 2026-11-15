import * as gateway from './gateway';
import { mandate } from './mandate';
import { fingerprint, promiseLabels, sourcing } from './sourcing';

// Public page a kitchen can link from its menu or website: what it promises guests, and the proof that every
// order since is checked against it by Valio Aimo.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function promiseSummary() {
  const since = sourcing.updatedAt;
  const orders = gateway.listOrders().filter((o) => o.status === 'confirmed' && o.createdAt >= since);
  return {
    buyer: mandate.buyer,
    statement: sourcing.statement,
    rules: promiseLabels(),
    version: sourcing.version,
    fingerprint: fingerprint(),
    updatedAt: sourcing.updatedAt,
    published: sourcing.published,
    ordersChecked: orders.length,
    ordersKeptPromise: orders.filter((o) => o.promise.fingerprint === fingerprint()).length,
  };
}

export function promisePage(): string {
  const s = promiseSummary();
  const date = new Date(s.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const body = s.published
    ? `
      <p class="eyebrow">Our sourcing promise</p>
      <h1>${esc(s.buyer)}</h1>
      <p class="statement">${esc(s.statement)}</p>
      <ul>${s.rules.map((r) => `<li><span>✓</span>${esc(r)}</li>`).join('')}</ul>
      <div class="proof">
        <b>Checked on every order.</b> Our purchasing agent buys through Valio Aimo, which refuses any product that
        breaks this promise. No one can approve an exception; the promise itself can only be changed by our staff,
        and every change is logged.
        <div class="stats">
          <div><strong>${s.ordersChecked}</strong><span>orders since ${esc(date)}</span></div>
          <div><strong>${s.ordersChecked ? `${Math.round((s.ordersKeptPromise / s.ordersChecked) * 100)}%` : '–'}</strong><span>kept the promise</span></div>
        </div>
      </div>
      <p class="fine">Version ${s.version} · fingerprint <code>${s.fingerprint.slice(0, 16)}</code>, included in every signed quote. Demo with synthetic data.</p>`
    : `<h1>Not published</h1><p class="statement">${esc(s.buyer)} hasn’t published its sourcing promise.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.buyer)} · Sourcing promise</title>
<style>
  :root { color-scheme: light dark; --bg:#f7f6f2; --card:#fff; --text:#1d1d1b; --muted:#6b6b66; --accent:#0b4ea2; --ok:#1e6b3a; --line:#e4e4df; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161615; --card:#1f1f1e; --text:#ecece8; --muted:#a3a39d; --accent:#8ab8ff; --ok:#7fd39b; --line:#3a3a36; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif; }
  main { max-width:620px; margin:0 auto; padding:56px 16px; }
  .eyebrow { color:var(--accent); font-weight:600; font-size:13px; letter-spacing:.06em; text-transform:uppercase; margin:0; }
  h1 { font-size:32px; line-height:1.2; margin:6px 0 16px; }
  .statement { font-size:19px; margin:0 0 24px; }
  ul { list-style:none; padding:0; margin:0 0 28px; display:grid; gap:10px; }
  li { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; display:flex; gap:12px; align-items:center; }
  li span { color:var(--ok); font-weight:700; }
  .proof { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; color:var(--muted); font-size:15px; }
  .proof b { color:var(--text); }
  .stats { display:flex; gap:32px; margin-top:16px; }
  .stats strong { display:block; font-size:26px; color:var(--text); }
  .stats span { font-size:13px; }
  .fine { color:var(--muted); font-size:12px; margin-top:24px; }
  code { font-size:12px; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
