'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronLeft, Copy, Heart, HelpCircle, Link, LoaderCircle, LockKeyhole, Plus, RotateCcw, Sparkles, Users, X } from 'lucide-react';

type Player = { id:string; name:string; online:boolean; submitted:boolean; ready:boolean };
type Round = { round:number; words:string[]; matched:boolean; at:number };
type Game = { code:string; gameId:string; createdAt:number; phase:'waiting'|'playing'|'reveal'|'matched'; round:number; revision:number; meId:string; myWord:string|null; players:Player[]; history:Round[] };
type Session = { code:string; token:string };
class ApiError extends Error { constructor(message:string, public status:number) { super(message); } }
async function request(token:string, body?:Record<string,unknown>, code?:string):Promise<Game> {
  const response = await fetch(body ? '/api/room' : `/api/room?code=${encodeURIComponent(code || '')}`, {
    method:body?'POST':'GET', headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined, cache:'no-store', signal:AbortSignal.timeout(12000),
  });
  const data = await response.json() as Game & {error?:string};
  if (!response.ok) throw new ApiError(data.error || '连接没有成功，请重试',response.status);
  return data;
}
const errorText = (e:unknown) => e instanceof ApiError ? e.message : '连接暂时中断，检查网络后再试试';
function Logo(){return <div className="brand"><span className="logo-mark" aria-hidden="true"><i/><i/><b>··</b></span><span>同词相遇<em>SAME WAVELENGTH</em></span></div>}

export default function Home(){
  const [tab,setTab]=useState<'create'|'join'>('create'), [name,setName]=useState(''), [code,setCode]=useState('');
  const [session,setSession]=useState<Session|null>(null), [game,setGame]=useState<Game|null>(null), [word,setWord]=useState('');
  const [busy,setBusy]=useState(false), [loading,setLoading]=useState(true), [connected,setConnected]=useState(true);
  const [notice,setNotice]=useState(''), [error,setError]=useState(''), [rules,setRules]=useState(false), [exit,setExit]=useState(false);
  const ruleDialog=useRef<HTMLDialogElement>(null), exitDialog=useRef<HTMLDialogElement>(null), submitting=useRef(false);
  const accept=useCallback((data:Game)=>{setGame(old=>old&&old.code===data.code&&old.revision>data.revision?old:data);setConnected(true)},[]);
  useEffect(()=>{
    const invitation=(new URLSearchParams(location.search).get('room')||'').toUpperCase();
    if(invitation){setCode(invitation);setTab('join')}
    try{setName(localStorage.getItem('tongci.name')||'');const saved=JSON.parse(sessionStorage.getItem(`tongci.session.${invitation}`)||'null');if(saved?.code===invitation&&saved?.token)setSession(saved)}catch{}
    setLoading(false);
  },[]);
  useEffect(()=>{
    if(!session)return;
    let alive=true,inFlight=false,lastHeartbeat=0;
    async function poll(){
      if(inFlight)return;inFlight=true;
      try{const beat=Date.now()-lastHeartbeat>15000;const data=await request(session!.token,beat?{action:'heartbeat',code:session!.code}:undefined,session!.code);if(beat)lastHeartbeat=Date.now();if(alive)accept(data)}
      catch(e){if(alive){setConnected(false);if(e instanceof ApiError&&[401,403,404,410].includes(e.status)){setError(e.message);setCode(session!.code);setTab('join');setSession(null);setGame(null);try{sessionStorage.removeItem(`tongci.session.${session!.code}`)}catch{}}}}
      finally{inFlight=false}
    }
    void poll();const timer=setInterval(poll,1400);const wake=()=>{if(!document.hidden)void poll()};
    document.addEventListener('visibilitychange',wake);window.addEventListener('online',wake);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('online',wake)};
  },[session,accept]);
  useEffect(()=>{if(game){setWord('');setError('')}},[game?.gameId,game?.round]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer)},[notice]);
  useEffect(()=>{if(rules)ruleDialog.current?.showModal();else ruleDialog.current?.close()},[rules]);
  useEffect(()=>{if(exit)exitDialog.current?.showModal();else exitDialog.current?.close()},[exit]);

  async function enter(e:FormEvent){
    e.preventDefault();if(submitting.current)return;
    if(tab==='join'&&!/^[A-Z2-9]{6}$/.test(code.trim())){setError('请输入 6 位房间号');return}
    submitting.current=true;setBusy(true);setError('');let token=crypto.randomUUID()+crypto.randomUUID();
    if(tab==='join'){try{const saved=JSON.parse(sessionStorage.getItem(`tongci.session.${code.trim()}`)||'null');if(saved?.token)token=saved.token;else sessionStorage.setItem(`tongci.session.${code.trim()}`,JSON.stringify({code:code.trim(),token}))}catch{}}
    try{const data=await request(token,{action:tab==='create'?'create':'join',code:code.trim(),name:name.trim()||'神秘朋友'});const saved={code:data.code,token};
      try{sessionStorage.setItem(`tongci.session.${data.code}`,JSON.stringify(saved));localStorage.setItem('tongci.name',name.trim())}catch{}
      history.replaceState({},'',`/?room=${data.code}`);setGame(data);setSession(saved);setConnected(true);
    }catch(e){setError(errorText(e))}finally{submitting.current=false;setBusy(false)}
  }
  async function action(kind:'submit'|'next',e?:FormEvent){
    e?.preventDefault();if(!session||!game||submitting.current)return;
    submitting.current=true;setBusy(true);setError('');
    try{accept(await request(session.token,{action:kind,code:game.code,gameId:game.gameId,round:game.round,word}))}
    catch(e){setError(errorText(e));try{accept(await request(session.token,undefined,session.code))}catch{setConnected(false)}}
    finally{submitting.current=false;setBusy(false)}
  }
  function leave(){setSession(null);setGame(null);setCode('');setWord('');setError('');setExit(false);history.replaceState({},'','/')}
  async function invite(){if(!game)return;const url=new URL('/',location.origin);url.searchParams.set('room',game.code);try{await navigator.clipboard.writeText(url.href);setNotice('邀请链接已复制，发给朋友就好')}catch{setNotice(`复制地址栏链接，或告诉朋友房间号 ${game.code}`)}}
  async function download(){
    if(!game)return;const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=510+112*game.history.length;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#fbf9f5';ctx.fillRect(0,0,1000,canvas.height);ctx.fillStyle='#665078';ctx.font='bold 30px sans-serif';ctx.fillText('同词相遇',56,68);
    ctx.textAlign='center';ctx.font='bold 52px sans-serif';ctx.fillText('你们的脑回路相遇了',500,170);ctx.font='28px sans-serif';ctx.fillStyle='#81718f';ctx.fillText(`用了 ${game.history.length} 轮，我们都想到了「${game.history.at(-1)?.words[0]}」`,500,235,900);
    ctx.font='22px sans-serif';ctx.fillText(`房间 ${game.code} · ${new Date(game.createdAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}`,500,286);
    game.history.forEach((r,i)=>{const y=340+i*112;ctx.textAlign='left';ctx.font='19px sans-serif';ctx.fillStyle='#9a8da5';ctx.fillText(`第 ${r.round} 轮`,56,y);
      r.words.forEach((w,j)=>{const x=j?532:56;ctx.fillStyle=j?'#e1f1ed':'#eee6fa';ctx.beginPath();ctx.roundRect(x,y+16,412,66,13);ctx.fill();ctx.fillStyle=j?'#4d9290':'#8262ae';ctx.font='bold 29px sans-serif';ctx.textAlign='center';ctx.fillText(w,x+206,y+60,380)});
      ctx.font='30px sans-serif';ctx.fillStyle=r.matched?'#7c9a86':'#b4a6c0';ctx.fillText(r.matched?'✓':'×',500,y+60)});
    const y=362+112*game.history.length;ctx.strokeStyle='#dfd5e5';ctx.beginPath();ctx.moveTo(56,y);ctx.lineTo(944,y);ctx.stroke();ctx.textAlign='left';ctx.fillStyle='#665078';ctx.font='bold 28px sans-serif';ctx.fillText('同词相遇',56,y+60);ctx.fillStyle='#93839f';ctx.font='22px sans-serif';ctx.fillText('和朋友的脑回路碰个面',56,y+100);
    const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/png'));if(!blob){setNotice('图片没能保存，请重试');return}const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`同词相遇-${game.code}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);setNotice('默契记录已生成');
  }
  const me=game?.players.find(p=>p.id===game.meId),friend=game?.players.find(p=>p.id!==game.meId);
  const revealed=game?.phase==='reveal'||game?.phase==='matched',matched=game?.phase==='matched',last=game?.history.at(-1);
  return <>
    <header className="site-header"><a href="/" onClick={e=>{if(session){e.preventDefault();setExit(true)}}} aria-label="同词相遇首页"><Logo/></a><button className="plain" onClick={()=>setRules(true)}><HelpCircle size={17}/>怎么玩</button></header>
    {!game&&!session?<main className="home-main">
      <section className="intro"><div className="eyebrow"><span/>两个人的默契小游戏</div><h1>和你的脑回路，<br/>碰个<span className="accent-word">面<svg viewBox="0 0 100 15" aria-hidden="true"><path d="M2 10Q40 1 98 7M12 14Q55 5 88 11"/></svg></span>。</h1><p className="intro-copy">各想一个词，同时揭晓。<br/>一轮一轮，直到我们想到一起。</p>
        <div className="mini-meeting" aria-label="同词示例：两个人都想到睡觉"><div className="little-word purple"><span>你的脑回路</span><strong>睡觉</strong><i>✦</i></div><span className="meeting-line"><svg viewBox="0 0 78 32" aria-hidden="true"><path d="M3 23C26 23 19 3 37 8S51 34 73 12"/></svg><Heart size={19}/></span><div className="little-word mint"><span>TA 的脑回路</span><strong>睡觉</strong><i>✦</i></div><div className="example-note">原来，你也这么想 ↗</div></div>
        <div className="tiny-note"><Users size={15}/>双人联机<span>·</span>分享链接即刻加入<span>·</span>无需注册</div>
      </section>
      <section className="entry-card"><div className="card-top"><span className="card-spark"><Sparkles size={21}/></span><span className="small-tag">LET’S MEET</span></div><h2>{tab==='create'?'这次，会有多默契？':'赴一场默契之约'}</h2><p className="card-description">{tab==='create'?'开一个小房间，等一个懂你的人。':'输入朋友的房间号，让脑回路相遇。'}</p>
        <div className="entry-tabs" role="tablist" aria-label="进入方式"><button role="tab" aria-selected={tab==='create'} className={tab==='create'?'active':''} onClick={()=>{setTab('create');setError('')}}><Plus size={16}/>创建房间</button><button role="tab" aria-selected={tab==='join'} className={tab==='join'?'active':''} onClick={()=>{setTab('join');setError('')}}><Link size={16}/>加入房间</button></div>
        <form onSubmit={enter}><label className="field-label" htmlFor="nickname">怎么称呼你<span>选填</span></label><input id="nickname" autoComplete="nickname" maxLength={16} placeholder="取个名字，让朋友认出你" value={name} onChange={e=>setName(e.target.value)}/>
          {tab==='join'&&<><label className="field-label" htmlFor="room-code">朋友的房间号</label><input id="room-code" className="code-input" placeholder="输入 6 位房间号" maxLength={6} autoComplete="off" spellCheck={false} value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))}/></>}
          {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary entry-submit" type="submit" disabled={busy||loading}>{busy||loading?<LoaderCircle className="spin" size={19}/>:<><span>{tab==='create'?'开启一场相遇':'进入朋友的房间'}</span><ArrowRight size={20}/></>}</button>
        </form><p className="entry-footnote"><LockKeyhole size={13}/>答案保密，直到两个人都准备好</p>
      </section>
      <section className="how-strip" aria-label="游戏步骤">{[['想到什么，就写什么','一个词，一点直觉，不用想太多。'],['一起揭晓答案','双方提交后，看看这次的脑回路。'],['直到同词相遇','没想到一起？下一轮再靠近一点。']].map(([title,text],i)=><div key={title}><b>0{i+1}</b><section><h3>{title}</h3><p>{text}</p></section></div>)}</section>
    </main>:!game?<main className="loading-room"><LoaderCircle className="spin"/><p>正在回到你们的小房间…</p></main>:<main className="room-main">
      <div className="room-toolbar"><button className="plain" onClick={()=>setExit(true)}><ChevronLeft size={17}/>返回首页</button><div className={`connection ${connected?'':'offline'}`}><span/>{connected?'房间已连接':'正在重新连接…'}</div></div>
      <div className="room-heading"><div><div className="eyebrow">{matched?'WE FOUND EACH OTHER':'A LITTLE CLOSER, EVERY ROUND'}</div><h1>{matched?'你们的脑回路相遇了':game.phase==='waiting'?'留一个位置，等你来。':'这一词，会想到一起吗？'}</h1><p>{matched?`用了 ${game.history.length} 轮，我们都想到了「${last?.words[0]}」`:game.phase==='waiting'?'分享邀请链接，朋友进来就能开始。':'不用偷偷对答案，相信第一直觉。'}</p></div><button className="room-code" onClick={invite} title="复制邀请链接"><span>房间号</span><strong>{game.code}</strong><Copy size={15}/></button></div>
      {game.phase==='waiting'?<section className="waiting-card"><div className="waiting-illustration" aria-hidden="true"><span>{me?.name.slice(0,1)}</span><i>···</i><span>?</span></div><h2>你的默契搭子，还差一步</h2><p>把这条邀请发给 TA，<br/>让两条脑回路在这里碰个面。</p><button className="primary" onClick={invite}><Copy size={18}/>复制邀请链接</button><div className="waiting-code">也可以告诉朋友房间号 <strong>{game.code}</strong></div><p className="privacy-note"><LockKeyhole size={13}/>每个房间仅限两人 · 临时房间</p></section>:<>
        <section className={`play-card ${matched?'success-card':''}`}><div className="round-heading"><span>{matched?<><Heart size={15}/>默契达成</>:<>第 {String(game.round).padStart(2,'0')} 轮</>}</span><span>{matched?'SAME WORD, SAME HEART':'两个人 · 同时揭晓'}</span></div>
          <div className="player-pair">{game.players.map((p,i)=><div key={p.id} className={`player-tile ${i?'mint':'purple'}`}><span className="player-avatar">{p.name.slice(0,1)}</span><div><strong>{p.name}{p.id===game.meId&&<small>你</small>}</strong><span className="player-status">{revealed?<><Check size={13}/>已揭晓</>:p.submitted?<><CheckCheck size={14}/>已提交，等待揭晓</>:p.online?'正在酝酿一个词…':'暂时离线，等 TA 回来'}</span></div><span className="player-symbol">{revealed?'✦':p.submitted?<LockKeyhole size={17}/>:'···'}</span></div>)}</div>
          {revealed?<div className="reveal-content" aria-live="polite"><div className="answer-pair"><div className="answer-word purple">{last?.words[0]}</div><span className={matched?'match-icon':'not-match-icon'}>{matched?<Check size={28}/>:<X size={24}/>}</span><div className="answer-word mint">{last?.words[1]}</div></div><h2>{matched?'原来，我们想到了一起。':'差一点，再靠近一点。'}</h2><p>{matched?'把这一刻存下来，留给你们的默契。':'可以顺着这两个词联想，也可以相信新的直觉。'}</p><div className="reveal-actions"><button className="primary" disabled={busy||me?.ready||!connected} onClick={()=>action('next')}>{busy?<LoaderCircle className="spin" size={17}/>:me?.ready?<><Check size={17}/>等朋友准备好</>:matched?<><RotateCcw size={17}/>再相遇一次</>:<><span>准备下一轮</span><ArrowRight size={18}/></>}</button>{matched&&<button className="secondary" onClick={download}><ArrowUpRight size={17}/>保存默契记录</button>}</div><p className="ready-note">{me?.ready?'你已准备好，双方准备后会一起开始。':friend?.ready?`${friend.name} 已准备好，就等你啦。`:'双方准备后，一起开始新一轮。'}</p></div>:
          <form className="word-form" onSubmit={e=>action('submit',e)}><label htmlFor="your-word">{me?.submitted?'你的词语已锁定':'此刻，你想到了什么？'}</label><div className={`word-input-wrap ${me?.submitted?'locked':''}`}><input id="your-word" maxLength={24} autoComplete="off" placeholder="写下你的那个词…" value={me?.submitted?game.myWord||'':word} disabled={me?.submitted} onChange={e=>setWord(e.target.value)} aria-describedby="word-hint"/>{me?.submitted?<LockKeyhole size={21}/>:<span>{[...word].length}/24</span>}</div><p className="word-hint" id="word-hint"><LockKeyhole size={13}/>{me?.submitted?'朋友还看不到你的答案，等 TA 提交就一起揭晓。':'提交后不能修改，朋友提交前看不到你的答案。'}</p><button className="primary word-submit" type="submit" disabled={busy||me?.submitted||!word.trim()||!connected}>{busy?<LoaderCircle className="spin" size={18}/>:me?.submitted?<><LoaderCircle className="spin slow" size={17}/>等待朋友的词语</>:<><span>我想好了，提交词语</span><ArrowRight size={18}/></>}</button></form>}
          {error&&<p className="form-error centered" role="alert">{error}</p>}
        </section>
        {!!game.history.length&&<section className="history-section"><div className="history-heading"><h2>我们的脑回路</h2><span>{game.history.length} 次靠近{matched?'，终于相遇':''}</span></div><div className="history-player-labels"><span>{game.players[0].name}</span><span>{game.players[1].name}</span></div>{[...game.history].reverse().map(r=><div className="history-round" key={`${game.gameId}-${r.round}`}><span className="history-round-label">第 {r.round} 轮</span><div className="history-answers"><div className="purple">{r.words[0]}</div><span className={r.matched?'match-icon':'not-match-icon'}>{r.matched?<Check size={20}/>:<X size={17}/>}</span><div className="mint">{r.words[1]}</div></div></div>)}</section>}
      </>}
      <p className="room-bottom"><Heart size={13}/>每一次不一样，都是靠近的方向。</p>
    </main>}
    <footer className="site-footer"><span>同词相遇 <i>·</i> 和朋友的脑回路碰个面</span><span>一点直觉，一点默契。<Sparkles size={13}/></span></footer>
    {notice&&<div className="toast" role="status"><Check size={17}/>{notice}</div>}
    <dialog ref={ruleDialog} className="modal" onCancel={()=>setRules(false)} onClick={e=>{if(e.target===ruleDialog.current)setRules(false)}}><button className="modal-close plain" onClick={()=>setRules(false)} aria-label="关闭玩法说明"><X size={20}/></button><span className="card-spark"><Sparkles size={23}/></span><h2>默契，其实很简单。</h2><ol><li><b>邀请一个朋友</b><p>创建房间，把邀请链接或 6 位房间号发给 TA。</p></li><li><b>各自写一个词</b><p>提交后答案锁定，双方都提交才一起揭晓。</p></li><li><b>直到想到一起</b><p>文字不同就继续，完全相同即达成默契。只忽略首尾空格，“睡觉”和“睡眠”算不同。</p></li></ol><p className="modal-note">刷新页面可以回到原房间；房间最多保留 24 小时，服务重启后需重新创建。</p><button className="primary" onClick={()=>setRules(false)}>懂了，去碰个面<ArrowRight size={17}/></button></dialog>
    <dialog ref={exitDialog} className="modal" onCancel={()=>setExit(false)}><h2>先离开这个小房间？</h2><p className="exit-copy">你的位置会保留。在这个浏览器标签页里，稍后用原邀请链接就能回来，刷新页面也能继续。</p><button className="primary" onClick={()=>setExit(false)}>继续和朋友玩</button><button className="plain leave-confirm" onClick={leave}>返回首页</button></dialog>
  </>;
}
