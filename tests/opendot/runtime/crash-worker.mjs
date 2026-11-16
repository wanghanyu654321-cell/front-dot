import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {appendFile} from 'node:fs/promises';
import {BOT,CORP,NOW,people,sheet} from './synthetic.mjs';
const [dist,url,mode,sendLog]=process.argv.slice(2);
const load=p=>import(pathToFileURL(join(dist,p)).href);
try {
  const {openPerformanceStore}=await load('role-eval/performance-open.js');
  const {startFrontClawOpenDotService,operationIdFor}=await load('opendot/adapter.js');
  const db=await openPerformanceStore({FRONT_CLAW_DATABASE_URL:url},{requirePostgres:true});
  const set=db.store.setConfig.bind(db.store);
  db.store.setConfig=async(key,value,...rest)=>{
    let record;try{record=JSON.parse(value);}catch{}
    if(mode==='crash' && key.startsWith('front-claw-op:') && record?.messageId==='append-synthetic-crash-confirm' && record?.replyState==='accepted') {
      process.send?.({event:'before_final_persist',attempted:record});
      await new Promise(()=>{});
    }
    return set(key,value,...rest);
  };
  let receive;
  const channel={open(fn){receive=fn;},ready:()=>true,current:()=>true,rejected:()=>0,async close(){},
    async notify(){throw Error('synthetic_disabled');},async reply(event){
      await appendFile(sendLog,JSON.stringify({mode,messageId:event.messageId})+'\n');
      process.send?.({event:'fake_ack'});return 'accepted';
    }};
  const service=await startFrontClawOpenDotService({env:{FRONT_CLAW_OPENDOT_ADAPTER:'1'},logger:{info(){},warn(){}}},{open:async()=>db,channel:()=>channel,now:()=>new Date(Date.parse(NOW)+(mode==='recover'?2000:0)),timers:false,leaseMs:1000,renewMs:100,owner:'synthetic-crash-owner'});
  const send=async(text,messageId)=>{receive({botId:BOT,corpId:CORP,memberId:people[0].memberId,reqId:messageId,messageId,text});await service.idle();};
  if(mode==='crash')await send(sheet(),'append-synthetic-crash-draft');

  await send('对','append-synthetic-crash-confirm');
  const report=await service.result(operationIdFor({botId:BOT,corpId:CORP,memberId:people[0].memberId,messageId:'append-synthetic-crash-confirm'}));
  process.send?.({event:'recovered_after',report});
  await service.close();process.send?.({event:'done'});process.disconnect?.();
} catch {process.send?.({event:'worker_error'});process.exitCode=1;process.disconnect?.();}
