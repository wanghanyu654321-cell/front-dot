import net from 'node:net';
import tls from 'node:tls';
import {syncBuiltinESMExports} from 'node:module';
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
  // Node may pass its normalized [options, callback] array back into connect.
  // Inspect every wrapper before delegating; a string path is never a TCP port.
  let normalized=args;
  while(Array.isArray(normalized[0])) normalized=normalized[0];
  const first=normalized[0];
  const options=first && typeof first==='object'?first:
    {port:first,host:typeof normalized[1]==='string'?normalized[1]:'localhost'};
  const port=options.port;
  if(options.path !== undefined || !['127.0.0.1','localhost','::1'].includes(options.host??'localhost') ||
    !(typeof port==='number' && Number.isInteger(port) && port>=0 && port<=65535 ||
      typeof port==='string' && /^[0-9]{1,5}$/.test(port) && Number(port)<=65535))throw Error('synthetic_network_only');
  return connect.apply(this,args);
};
tls.connect=()=>{throw Error('synthetic_network_only');};
globalThis.fetch=async()=>{throw Error('synthetic_network_only');};
syncBuiltinESMExports();
