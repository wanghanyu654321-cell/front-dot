import { beforeAll, afterAll, expect, it } from 'vitest';
import { Client } from 'pg';
import { startPgCluster, PG_START_HOOK_TIMEOUT_MS, PG_STOP_HOOK_TIMEOUT_MS } from '../helpers/pg-cluster.js';
import { applyLatest } from '../migration/pg-harness-m08.js';
import { openPerformanceStore } from '../../src/role-eval/performance-open.js';
import { seedSynthetic } from '../../src/standalone/synthetic.js';
import { createOfflineChannel } from '../../src/standalone/offline.js';
import { startFrontClawOpenDotService } from '../../src/opendot/index.js';

let cluster: Awaited<ReturnType<typeof startPgCluster>>;
let sequence = 0;
beforeAll(async () => { cluster = await startPgCluster(); }, PG_START_HOOK_TIMEOUT_MS);
afterAll(async () => { await cluster?.stop(); }, PG_STOP_HOOK_TIMEOUT_MS);

async function world() {
  const admin = new Client({ connectionString: cluster.url });
  await admin.connect();
  const name = `synthetic_upgrade_${++sequence}`;
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = `${cluster.base}/${name}`;
  await applyLatest(url);
  const db = await openPerformanceStore({ FRONT_CLAW_DATABASE_URL: url }, { requirePostgres: true });
  await seedSynthetic(db);
  const channel = createOfflineChannel();
  const service = await startFrontClawOpenDotService({ env: { FRONT_CLAW_OPENDOT_ADAPTER: '1' }, logger: { info() {}, warn() {} } }, {
    open: async () => db, channel: () => channel, now: () => new Date('2026-11-12T02:00:00Z'), timers: false, owner: 'synthetic-consumer',
  });
  const say = async (text: string, messageId: string) => {
    channel.inject({ botId: 'synthetic-bot', corpId: 'synthetic-corp', memberId: 'synthetic-member', reqId: messageId, messageId, text });
    await service.idle();
  };
  return { db, service, say, url };
}

it('uses the same authorized binding in the assembled PG adapter and commits once', async () => {
  const w = await world();
  try {
    await w.say('12号测试店\n560（小赵）', 'synthetic-draft');
    await w.say('对', 'synthetic-confirm');
    await w.say('对', 'synthetic-confirm');
    expect(await w.db.store.listEntries()).toHaveLength(1);
  } finally { await w.service.close(); }
});

it('recovers a rolled back busy binding confirmation after release without duplicate business writes', async () => {
  const w = await world();
  const blocker = new Client({ connectionString: w.url });
  blocker.on('error', () => {});
  await blocker.connect();
  let released = false;
  try {
    await w.say('12号测试店\n560（小赵）', 'synthetic-draft');
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM front_claw_perf.wecom_bot_bindings FOR UPDATE');
    await w.say('对', 'synthetic-confirm');
    expect(await w.db.store.listEntries()).toHaveLength(0);
    await blocker.query('ROLLBACK'); released = true;
    // Recovery must remain possible with the original confirmation or a new explicit confirmation.
    await w.say('对', 'synthetic-confirm');
    await w.say('对', 'synthetic-confirm-after-release');
    expect(await w.db.store.listDrafts({ status: 'confirming' })).toHaveLength(0);
    expect(await w.db.store.listEntries()).toHaveLength(1);
  } finally {
    if (!released) await blocker.query('ROLLBACK').catch(() => {});
    await blocker.end();
    await w.service.close();
  }
}, 30000);

it.each(['report', 'appointment', 'correction'] as const)('restores only the rolled-back current claim and requires explicit confirmation: %s', async kind => {
  const admin = new Client({connectionString:cluster.url});await admin.connect();
  const name=`synthetic_recovery_${++sequence}`;
  try {await admin.query(`CREATE DATABASE ${name}`);} finally {await admin.end();}
  const url=`${cluster.base}/${name}`;await applyLatest(url);
  const db=await openPerformanceStore({FRONT_CLAW_DATABASE_URL:url},{requirePostgres:true});
  const {worldM05}=await import('../role-eval/appointment-fixture-m05.js');
  const {ACCESS_DENIED}=await import('../../src/role-eval/employee-loop.js');
  const blocker=new Client({connectionString:url});await blocker.connect();
  const counts=async()=>{
    const r=await blocker.query(`SELECT (SELECT count(*)::int FROM front_claw_perf.performance_entries) AS entries,
      (SELECT count(*)::int FROM front_claw_perf.performance_appointments) AS appointments,
      (SELECT count(*)::int FROM front_claw_perf.performance_revisions) AS revisions,
      (SELECT count(*)::int FROM front_claw_perf.performance_notifications) AS notices`);
    return r.rows[0] as {entries:number;appointments:number;revisions:number;notices:number};
  };
  try {
    const w=await worldM05({store:db.store});
    if(kind==='correction') {await w.call('m-zhao','12号测试B店\n880（小赵）');expect(await w.call('m-zhao','对')).toContain('已入账');}
    const text=kind==='report'?'12号测试B店\n560（小赵）':kind==='appointment'?'明天下午3点王姐要来':'把刚才那笔改成800';
    await w.call('m-zhao',text);
    const draft=(await db.store.listDrafts({status:'pending'}))[0]!;expect(draft.kind).toBe(kind==='correction'?'correction':kind);
    const before=await counts();
    await blocker.query('BEGIN');await blocker.query("SELECT * FROM front_claw_perf.performance_people WHERE person_id='p-zhao' FOR UPDATE");
    expect(await w.call('m-zhao','对','busy-confirm')).toBe(ACCESS_DENIED);
    expect(await counts()).toEqual(before);
    expect((await db.store.getDraft(draft.draftId))?.status).toBe('pending');
    await blocker.query('ROLLBACK');
    const reply=await w.call('m-zhao','对','explicit-confirm-after-release');
    expect(reply).toContain(kind==='report'?'已入账':kind==='appointment'?'预约已登记':'已改账');
    await w.call('m-zhao','对','explicit-confirm-after-release');
    const after=await counts();
    expect(after.entries-before.entries).toBe(kind==='report'?1:0);
    expect(after.appointments-before.appointments).toBe(kind==='appointment'?1:0);
    expect(after.revisions-before.revisions).toBe(kind==='correction'?1:0);
    expect(after.notices-before.notices).toBe(kind==='appointment'?1:0);
    expect((await db.store.getDraft(draft.draftId))?.status).toBe('confirmed');
    expect(await db.store.listDrafts({status:'confirming'})).toHaveLength(0);
  } finally {await blocker.query('ROLLBACK');await blocker.end();await db.close();}
},30000);
