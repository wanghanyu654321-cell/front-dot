export const BOT='synthetic-bot', CORP='synthetic-corp', STORE='synthetic-store';
export const NOW='2026-11-12T02:00:00Z', DAY='2026-11-12';
export const people=[['employee','合成员甲','employee'],['manager','合成店长','manager'],['other','合成员乙','employee']].map(([id,displayName,tier])=>({
  personId:`synthetic-${id}`,accountId:`synthetic-account-${id}`,memberId:`synthetic-member-${id}`,
  displayName,tier,storeId:STORE,storeName:'测试店',roles:[],active:true,
}));
export function sheet(amount='560',customer='',owner='合成员甲',note='') {return `12号测试店\n${customer}${amount}（${owner}）${note}`;}
export async function seedSynthetic(db,access) {
  for(const p of people) {
    await db.store.savePerson(p);
    await db.bindings.saveBinding({botId:BOT,corpId:CORP,memberId:p.memberId,accountId:p.accountId,version:1,active:true});
  }
  const caps=['report_self','report_proxy','progress_self'];
  const policy={version:1,enterprise:caps,roles:{employee:['report_self','progress_self'],manager:caps,owner:[]},stores:{[STORE]:caps},
    members:Object.fromEntries(people.map(p=>[p.personId,{role:p.tier,storeIds:[STORE],status:'active'}]))};
  const result=await access.updateAccessPolicy(db.store,{expectedVersion:null,next:policy,actor:'synthetic-admin',reason:'synthetic fixture',at:NOW});
  if(!result.ok)throw Error('synthetic_policy');
  await db.store.setConfig('employee-loop:m01',JSON.stringify({enabled:true,storeId:STORE,memberIds:people.map(p=>p.memberId)}));
}
