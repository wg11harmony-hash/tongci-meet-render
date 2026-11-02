import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const distDir = fileURLToPath(new URL('../dist/',import.meta.url));
let server, base;
const token = () => crypto.randomUUID()+crypto.randomUUID();
async function start(options={}) {
  const app=createApp({distDir,...options});
  await new Promise((resolve,reject)=>{app.once('error',reject);app.listen(0,'127.0.0.1',resolve)});
  return {app,url:`http://127.0.0.1:${app.address().port}`};
}
async function stop(app){await new Promise((resolve,reject)=>app.close(e=>e?reject(e):resolve()))}
before(async()=>{const running=await start();server=running.app;base=running.url});
after(async()=>{await stop(server)});
async function call(key,body,code,url=base){
  const response=await fetch(body?url+'/api/room':url+'/api/room?code='+code,{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,
  });
  return {status:response.status,data:await response.json()};
}

test('anonymous homepage, built assets, health check, and HEAD requests work without a GPT account',async()=>{
  const page=await fetch(base+'/',{redirect:'manual'});
  assert.equal(page.status,200);assert.equal(page.headers.get('location'),null);
  const html=await page.text();assert.match(html,/<title>同词相遇/);
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]);
  assert.ok(assets.some(a=>a.endsWith('.js')));assert.ok(assets.some(a=>a.endsWith('.css')));
  for(const asset of assets){const r=await fetch(base+asset);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/immutable/)}
  const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{ok:true});
  for(const path of ['/server/index.mjs','/package.json','/.env','/api/missing','/assets/missing.js'])assert.equal((await fetch(base+path)).status,404);
});

test('full HTTP flow protects hidden words, advances only after both ready, matches, and replays',async()=>{
  const a=token(),b=token();
  const created=await call(a,{action:'create',name:'测试小紫'});assert.equal(created.status,201);
  const code=created.data.code;
  const joined=await call(b,{action:'join',code,name:'测试小绿'});assert.equal(joined.status,200);
  let g=joined.data;
  const command=(action,word)=>({action,code,round:g.round,gameId:g.gameId,word});
  assert.equal((await call(token(),undefined,code)).status,403);
  assert.equal((await call(token(),{action:'join',code})).status,409);
  assert.equal((await call(a,command('submit','  '))).status,400);
  assert.equal((await call(a,{...command('submit','猫'),round:0})).status,409);
  await call(a,command('submit','猫'));
  const hidden=await call(b,undefined,code);assert.equal(hidden.data.myWord,null);assert.deepEqual(hidden.data.history,[]);
  assert.ok(!JSON.stringify(hidden.data).includes('猫'));assert.ok(!JSON.stringify(hidden.data).includes('tokenHash'));
  assert.equal((await call(a,command('submit','狗'))).status,409);
  const revealed=await call(b,command('submit','狗'));assert.equal(revealed.data.phase,'reveal');
  const ready=await call(a,command('next'));assert.equal(ready.data.phase,'reveal');assert.equal(ready.data.round,1);
  await call(b,command('next'));
  g=(await call(a,undefined,code)).data;assert.equal(g.round,2);assert.equal(g.phase,'playing');
  const results=await Promise.all([call(a,command('submit','  睡觉  ')),call(b,command('submit','睡觉'))]);
  assert.ok(results.every(r=>r.status===200));
  g=(await call(a,undefined,code)).data;assert.equal(g.phase,'matched');assert.equal(g.history.length,2);assert.deepEqual(g.history[1].words,['睡觉','睡觉']);
  const oldId=g.gameId;
  await Promise.all([call(a,command('next')),call(b,command('next'))]);
  g=(await call(a,undefined,code)).data;assert.equal(g.phase,'playing');assert.equal(g.round,1);assert.equal(g.history.length,0);assert.notEqual(g.gameId,oldId);
  assert.equal((await call(a,{...command('submit','过期消息'),gameId:oldId})).status,409);
});

test('simultaneous joins cannot overfill a room',async()=>{
  const created=await call(token(),{action:'create',name:'房主'});const code=created.data.code;
  const results=await Promise.all([call(token(),{action:'join',code,name:'客人甲'}),call(token(),{action:'join',code,name:'客人乙'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});

test('three-person rooms expose the selected capacity, wait for all seats, and validate capacity',async()=>{
  for(const capacity of [1,5,'3',null])assert.equal((await call(token(),{action:'create',capacity})).status,400);
  const a=token(),b=token(),c=token();
  let g=(await call(a,{action:'create',capacity:3})).data;
  assert.equal(g.capacity,3);assert.equal(g.phase,'waiting');
  g=(await call(b,{action:'join',code:g.code})).data;
  assert.equal(g.phase,'waiting');assert.equal(g.players.length,2);
  assert.equal((await call(a,{action:'submit',code:g.code,gameId:g.gameId,round:g.round,word:'等人'})).status,409);
  g=(await call(c,{action:'join',code:g.code})).data;
  assert.equal(g.phase,'playing');assert.equal(g.players.length,3);
  assert.equal((await call(token(),{action:'join',code:g.code})).status,409);
});

test('simultaneous four-person joins fill exactly four seats',async()=>{
  const owner=token();const created=await call(owner,{action:'create',capacity:4});const code=created.data.code;
  const results=await Promise.all(Array.from({length:5},()=>call(token(),{action:'join',code})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,200,200,409,409]);
  const g=(await call(owner,undefined,code)).data;
  assert.equal(g.players.length,4);assert.equal(g.phase,'playing');assert.equal(g.teams.length,4);
});

test('four-person HTTP flow isolates live team drafts, confirms once, reveals, and replays',async()=>{
  const users=Array.from({length:4},token);
  let g=(await call(users[0],{action:'create',capacity:4,name:'房主'})).data;
  const code=g.code;
  for(const key of users.slice(1))g=(await call(key,{action:'join',code})).data;
  const cmd=(action,word,sequence)=>({action,code,gameId:g.gameId,round:g.round,word,sequence});
  await call(users[0],cmd('draft','独立秘密',1));
  assert.ok(!JSON.stringify((await call(users[1],undefined,code)).data).includes('独立秘密'));
  await Promise.all(users.map((key,i)=>call(key,cmd('submit',i<2?'猫':'狗'))));
  g=(await call(users[0],undefined,code)).data;
  assert.equal(g.phase,'reveal');assert.deepEqual(g.teams.map(t=>t.playerIds.length),[2,2]);
  await Promise.all(users.map(key=>call(key,cmd('next'))));
  g=(await call(users[0],undefined,code)).data;assert.equal(g.round,2);
  assert.equal((await call(users[0],cmd('draft','队内秘密',2))).status,200);
  await call(users[0],cmd('draft','旧填写',1));
  const teammate=(await call(users[1],undefined,code)).data;
  assert.equal(teammate.players[0].draft,'队内秘密');
  const resumed=(await call(users[0],undefined,code)).data;
  assert.equal(resumed.myDraft,'队内秘密');assert.equal(resumed.myDraftSequence,2);
  for(const key of users.slice(2)){
    const view=(await call(key,undefined,code)).data;
    assert.equal(view.players[0].draft,null);
    assert.ok(!JSON.stringify(view).includes('队内秘密'));
    assert.ok(!JSON.stringify(view).includes('tokenHash'));
  }
  await call(users[0],cmd('submit','月'));
  assert.equal((await call(users[0],cmd('draft','确认后改写',3))).status,409);
  assert.equal((await call(users[0],cmd('submit','确认后改写'))).status,409);
  await call(users[1],cmd('submit','月'));
  assert.equal((await call(users[0],undefined,code)).data.myTeamWord,'月');
  const hidden=(await call(users[2],undefined,code)).data;
  assert.equal(hidden.phase,'playing');assert.equal(hidden.history.length,1);
  assert.ok(!JSON.stringify(hidden).includes('月'));
  await Promise.all(users.slice(2).map(key=>call(key,cmd('submit','月'))));
  g=(await call(users[0],undefined,code)).data;
  assert.equal(g.phase,'matched');assert.deepEqual(g.history[1].words,['月','月']);
  assert.equal(g.teams.length,1);assert.equal(g.teams[0].playerIds.length,4);
  const stale=cmd('draft','过期秘密',100);
  await Promise.all(users.map(key=>call(key,cmd('next'))));
  g=(await call(users[0],undefined,code)).data;
  assert.equal(g.round,1);assert.equal(g.history.length,0);assert.equal(g.teams.length,4);
  assert.equal((await call(users[0],stale)).status,409);
});

test('invalid body, oversized body, unsupported methods, and foreign origins are rejected',async()=>{
  const headers={Authorization:'Bearer '+token(),'Content-Type':'application/json'};
  const raw=body=>fetch(base+'/api/room',{method:'POST',headers,body});
  for(const body of ['{','null','[]'])assert.equal((await raw(body)).status,400);
  const large=await raw('x'.repeat(5000));assert.equal(large.status,413);assert.ok((await large.json()).error);
  assert.equal((await fetch(base+'/api/room?code=ABC234')).status,401);
  assert.equal((await fetch(base+'/api/room',{method:'DELETE',headers})).status,405);
  const foreign=await fetch(base+'/api/room',{method:'POST',headers:{...headers,Origin:'https://another.example'},body:JSON.stringify({action:'create'})});
  assert.equal(foreign.status,403);
  // Render forwards HTTPS browser requests over HTTP internally.
  const forwarded=await fetch(base+'/api/room',{method:'POST',headers:{...headers,Origin:base.replace('http:','https:')},body:JSON.stringify({action:'create'})});
  assert.equal(forwarded.status,201);
});

test('expired rooms free capacity; a fresh server returns a useful restart message',async()=>{
  let time=100000;
  const running=await start({ttlMs:50,maxRooms:1,now:()=>time});
  const key=token();
  try {
    const first=await call(key,{action:'create'},undefined,running.url);
    assert.equal((await call(token(),{action:'create'},undefined,running.url)).status,503);
    time+=51;
    assert.equal((await call(key,undefined,first.data.code,running.url)).status,410);
    assert.equal((await call(token(),{action:'create'},undefined,running.url)).status,201);
    const fresh=await start();
    try{const missing=await call(key,undefined,first.data.code,fresh.url);assert.equal(missing.status,404);assert.match(missing.data.error,/重启/)}finally{await stop(fresh.app)}
  } finally {await stop(running.app)}
});
