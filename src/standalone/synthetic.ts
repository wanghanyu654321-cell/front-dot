import { CAPABILITIES, updateAccessPolicy, type AccessPolicy } from '../role-eval/access-policy.js';
import { EMPLOYEE_LOOP_CONFIG } from '../role-eval/employee-loop.js';
import type { OpenedPerformanceStore } from '../role-eval/performance-open.js';
import type { Person } from '../role-eval/performance-store.js';

/** Called only by the disposable database initializer, never by the service. */
export async function seedSynthetic(db: Pick<OpenedPerformanceStore, 'store' | 'bindings'>) {
  const person: Person = { personId: 'synthetic-person', accountId: 'synthetic-account', memberId: 'synthetic-member', displayName: '小赵',
    storeId: 'synthetic-store', storeName: '测试店', tier: 'employee', roles: [], active: true };
  await db.store.savePerson(person);
  await db.store.setConfig(EMPLOYEE_LOOP_CONFIG, JSON.stringify({ enabled: true, storeId: person.storeId, memberIds: [person.memberId] }));
  const policy: AccessPolicy = { version: 1, enterprise: [...CAPABILITIES], stores: { [person.storeId]: [...CAPABILITIES] },
    roles: { employee: ['report_self', 'progress_self'], manager: [], owner: [] },
    members: { [person.personId]: { role: 'employee', storeIds: [person.storeId], status: 'active' } } };
  if (!(await updateAccessPolicy(db.store, { expectedVersion: null, next: policy, actor: 'synthetic-admin', reason: 'synthetic seed', at: '2026-11-12T02:00:00Z' })).ok) throw Error('seed_policy');
  await db.bindings.saveBinding({ botId: 'synthetic-bot', corpId: 'synthetic-corp', memberId: person.memberId, accountId: person.accountId, version: 1, active: true });
}
