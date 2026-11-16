import { afterAll, beforeAll, expect, it } from 'vitest';
import { startPgCluster, PG_START_HOOK_TIMEOUT_MS, PG_STOP_HOOK_TIMEOUT_MS } from '../helpers/pg-cluster.js';
import { applyLatest } from '../migration/pg-harness-m08.js';
import { openSql } from '../../src/migration/pg.js';
import { createPostgresPerformanceStore } from '../../src/role-eval/performance-postgres.js';
import type { CommitGuard, Draft, PerformanceStore } from '../../src/role-eval/performance-store.js';

// Disposable PG17 and synthetic claims only; this does not represent online behavior.
let cluster: Awaited<ReturnType<typeof startPgCluster>>;
let sql: Awaited<ReturnType<typeof openSql>>;
let store: PerformanceStore;
let sequence = 0;
beforeAll(async () => {
  cluster = await startPgCluster();
  await applyLatest(cluster.url);
  sql = await openSql(cluster.url);
  store = createPostgresPerformanceStore(sql.client, { deliveryColumns: true });
}, PG_START_HOOK_TIMEOUT_MS);
afterAll(async () => { try { await sql?.close(); } finally { await cluster?.stop(); } }, PG_STOP_HOOK_TIMEOUT_MS);

function claim(): Draft {
  const id = `synthetic-claim-${++sequence}`;
  return {
    draftId: id, reporterPersonId: id, storeId: 'synthetic-store', kind: 'report', status: 'confirming',
    businessDay: '2026-11-16', expiresAt: '2026-11-16T12:00:00Z', createdAt: '2026-11-16T01:00:00Z', closedAt: null,
    reminder: 'none', voidNotice: 'none', payload: { type: 'report', added: [], missing: [], skipped: 0,
      employeeContext: { sessionId: id, bindingVersion: 1, accountId: id, memberId: id, version: 'synthetic-version',
        messageId: id, fingerprint: 'synthetic-content', actionMessageId: id, actionFingerprint: 'synthetic-confirm', pendingSequence: String(sequence) } },
  };
}
function completed(d: Draft): Draft {
  if (d.payload.type !== 'report') throw Error('synthetic_fixture');
  return { ...d, status: 'confirmed', closedAt: '2026-11-16T02:00:00Z', payload: { ...d.payload,
    employeeContext: { ...d.payload.employeeContext!, finalReply: 'synthetic-settled' } } } as Draft;
}

it('reproduces the legacy 42725 precedence error as an expected control, then verifies grouped JSON subtraction', async () => {
  await expect(sql.client.query("SELECT '{}'::jsonb->'employeeContext' - 'finalReply'")).rejects.toMatchObject({ code: '42725' });
  const result = await sql.client.query<{ same: boolean }>(
    "SELECT (($1::jsonb->'employeeContext') - 'finalReply'::text) IS NOT DISTINCT FROM (($2::jsonb->'employeeContext') - 'finalReply'::text) AS same",
    [JSON.stringify({ employeeContext: { actionMessageId: 'synthetic-confirm' } }),
      JSON.stringify({ employeeContext: { actionMessageId: 'synthetic-confirm', finalReply: 'synthetic-settled' } })]);
  expect(result.rows).toEqual([{ same: true }]);
});

it('executes the production close SQL for the same claim while excluding only finalReply', async () => {
  const d = claim(); await store.saveDraft(d);
  expect(await store.commitConfirmingDraft(completed(d), [])).toBe(1);
  expect((await store.getDraft(d.draftId))?.status).toBe('confirmed');
});

it('cannot close a replacement claim with the stale action identity', async () => {
  const d = claim(), changed = structuredClone(d);
  if (changed.payload.type !== 'report') throw Error('synthetic_fixture');
  changed.payload.employeeContext!.actionMessageId = 'synthetic-replacement';
  await store.saveDraft(changed);
  expect(await store.commitConfirmingDraft(completed(d), [])).toBe(0);
  expect((await store.getDraft(d.draftId))?.status).toBe('confirming');
  expect(await store.listEntries()).toHaveLength(0);
});

it.each(['matching', 'replacement', 'new-pending', 'lost-fence'] as const)('executes production refusal compensation without changing another claim: %s', async kind => {
  const d = claim(), current = structuredClone(d);
  if (current.payload.type !== 'report') throw Error('synthetic_fixture');
  if (kind === 'replacement') current.payload.employeeContext!.actionMessageId = 'synthetic-replacement';
  await store.saveDraft(current);
  if (kind === 'new-pending') await store.saveDraft({ ...structuredClone(d), draftId: d.draftId + '-new', status: 'pending' });
  const guard: CommitGuard = { key: 'synthetic-policy', check: () => false, validate: async () => false };
  if (kind === 'lost-fence') {
    const key = 'synthetic-lease';
    await store.setConfig(key, JSON.stringify({ owner: 'synthetic-new-owner', epoch: 2, until: 10000 }));
    guard.fence = { key, owner: 'synthetic-old-owner', epoch: 1, nowMs: () => 1000 };
  }
  expect(await store.commitConfirmingDraft(completed(d), [], guard)).toBe(-1);
  const saved = await store.getDraft(d.draftId);
  expect(saved?.status).toBe(kind === 'matching' ? 'pending' : 'confirming');
  if (saved?.payload.type !== 'report') throw Error('synthetic_fixture');
  expect(saved.payload.employeeContext?.finalReply).toBeUndefined();
  if (kind === 'replacement') expect(saved.payload.employeeContext?.actionMessageId).toBe('synthetic-replacement');
  if (kind === 'new-pending') expect((await store.getDraft(d.draftId + '-new'))?.status).toBe('pending');
  expect(await store.listEntries()).toHaveLength(0);
});
