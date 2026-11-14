/** R4（R3A-03）：复合句未办部分必须明说；不同动作不串用客户。泛化规则，不取盲测原句当规则。 */
import { expect, it } from 'vitest';
import { worldM05 } from '../role-eval/appointment-fixture-m05.js';

it('报单后半句是不支持的店务（海报/文案）→ 出报单清单且明说后半句没办', async () => {
  const w = await worldM05();
  const reply = await w.call('m-zhao', '周女士440（小王），再帮做一张开业宣传海报');
  expect(reply).toMatch(/还没入账/);
  expect(reply).toContain('440');
  expect(reply).toMatch(/没有办|没办/);
  expect(reply).toMatch(/海报|后半句/);
  expect((await w.base.listEntries()).filter(e => e.amount === 440 && e.customerName === '周女士')).toHaveLength(0);
  expect((await w.base.listDrafts()).filter(d => d.status === 'pending' && d.kind === 'report')).toHaveLength(1);
});

it('报单＋预约：不得把报单客户串到预约上，未办半句要明说（或两件都列清）', async () => {
  const w = await worldM05();
  const reply = await w.call('m-zhao', '冯姐350今天我的单，另外登记明天15点吴姐护理预约');
  expect(reply).not.toMatch(/顾客 冯姐/);
  const undone = /没有办|没办/.test(reply);
  const both = /冯姐/.test(reply) && /350/.test(reply) && /吴姐/.test(reply);
  expect(undone || both).toBe(true);
  if (/还没登记/.test(reply)) expect(reply).toMatch(/吴姐/);
});

it('查询在前、报单在后：未办的半句要明说，不得只回一句「没太明白」且两半都丢而不说明', async () => {
  const w = await worldM05();
  const reply = await w.call('m-zhao', '先查我自己的进度，再帮我报孙姐420');
  expect(reply).toMatch(/没有办|没办|分开发|已查|还没入账/);
});
