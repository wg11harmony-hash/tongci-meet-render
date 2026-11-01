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
