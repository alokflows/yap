import WebSocket from 'ws';
const WSU='ws://localhost:8099', CODE='HOSTTEST';
const mk=(role,did)=>new WebSocket(`${WSU}/ws?role=${role}&room=${CODE}&did=${did}`);
let lastLinuxPresence=null;
const phone=mk('phone','PHONE');
await new Promise(r=>phone.on('open',r));
const linux=mk('desktop','LINUX');
linux.on('message',d=>{const m=JSON.parse(d);if(m.type==='presence'||m.type==='joined')lastLinuxPresence=m;});
await new Promise(r=>linux.on('open',r));
await new Promise(r=>setTimeout(r,150));
console.log('1) creator=PHONE is host?', lastLinuxPresence.hostDid==='PHONE');
// iPhone leaves
phone.close();
await new Promise(r=>setTimeout(r,250));
console.log('2) after PHONE disconnects, host STILL PHONE (not LINUX)?', lastLinuxPresence.hostDid==='PHONE', '(got:', lastLinuxPresence.hostDid+')');
// iPhone returns
const phone2=mk('phone','PHONE');
await new Promise(r=>phone2.on('open',r));
await new Promise(r=>setTimeout(r,150));
console.log('3) after PHONE returns, host still PHONE?', lastLinuxPresence.hostDid==='PHONE');
process.exit(0);
