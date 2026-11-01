import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { act, GameError, newRoom, publicRoom } from '../lib/game.mjs';

const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
const maxBody = 4096;

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  response.end(JSON.stringify(body));
}

function identity(request) {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string' || !/^Bearer [a-zA-Z0-9-]{32,100}$/.test(raw)) throw new GameError('连接凭证已失效，请重新加入房间', 401);
  return createHash('sha256').update(raw.slice(7)).digest('hex');
}

function readBody(request) {
  if (Number(request.headers['content-length'] || 0) > maxBody) {
    request.resume();
    throw new GameError('输入内容太长了', 413);
  }
  return new Promise((resolveBody, reject) => {
    let bytes = 0, tooLarge = false, chunks = [];
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBody) {
        chunks = [];
        if (!tooLarge) reject(new GameError('输入内容太长了', 413));
        tooLarge = true;
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolveBody(value);
      } catch { reject(new GameError('提交内容没有读懂，请重试')); }
    });
    request.on('aborted', () => reject(new GameError('提交中断，请重试')));
    request.on('error', () => reject(new GameError('提交中断，请重试')));
  });
}

function checkOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    // Render terminates HTTPS before forwarding HTTP; compare the original host.
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host.toLowerCase() !== request.headers.host?.toLowerCase()) throw new Error();
  } catch { throw new GameError('请从游戏页面发起操作', 403); }
}

export function createApp({ distDir = resolve('dist'), ttlMs = 86400000, maxRooms = 500, now = Date.now } = {}) {
  const rooms = new Map();
  const root = resolve(distDir);
  function cleanup() {
    const time = now();
    for (const [code, record] of rooms) if (record.expiresAt <= time) rooms.delete(code);
  }
  function getRoom(code) {
    if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code)) throw new GameError('请输入 6 位房间号');
    const record = rooms.get(code);
    if (!record) throw new GameError('房间不存在或服务已重启，请重新创建房间', 404);
    if (record.expiresAt <= now()) { rooms.delete(code); throw new GameError('这个房间已经过期，重新开一间吧', 410); }
    return record;
  }
  async function api(request, response, url) {
    if (!['GET', 'POST'].includes(request.method)) { response.setHeader('Allow','GET, POST'); throw new GameError('这个操作暂不支持',405); }
    const tokenHash = identity(request);
    if (request.method === 'GET') {
      const record = getRoom((url.searchParams.get('code') || '').trim().toUpperCase());
      return sendJson(response,200,publicRoom(record.state,tokenHash,record.revision,now()));
    }
    checkOrigin(request);
    const input = await readBody(request);
    // After body parsing, every room read/write is synchronous in this single process.
    // Simultaneous joins and submissions therefore cannot overwrite one another.
    if (input.action === 'create') {
      cleanup();
      if (rooms.size >= maxRooms) throw new GameError('房间暂时有点满，请稍后再试',503);
      let code;
      do { code = Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
      const record = {state:newRoom(code,tokenHash,input.name,now()),revision:0,expiresAt:now()+ttlMs};
      rooms.set(code,record);
      return sendJson(response,201,publicRoom(record.state,tokenHash,record.revision,now()));
    }
    if (!['join','submit','next','heartbeat'].includes(input.action)) throw new GameError('没有找到这个操作');
    const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
    const record = getRoom(code);
    const updated = structuredClone(record.state);
    act(updated,tokenHash,input.action,input,now());
    record.state = updated;
    record.revision += 1;
    return sendJson(response,200,publicRoom(updated,tokenHash,record.revision,now()));
  }
  const server = createServer(async (request,response) => {
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');
    try {
      const url = new URL(request.url || '/', 'http://local');
      if (url.pathname === '/healthz' && ['GET','HEAD'].includes(request.method)) {
        if (request.method === 'HEAD') { response.writeHead(200); return response.end(); }
        return sendJson(response,200,{ok:true});
      }
      if (url.pathname === '/api/room') return await api(request,response,url);
      if (url.pathname.startsWith('/api/')) throw new GameError('没有找到这个接口',404);
      if (!['GET','HEAD'].includes(request.method)) { response.setHeader('Allow','GET, HEAD'); throw new GameError('这个操作暂不支持',405); }
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { throw new GameError('无效的网址'); }
      if (path !== '/' && path !== '/favicon.svg' && !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path)) throw new GameError('没有找到这个页面',404);
      const file = resolve(root,path === '/'?'index.html':'.'+path);
      if (!file.startsWith(root+sep)) throw new GameError('没有找到这个页面',404);
      let data;
      try { data = await readFile(file); } catch (error) {
        if (['ENOENT','EISDIR','ENOTDIR'].includes(error.code)) throw new GameError('没有找到这个页面',404);
        throw error;
      }
      response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':data.length,
        'Cache-Control':path.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
      response.end(request.method === 'HEAD'?undefined:data);
    } catch (error) {
      if (response.writableEnded || response.destroyed) return;
      if (error instanceof GameError) return sendJson(response,error.status,{error:error.message});
      console.error('Request failed:',error instanceof Error?error.message:'unknown');
      sendJson(response,500,{error:'连接暂时有点忙，请稍后再试'});
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const cleaner = setInterval(cleanup,60000);
  cleaner.unref();
  server.on('close',()=>clearInterval(cleaner));
  return server;
}
