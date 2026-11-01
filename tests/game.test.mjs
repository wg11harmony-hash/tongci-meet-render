import test from 'node:test';
import assert from 'node:assert/strict';
import { act, cleanWord, GameError, newRoom, publicRoom } from '../lib/game.mjs';
const setup = () => { const r=newRoom('ABC234','first','小紫');act(r,'second','join',{name:'小绿'});return r; };
const submit=(r,token,word)=>act(r,token,'submit',{word,gameId:r.gameId,round:r.round});
const next=(r,token)=>act(r,token,'next',{gameId:r.gameId,round:r.round});

test('unrevealed word and all credentials stay private',()=>{
  const r=setup();submit(r,'first','睡觉');
  const view=publicRoom(r,'second',3);
  assert.equal(view.myWord,null);assert.deepEqual(view.history,[]);
  assert.equal(view.players[0].submitted,true);assert.equal(r.phase,'playing');
  const serialized=JSON.stringify(view);assert.ok(!serialized.includes('睡觉'));assert.ok(!serialized.includes('tokenHash'));
  assert.ok(!serialized.includes('first'));assert.ok(!serialized.includes('second'));
  assert.equal(publicRoom(r,'first',3).myWord,'睡觉');
});
test('mismatch reveals both answers and both players must ready before advancing',()=>{
  const r=setup();submit(r,'first','睡觉');submit(r,'second','吃饭');
  assert.equal(r.phase,'reveal');assert.deepEqual(r.history[0].words,['睡觉','吃饭']);
  next(r,'first');next(r,'first');assert.equal(r.round,1);assert.equal(r.next.length,1);
  next(r,'second');assert.equal(r.round,2);assert.equal(r.phase,'playing');assert.deepEqual(r.answers,{});
});
test('matching only ignores leading and trailing whitespace; synonyms stay different',()=>{
  const r=setup();submit(r,'first','  睡觉　');submit(r,'second','睡觉');assert.equal(r.phase,'matched');
  const other=setup();submit(other,'first','睡觉');submit(other,'second','睡眠');assert.equal(other.phase,'reveal');
  assert.equal(cleanWord('A  B'),'A  B');
});
test('submitted answers are immutable and empty, malformed, or long values fail',()=>{
  const r=setup();submit(r,'first','猫');submit(r,'first','猫');
  assert.throws(()=>submit(r,'first','狗'),GameError);
  for(const word of ['', '   ', null, 42, '字'.repeat(25), 'a\nb'])assert.throws(()=>cleanWord(word),GameError);
});
test('third player, stranger reads and writes are rejected',()=>{
  const r=setup();assert.throws(()=>act(r,'third','join',{}),GameError);
  assert.throws(()=>publicRoom(r,'third',1),GameError);assert.throws(()=>submit(r,'third','猫'),GameError);
  act(r,'first','join',{});assert.equal(r.players.length,2);
});
test('stale round or game messages cannot submit to a later round',()=>{
  const r=setup();const stale={round:r.round,gameId:r.gameId,word:'旧答案'};
  submit(r,'first','猫');submit(r,'second','狗');next(r,'first');next(r,'second');
  assert.throws(()=>act(r,'first','submit',stale),GameError);
  submit(r,'first','花');submit(r,'second','花');const oldGame=r.gameId;next(r,'first');next(r,'second');
  assert.notEqual(r.gameId,oldGame);assert.equal(r.round,1);assert.deepEqual(r.history,[]);
  assert.throws(()=>act(r,'first','submit',stale),GameError);
});
