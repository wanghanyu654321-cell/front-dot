import { expect, it } from 'vitest';
import { MemoryPerformanceStore } from '../../src/role-eval/performance-store.js';
import { createMemoryBindingStore } from '../../src/role-eval/directory-store.js';
import { seedSynthetic } from '../../src/standalone/synthetic.js';
import { createOfflineChannel } from '../../src/standalone/offline.js';
import { startFrontClawOpenDotService } from '../../src/opendot/index.js';
import { createStandaloneLogger } from '../../src/standalone/diagnostics.js';

it('commits an authorized bound synthetic request through the assembled memory adapter', async () => {
  const store = new MemoryPerformanceStore(), bindings = createMemoryBindingStore();
  await seedSynthetic({ store, bindings });
  const channel = createOfflineChannel();
  const service = await startFrontClawOpenDotService({ env: { FRONT_CLAW_OPENDOT_ADAPTER: '1' }, logger: { info() {}, warn() {} } }, {
    open: async () => ({ store, bindings, driver: 'memory', async close() {} }), channel: () => channel,
    now: () => new Date('2026-11-12T02:00:00Z'), timers: false, owner: 'synthetic-consumer',
  });
  const say = async (text: string, messageId: string) => {
    channel.inject({ botId: 'synthetic-bot', corpId: 'synthetic-corp', memberId: 'synthetic-member', reqId: messageId, messageId, text });
    await service.idle();
  };
  try {
    await say('12号测试店\n560（小赵）', 'synthetic-draft');
    expect(await store.listDrafts({ status: 'pending' })).toHaveLength(1);
    await say('对', 'synthetic-confirm');
    expect(await store.listEntries()).toHaveLength(1);
  } finally { await service.close(); }
});

it('serializes BigInt sequence diagnostics without throwing or logging extra input fields', () => {
  const lines: string[] = [];
  const logger = createStandaloneLogger(line => lines.push(line));
  expect(() => logger.info({ event: 'inbound_message', route: '模型', gateReason: 'accepted', errorCategory: 'none',
    pendingSequence: 9007199254740993n, modelMs: 1, text: 'synthetic-private-marker' })).not.toThrow();
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!).pendingSequence).toBe('9007199254740993');
  expect(lines.join('')).not.toContain('synthetic-private-marker');
});

it('keeps absent diagnostic fields JSON safe and suppresses untrusted diagnostic values', () => {
  const lines: string[] = [];
  const logger = createStandaloneLogger(line => lines.push(line));
  logger.info({ event: 'inbound_message' });
  logger.info({ event: 'inbound_message', operationId: 'synthetic-private-marker', route: 'synthetic-private-marker',
    gateReason: 'synthetic-private-marker', errorCategory: 'synthetic-private-marker',
    pendingSequence: 'synthetic-private-marker', modelMs: 'synthetic-private-marker' });
  expect(lines.map(line => JSON.parse(line))).toHaveLength(2);
  expect(lines.join('')).not.toContain('synthetic-private-marker');
});

it.each(['botId', 'corpId', 'memberId', 'accountId', 'version', 'active'] as const)('rejects a current independent binding change at the memory commit gate: %s', async key => {
  const store = new MemoryPerformanceStore(), bindings = createMemoryBindingStore();
  await seedSynthetic({store, bindings});
  const channel = createOfflineChannel();
  const commit = store.commitConfirmingDraft.bind(store);
  store.commitConfirmingDraft = async (draft, entries, guard) => {
    const binding = (await bindings.listBindings())[0]!;
    // Happens after adapter resolution and confirmation claim, in the same request.
    bindings.listBindings = async () => [{...binding, [key]: key === 'version' ? 2 : key === 'active' ? false : 'synthetic-changed'}];
    return commit(draft, entries, guard);
  };
  const service = await startFrontClawOpenDotService({env:{FRONT_CLAW_OPENDOT_ADAPTER:'1'},logger:{info(){},warn(){}}},{
    open:async()=>({store,bindings,driver:'memory',async close(){}}),channel:()=>channel,
    now:()=>new Date('2026-11-12T02:00:00Z'),timers:false});
  const say=async(text:string,messageId:string)=>{channel.inject({botId:'synthetic-bot',corpId:'synthetic-corp',memberId:'synthetic-member',text,messageId,reqId:messageId});await service.idle();};
  try {await say('12号测试店\n560（小赵）','draft');await say('对','confirm');
    expect(await store.listEntries()).toHaveLength(0);
    expect(await store.listDrafts({status:'confirming'})).toHaveLength(0);
  } finally {await service.close();}
});

it.each([undefined, NaN, Infinity, -Infinity, {toString(){throw Error('synthetic-private-marker');}}, '1e10', '-1'])('keeps malformed numeric diagnostics safe', value => {
  const lines:string[]=[];const logger=createStandaloneLogger(line=>lines.push(line));
  expect(()=>logger.info({event:'inbound_message',pendingSequence:value,modelMs:value})).not.toThrow();
  expect(JSON.parse(lines[0]!)).toMatchObject({pendingSequence:null,modelMs:0});
});
