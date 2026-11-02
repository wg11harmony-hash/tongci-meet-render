import test from 'node:test';
import assert from 'node:assert/strict';
import { act, GameError, newRoom, publicRoom } from '../lib/game.mjs';

const keys = ['alpha', 'bravo', 'charlie', 'delta'];
const command = (room, extra = {}) => ({ gameId: room.gameId, round: room.round, ...extra });
const submit = (room, index, word, choose = () => 0) => act(room, keys[index], 'submit', command(room, { word }), 1000, choose);
const draft = (room, index, word, sequence = 1) => act(room, keys[index], 'draft', command(room, { word, sequence }));
const ready = room => keys.slice(0, room.capacity).forEach(key => act(room, key, 'next', command(room)));
function setup(capacity = 4) {
  const room = newRoom('ABC234', keys[0], '玩家一', 1000, capacity);
  keys.slice(1, capacity).forEach((key, i) => act(room, key, 'join', { name: `玩家${i + 2}` }));
  return room;
}
const teamSizes = room => room.teams.map(t => t.playerIds.length).sort();

for (const capacity of [2, 3, 4]) test(`${capacity}-seat room waits for exactly the chosen capacity and then rejects extra joins`, () => {
  const room = newRoom('ABC234', keys[0], '房主', 1000, capacity);
  assert.equal(room.capacity, capacity);
  for (let i = 1; i < capacity; i++) {
    assert.equal(room.phase, 'waiting');
    assert.throws(() => submit(room, 0, '等人'), GameError);
    assert.throws(() => draft(room, 0, '等人'), GameError);
    act(room, keys[i], 'join', { name: `玩家${i}` });
  }
  assert.equal(room.phase, 'playing');
  assert.equal(room.teams.length, capacity);
  assert.throws(() => act(room, 'extra', 'join'), GameError);
  act(room, keys[0], 'join');
  assert.equal(room.players.length, capacity);
});

test('invalid capacity cannot create a room', () => {
  for (const capacity of [0, 1, 5, 2.5, '3', null, {}, true]) {
    assert.throws(() => newRoom('ABC234', 'owner', '房主', 1000, capacity), GameError);
  }
});

test('three identical answers merge directly into a persistent three-person team', () => {
  const room = setup();
  ['猫', '猫', '猫', '狗'].forEach((word, i) => submit(room, i, word));
  assert.equal(room.phase, 'reveal');
  assert.deepEqual(teamSizes(room), [1, 3]);
  assert.deepEqual(room.history[0].words, ['猫', '猫', '猫', '狗']);
  assert.equal(room.history[0].teams.length, 4);
  assert.deepEqual(room.history[0].merged, [room.players.slice(0, 3).map(p => p.id)]);
  ready(room);
  assert.deepEqual(teamSizes(room), [1, 3]);
  assert.equal(room.round, 2);
  assert.deepEqual(room.drafts, {});
});

test('two pairs pick once per team, reveal only after all confirm, merge, and reset to singles on replay', () => {
  const room = setup();
  ['猫', '猫', '狗', '狗'].forEach((word, i) => submit(room, i, word));
  assert.deepEqual(teamSizes(room), [2, 2]);
  ready(room);
  let calls = 0;
  const choose = size => { assert.equal(size, 2); calls++; return 1; };
  submit(room, 0, '未抽中的猫');
  assert.equal(publicRoom(room, keys[0], 1).myTeamWord, null);
  submit(room, 1, '花', choose);
  assert.equal(calls, 1);
  assert.equal(publicRoom(room, keys[0], 2).myTeamWord, '花');
  assert.ok(!JSON.stringify(publicRoom(room, keys[2], 2)).includes('未抽中的猫'));
  assert.ok(!JSON.stringify(publicRoom(room, keys[2], 2)).includes('花'));
  submit(room, 1, '花', choose);
  assert.equal(calls, 1, 'retry never rerolls a team answer');
  submit(room, 2, '未抽中的狗');
  assert.equal(room.phase, 'playing');
  assert.equal(room.history.length, 1);
  submit(room, 3, '花', choose);
  assert.equal(calls, 2);
  assert.equal(room.phase, 'matched');
  assert.deepEqual(room.history[1].words, ['花', '花']);
  assert.equal(room.history[1].teams[0].chosenPlayerId, room.players[1].id);
  assert.deepEqual(teamSizes(room), [4]);
  // The old round remains four singles even after subsequent team merges.
  assert.ok(room.history[0].teams.every(t => t.playerIds.length === 1));
  const oldGame = room.gameId;
  keys.slice(0, 3).forEach(key => act(room, key, 'next', command(room)));
  assert.equal(room.phase, 'matched');
  act(room, keys[3], 'next', command(room));
  assert.equal(room.phase, 'playing');
  assert.notEqual(room.gameId, oldGame);
  assert.deepEqual(teamSizes(room), [1, 1, 1, 1]);
  assert.deepEqual(room.teamAnswers, {});
  assert.deepEqual(room.history, []);
});

test('a team can absorb one solo player and then the last player in later rounds', () => {
  const room = setup();
  ['猫', '猫', '狗', '花'].forEach((word, i) => submit(room, i, word));
  assert.deepEqual(teamSizes(room), [1, 1, 2]);
  ready(room);
  ['桥', '海', '桥', '山'].forEach((word, i) => submit(room, i, word));
  assert.deepEqual(room.history[1].words, ['桥', '桥', '山']);
  assert.deepEqual(teamSizes(room), [1, 3]);
  ready(room);
  ['月', '云', '雨', '月'].forEach((word, i) => submit(room, i, word));
  assert.equal(room.phase, 'matched');
  assert.deepEqual(room.history[2].words, ['月', '月']);
  assert.deepEqual(teamSizes(room), [4]);
});

test('every member of a three-person team is a possible random choice after all confirm', () => {
  for (let index = 0; index < 3; index++) {
    const room = setup();
    ['猫', '猫', '猫', '狗'].forEach((word, i) => submit(room, i, word));
    ready(room);
    let calls = 0;
    const choose = size => { assert.equal(size, 3); calls++; return index; };
    submit(room, 0, '月', choose); submit(room, 1, '星', choose);
    assert.equal(calls, 0);
    submit(room, 2, '云', choose);
    assert.equal(calls, 1);
    assert.equal(publicRoom(room, keys[0], 1).myTeamWord, ['月', '星', '云'][index]);
    submit(room, 3, '山', choose);
    assert.equal(calls, 1);
    assert.deepEqual(room.history[1].words, [['月', '星', '云'][index], '山']);
    assert.deepEqual(teamSizes(room), [1, 3], 'different member inputs never split a team');
  }
});

test('drafts and confirmed words are live only for current teammates and restore on refresh', () => {
  const room = setup();
  ['猫', '猫', '狗', '山'].forEach((word, i) => submit(room, i, word));
  ready(room);
  draft(room, 0, '队内秘密', 2);
  const teammate = publicRoom(room, keys[1], 1);
  assert.equal(teammate.players[0].draft, '队内秘密');
  assert.equal(teammate.myWord, null);
  assert.equal(publicRoom(room, keys[0], 1).myDraft, '队内秘密');
  assert.equal(publicRoom(room, keys[0], 1).myDraftSequence, 2);
  for (const key of keys.slice(2)) {
    const view = publicRoom(room, key, 1);
    assert.equal(view.players[0].draft, null);
    assert.ok(!JSON.stringify(view).includes('队内秘密'));
  }
  draft(room, 0, '过期填写', 1);
  assert.equal(publicRoom(room, keys[1], 2).players[0].draft, '队内秘密');
  draft(room, 0, '', 3);
  assert.equal(publicRoom(room, keys[1], 3).players[0].draft, '');
  submit(room, 0, '确认的秘密');
  assert.equal(publicRoom(room, keys[1], 4).players[0].draft, '确认的秘密');
  assert.throws(() => draft(room, 0, '确认后修改', 4), GameError);
  assert.throws(() => submit(room, 0, '确认后修改'), GameError);
  assert.ok(!JSON.stringify(publicRoom(room, keys[2], 4)).includes('确认的秘密'));
});

test('stale draft requests cannot cross round or game boundaries and malformed drafts fail', () => {
  const room = setup(3);
  const stale = command(room, { word: '过期填写', sequence: 100 });
  for (const extra of [{ word: 42, sequence: 1 }, { word: 'a\nb', sequence: 1 }, { word: '字'.repeat(25), sequence: 1 }, { word: '词', sequence: -1 }, { word: '词', sequence: 1.5 }]) {
    assert.throws(() => act(room, keys[0], 'draft', command(room, extra)), GameError);
  }
  ['猫', '狗', '山'].forEach((word, i) => submit(room, i, word)); ready(room);
  assert.throws(() => act(room, keys[0], 'draft', stale), GameError);
  const previousGame = command(room, { word: '旧游戏', sequence: 1 });
  ['花', '花', '花'].forEach((word, i) => submit(room, i, word)); ready(room);
  assert.throws(() => act(room, keys[0], 'draft', { ...previousGame, round: 1 }), GameError);
  assert.throws(() => draft(room, 3, '陌生人'), GameError);
});

test('matches compare this round only and never merge synonyms or differently cased text', () => {
  const room = setup();
  ['猫', '狗', '睡觉', '睡眠'].forEach((word, i) => submit(room, i, word));
  assert.equal(room.teams.length, 4); ready(room);
  ['狗', '猫', 'Cat', 'cat'].forEach((word, i) => submit(room, i, word));
  assert.equal(room.teams.length, 4); ready(room);
  ['  花 ', '花', '花', '花'].forEach((word, i) => submit(room, i, word));
  assert.equal(room.phase, 'matched');
});
