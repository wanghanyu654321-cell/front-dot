import { afterEach } from 'vitest';
import { Client as PgClient } from 'pg';
const clients = new Set<Client>();
const databases = new Set<{ close(): Promise<void> }>();
/** Test-owned connections are always rolled back and closed before the cluster stops. */
export class Client extends PgClient {
  constructor(...args: ConstructorParameters<typeof PgClient>) { super(...args); clients.add(this); }
  override async end(): Promise<void> { try { await super.end(); } finally { clients.delete(this); } }
}
export function trackDatabase<T extends { close(): Promise<void> }>(db: T): T {
  const close = db.close.bind(db);
  let closing: Promise<void> | undefined;
  db.close = () => closing ??= close().finally(() => databases.delete(db));
  databases.add(db);
  return db;
}
afterEach(async () => {
  const errors: unknown[] = [];
  for (const client of [...clients]) {
    try { await client.query('ROLLBACK'); } catch (error) { errors.push(error); }
    try { await client.end(); } catch (error) { errors.push(error); }
  }
  for (const db of [...databases]) try { await db.close(); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'synthetic_resource_cleanup_failed');
});
