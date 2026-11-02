import { randomInt } from 'node:crypto';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function cleanDraft(value) {
  if (typeof value !== 'string') throw new GameError('先写下你的词语吧');
  if ([...value].length > 24) throw new GameError('词语请控制在 24 个字以内');
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new GameError('请用一行文字输入词语');
  return value;
}

export function cleanWord(value) {
  if (typeof value !== 'string' || !value.trim()) throw new GameError('先写下你的词语吧');
  return cleanDraft(value.trim());
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16) || '神秘朋友' : '神秘朋友';
}

const soloTeam = player => ({ id: crypto.randomUUID(), playerIds: [player.id] });

export function newRoom(code, tokenHash, name, now = Date.now(), capacity = 2) {
  if (![2, 3, 4].includes(capacity)) throw new GameError('请选择 2、3 或 4 人房');
  const player = { id: crypto.randomUUID(), tokenHash, name: cleanName(name), seenAt: now };
  return { code, capacity, gameId: crypto.randomUUID(), createdAt: now, phase: 'waiting', round: 1,
    players: [player], teams: [soloTeam(player)], answers: {}, drafts: {}, teamAnswers: {}, next: [], history: [] };
}

function reveal(room, now) {
  // Snapshot the teams that actually played this round before merging them.
  const teams = room.teams.map(team => ({ ...room.teamAnswers[team.id], playerIds: [...team.playerIds] }));
  const words = teams.map(team => team.word);
  const matched = words.every(word => word === words[0]);
  const groups = new Map();
  for (const team of teams) {
    const group = groups.get(team.word);
    if (group) { group.playerIds.push(...team.playerIds); group.sources += 1; }
    else groups.set(team.word, { id: team.teamId, playerIds: [...team.playerIds], sources: 1 });
  }
  const merged = [...groups.values()].filter(group => group.sources > 1).map(group => [...group.playerIds]);
  room.history.push({ round: room.round, words, teams, merged, matched, at: now });
  room.teams = [...groups.values()].map(({ id, playerIds }) => ({ id, playerIds }));
  room.phase = matched ? 'matched' : 'reveal';
}

export function act(room, tokenHash, action, input = {}, now = Date.now(), chooseIndex = randomInt) {
  const player = room.players.find(p => p.tokenHash === tokenHash);
  if (action === 'join') {
    if (player) { player.seenAt = now; return room; }
    if (room.players.length >= room.capacity || room.phase !== 'waiting') throw new GameError(`这个 ${room.capacity} 人房已经满了，换一个房间吧`, 409);
    const joined = { id: crypto.randomUUID(), tokenHash, name: cleanName(input.name), seenAt: now };
    room.players.push(joined);
    room.teams.push(soloTeam(joined));
    if (room.players.length === room.capacity) room.phase = 'playing';
    return room;
  }
  if (!player) throw new GameError('请先加入这个房间', 403);
  player.seenAt = now;
  if (action === 'heartbeat') return room;
  if (input.gameId !== room.gameId || input.round !== room.round) throw new GameError('这一轮已经更新，请稍后重试', 409);
  if (action === 'draft') {
    if (room.phase !== 'playing' || Object.hasOwn(room.answers, player.id)) throw new GameError('这一轮已锁定，请等待下一轮', 409);
    const word = cleanDraft(input.word);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new GameError('填写内容已更新，请刷新后重试');
    // Ignore delayed requests so an older keystroke can never overwrite a newer one.
    if (input.sequence > (room.drafts[player.id]?.sequence ?? 0)) room.drafts[player.id] = { word, sequence: input.sequence };
    return room;
  }
  if (action === 'submit') {
    if (room.phase !== 'playing') throw new GameError('请等待所有人进入当前轮次', 409);
    const word = cleanWord(input.word);
    if (Object.hasOwn(room.answers, player.id)) {
      if (room.answers[player.id] === word) return room;
      throw new GameError('这一轮已经确认，揭晓前不能修改哦', 409);
    }
    room.answers[player.id] = word;
    const team = room.teams.find(t => t.playerIds.includes(player.id));
    if (team.playerIds.every(id => Object.hasOwn(room.answers, id))) {
      const chosenPlayerId = team.playerIds.length === 1 ? player.id : team.playerIds[chooseIndex(team.playerIds.length)];
      room.teamAnswers[team.id] = { teamId: team.id, playerIds: [...team.playerIds], word: room.answers[chosenPlayerId], chosenPlayerId };
    }
    if (room.players.every(p => Object.hasOwn(room.answers, p.id))) reveal(room, now);
    return room;
  }
  if (action === 'next') {
    if (!['reveal', 'matched'].includes(room.phase)) throw new GameError('这一轮还没揭晓呢', 409);
    if (!room.next.includes(player.id)) room.next.push(player.id);
    if (room.next.length === room.players.length) {
      if (room.phase === 'matched') {
        room.round = 1; room.history = []; room.gameId = crypto.randomUUID(); room.createdAt = now;
        room.teams = room.players.map(soloTeam);
      } else room.round += 1;
      room.phase = 'playing'; room.answers = {}; room.drafts = {}; room.teamAnswers = {}; room.next = [];
    }
    return room;
  }
  throw new GameError('没有找到这个操作', 400);
}

export function publicRoom(room, tokenHash, revision, now = Date.now()) {
  const me = room.players.find(p => p.tokenHash === tokenHash);
  if (!me) throw new GameError('请先加入这个房间', 403);
  const myTeam = room.teams.find(team => team.playerIds.includes(me.id));
  return { code: room.code, capacity: room.capacity, gameId: room.gameId, createdAt: room.createdAt, phase: room.phase,
    round: room.round, revision, meId: me.id, myWord: room.answers[me.id] ?? null,
    myDraft: room.drafts[me.id]?.word ?? '', myDraftSequence: room.drafts[me.id]?.sequence ?? 0,
    myTeamWord: room.phase === 'playing' ? room.teamAnswers[myTeam.id]?.word ?? null : null,
    teams: room.teams.map(team => ({ id: team.id, playerIds: [...team.playerIds] })),
    players: room.players.map(p => ({ id: p.id, name: p.name, online: now - p.seenAt < 45000,
      submitted: Object.hasOwn(room.answers, p.id), ready: room.next.includes(p.id),
      draft: room.phase === 'playing' && myTeam.playerIds.includes(p.id) ? room.answers[p.id] ?? room.drafts[p.id]?.word ?? '' : null })),
    history: room.history };
}
