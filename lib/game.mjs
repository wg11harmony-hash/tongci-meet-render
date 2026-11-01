export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function cleanWord(value) {
  if (typeof value !== 'string') throw new GameError('先写下你的词语吧');
  const word = value.trim();
  if (!word) throw new GameError('先写下你的词语吧');
  if ([...word].length > 24) throw new GameError('词语请控制在 24 个字以内');
  if (/[\u0000-\u001f\u007f]/u.test(word)) throw new GameError('请用一行文字输入词语');
  return word;
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16) || '神秘朋友' : '神秘朋友';
}

export function newRoom(code, tokenHash, name, now = Date.now()) {
  return { code, gameId: crypto.randomUUID(), createdAt: now, phase: 'waiting', round: 1,
    players: [{ id: crypto.randomUUID(), tokenHash, name: cleanName(name), seenAt: now }],
    answers: {}, next: [], history: [] };
}

export function act(room, tokenHash, action, input = {}, now = Date.now()) {
  const player = room.players.find(p => p.tokenHash === tokenHash);
  if (action === 'join') {
    if (player) return room;
    if (room.players.length >= 2) throw new GameError('这个房间已经有两个人了，换一个房间吧', 409);
    room.players.push({ id: crypto.randomUUID(), tokenHash, name: cleanName(input.name), seenAt: now });
    room.phase = 'playing';
    return room;
  }
  if (!player) throw new GameError('请先加入这个房间', 403);
  player.seenAt = now;
  if (action === 'heartbeat') return room;
  if (input.gameId !== room.gameId || input.round !== room.round) throw new GameError('这一轮已经更新，请稍后重试', 409);
  if (action === 'submit') {
    if (room.phase !== 'playing') throw new GameError('请等待两个人进入当前轮次', 409);
    const word = cleanWord(input.word);
    if (Object.hasOwn(room.answers, player.id)) {
      if (room.answers[player.id] === word) return room;
      throw new GameError('这一轮已经提交，揭晓前不能修改哦', 409);
    }
    room.answers[player.id] = word;
    if (room.players.every(p => Object.hasOwn(room.answers, p.id))) {
      const words = room.players.map(p => room.answers[p.id]);
      const matched = words[0] === words[1];
      room.history.push({ round: room.round, words, matched, at: now });
      room.phase = matched ? 'matched' : 'reveal';
    }
    return room;
  }
  if (action === 'next') {
    if (!['reveal', 'matched'].includes(room.phase)) throw new GameError('这一轮还没揭晓呢', 409);
    if (!room.next.includes(player.id)) room.next.push(player.id);
    if (room.next.length === 2) {
      if (room.phase === 'matched') { room.round = 1; room.history = []; room.gameId = crypto.randomUUID(); room.createdAt = now; }
      else room.round += 1;
      room.phase = 'playing'; room.answers = {}; room.next = [];
    }
    return room;
  }
  throw new GameError('没有找到这个操作', 400);
}

export function publicRoom(room, tokenHash, revision, now = Date.now()) {
  const me = room.players.find(p => p.tokenHash === tokenHash);
  if (!me) throw new GameError('请先加入这个房间', 403);
  return { code: room.code, gameId: room.gameId, createdAt: room.createdAt, phase: room.phase,
    round: room.round, revision, meId: me.id, myWord: room.answers[me.id] ?? null,
    players: room.players.map(p => ({ id: p.id, name: p.name, online: now - p.seenAt < 45000,
      submitted: Object.hasOwn(room.answers, p.id), ready: room.next.includes(p.id) })),
    history: room.history };
}
