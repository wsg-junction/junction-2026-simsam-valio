import type { Notification, Order, Warning } from '@valio/shared';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from './env';
import { publishChange } from './events';

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

export const db = new DatabaseSync(env.DATABASE_PATH);

// Documents are stored as JSON (as they were in Firestore); the extra columns exist for lookups and ordering.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS orders (
    id         TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    data       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id       TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS warnings_order_id ON warnings(order_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    data       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notifications_order_id ON notifications(order_id);
`);

const parse = <T>(row: unknown): T => JSON.parse((row as { data: string }).data) as T;
const placeholders = (n: number) => Array(n).fill('?').join(',');

function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// --- orders -----------------------------------------------------------------

export const orders = {
  get(id: string): Order | undefined {
    const row = db.prepare('SELECT data FROM orders WHERE id = ?').get(id);
    return row ? parse<Order>(row) : undefined;
  },

  listByIds(ids: string[]): Order[] {
    if (ids.length === 0) return [];
    return db
      .prepare(`SELECT data FROM orders WHERE id IN (${placeholders(ids.length)}) ORDER BY created_at DESC`)
      .all(...ids)
      .map(parse<Order>);
  },

  create(order: Order, orderWarnings: Warning[]): Order {
    transaction(() => {
      db.prepare('INSERT INTO orders (id, created_at, data) VALUES (?, ?, ?)').run(
        order.id,
        order.createdAt,
        JSON.stringify(order),
      );
      const insertWarning = db.prepare('INSERT INTO warnings (id, order_id, data) VALUES (?, ?, ?)');
      for (const w of orderWarnings) insertWarning.run(w.id!, order.id, JSON.stringify(w));
    });
    publishChange({ collection: 'orders', id: order.id });
    if (orderWarnings.length) publishChange({ collection: 'warnings' });
    return order;
  },

  save(order: Order): Order {
    db.prepare('UPDATE orders SET data = ? WHERE id = ?').run(JSON.stringify(order), order.id);
    publishChange({ collection: 'orders', id: order.id });
    return order;
  },
};

// --- warnings ---------------------------------------------------------------

export const warnings = {
  list(): Warning[] {
    return db.prepare('SELECT data FROM warnings').all().map(parse<Warning>);
  },
};

// --- notifications ----------------------------------------------------------

export const notifications = {
  get(id: string): Notification | undefined {
    const row = db.prepare('SELECT data FROM notifications WHERE id = ?').get(id);
    return row ? parse<Notification>(row) : undefined;
  },

  listByOrderIds(orderIds: string[]): Notification[] {
    if (orderIds.length === 0) return [];
    return db
      .prepare(
        `SELECT data FROM notifications WHERE order_id IN (${placeholders(orderIds.length)}) ORDER BY created_at DESC`,
      )
      .all(...orderIds)
      .map(parse<Notification>);
  },

  create(notification: Notification): Notification {
    db.prepare('INSERT INTO notifications (id, order_id, created_at, data) VALUES (?, ?, ?, ?)').run(
      notification.id,
      notification.orderId!,
      notification.createdAt,
      JSON.stringify(notification),
    );
    publishChange({ collection: 'notifications', id: notification.id });
    return notification;
  },

  save(notification: Notification): Notification {
    db.prepare('UPDATE notifications SET data = ? WHERE id = ?').run(
      JSON.stringify(notification),
      notification.id,
    );
    publishChange({ collection: 'notifications', id: notification.id });
    return notification;
  },
};
