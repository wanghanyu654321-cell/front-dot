import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryPerformanceStore, type CommitGuard, type Draft } from '../../src/role-eval/performance-store.js';
import { createMemoryBindingStore } from '../../src/role-eval/directory-store.js';
import * as access from '../../src/role-eval/access-policy.js';
import { createStandaloneLogger } from '../../src/standalone/diagnostics.js';
import { createPostgresPerformanceStore, migratePerformance } from '../../src/role-eval/performance-postgres.js';
import { MemorySql } from '../role-eval/sql-fixture.js';

// Synthetic counterexamples only; no online identity or network activity.
it('rejects nested external hosts and Unix paths before the socket implementation runs', () => {
  const guard = pathToFileURL(resolve('tests/opendot/runtime/network-guard.mjs')).href;
  const script = `
    import net from 'node:net';
    import tls from 'node:tls';
    let calls = 0;
    net.Socket.prototype.connect = function () { calls++; return this; };
    await import(${JSON.stringify(guard)});
    const blocked = [
      [{host:'192.0.2.1',port:9}], [[{host:'192.0.2.1',port:9},()=>{}]],
      [[[{host:'192.0.2.1',port:9},()=>{}]]],
      [9,'192.0.2.1'], [{path:'/tmp/synthetic-socket'}],
      [[{path:'/tmp/synthetic-socket'},()=>{}]], ['/tmp/synthetic-socket'],
    ];
    let rejected = 0;
    for (const args of blocked) {
      try { new net.Socket().connect(...args); }
      catch (e) { if (e.message === 'synthetic_network_only') rejected++; else throw e; }
    }
    const forwardedBeforeLoopback = calls;
    for (const args of [[{host:'127.0.0.1',port:9}], [[{host:'::1',port:9},()=>{}]], [9,'localhost']]) {
      new net.Socket().connect(...args);
    }
    let otherRejected = 0;
    try { tls.connect({host:'192.0.2.1',port:9}); } catch { otherRejected++; }
    try { await fetch('https://example.invalid'); } catch { otherRejected++; }
    process.stdout.write(JSON.stringify({rejected,forwardedBeforeLoopback,forwardedLoopback:calls,otherRejected}));
  `;
  const counts = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: {}, encoding: 'utf8' }));
  expect(counts).toEqual({ rejected: 7, forwardedBeforeLoopback: 0, forwardedLoopback: 3, otherRejected: 2 });
});

it('initializes the append fixture with legal minimal synthetic capabilities', async () => {
  const fixture = await import(pathToFileURL(resolve('tests/opendot/runtime/synthetic.mjs')).href);
  const store = new MemoryPerformanceStore(), bindings = createMemoryBindingStore();
  await fixture.seedSynthetic({ store, bindings }, access);
  const raw = await store.getConfig(access.ACCESS_POLICY_KEY);
  const policy = access.parseAccessPolicy(raw);
  expect(policy).toMatchObject({ enterprise: ['report_self', 'report_proxy', 'progress_self'] });
  const employee = fixture.people[0], manager = fixture.people[1];
  expect(access.decideAccess(raw, employee, 'report_proxy', fixture.STORE).allowed).toBe(false);
  expect(access.decideAccess(raw, manager, 'report_proxy', fixture.STORE).allowed).toBe(true);
  expect(access.decideAccess(raw, manager, 'correct_store', fixture.STORE).allowed).toBe(false);
});

it('retains fixed identity reasons and drops unknown values, getters and private fields', () => {
  const lines: string[] = [], logger = createStandaloneLogger(line => lines.push(line));
  logger.info({ event: 'inbound_message', identityReason: 'missing_domain', memberId: 'synthetic-private-marker' });
  logger.info({ event: 'inbound_message', identityReason: 'synthetic-private-marker' });
  logger.info(Object.defineProperty({ event: 'inbound_message' }, 'identityReason', { get() { throw Error('synthetic-private-marker'); } }));
  expect(JSON.parse(lines[0]!).identityReason).toBe('missing_domain');
  expect(JSON.parse(lines[1]!).identityReason).toBeUndefined();
  expect(JSON.parse(lines[2]!).identityReason).toBeUndefined();
  expect(lines.join('')).not.toContain('synthetic-private-marker');
});

const draft = (): Draft => ({
  draftId: 'synthetic-claim', reporterPersonId: 'synthetic-person', storeId: 'synthetic-store',
  businessDay: '2026-11-16', expiresAt: '2026-11-16T12:00:00Z', kind: 'report',
  payload: { type: 'report', added: [], missing: [], skipped: 0 }, status: 'confirming',
  reminder: 'none', voidNotice: 'none', createdAt: '2026-11-16T01:00:00Z', closedAt: null,
});
it.each(['55P03', '42725'])('only explicitly opted-in contention can restore pending: %s', async code => {
  class BrokenSql extends MemorySql {
    override async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<{rows: T[]}> {
      if (/FOR SHARE NOWAIT/.test(sql)) throw Object.assign(Error('synthetic_sql_error'), {code});
      return super.query<T>(sql, params);
    }
  }
  const sql = new BrokenSql(); await migratePerformance(sql);
  const store = createPostgresPerformanceStore(sql), d = draft(); await store.saveDraft(d);
  const guard: CommitGuard = { key: 'synthetic-policy', check: () => true, contention: 'restore_pending' };
  const action = store.commitConfirmingDraft({ ...d, status: 'confirmed' }, [], guard);
  if (code === '55P03') {
    await expect(action).resolves.toBe(-1);
    expect((await store.getDraft(d.draftId))?.status).toBe('pending');
  } else {
    await expect(action).rejects.toMatchObject({code: '42725'});
    expect((await store.getDraft(d.draftId))?.status).toBe('confirming');
  }
  expect(await store.listEntries()).toHaveLength(0);
});
