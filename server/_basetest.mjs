import WebSocket from 'ws';
const WSU='ws://localhost:8099', S='http://localhost:8099', CODE='BASETEST';
const h=new WebSocket(`${WSU}/ws?role=desktop&room=${CODE}&did=H`);
await new Promise(r=>h.on('open',r));
for(let i=0;i<5;i++) h.send(JSON.stringify({type:'text',text:'msg'+i}));
await new Promise(r=>setTimeout(r,200));
// simulate the helper baseline: GET .../0/text, take last id
const base=await (await fetch(`${S}/poll/${CODE}/0/text?did=HELP`)).text();
const LAST=base.trim().split('\n').pop().split('\t')[0];
console.log('history lines:', base.trim().split('\n').length, '-> baseline LAST =', LAST, '(should be 5, NOT 0)');
// next poll from LAST should be empty (no flood)
const next=await (await fetch(`${S}/poll/${CODE}/${LAST}/text?did=HELP`)).text();
console.log('poll after baseline returns:', JSON.stringify(next), '(empty = no flood)');
process.exit(0);
