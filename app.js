/**
 * FlowBoard — app.js
 * All application logic lives here.
 * config.js must be loaded before this file.
 */
(function(){
'use strict';

/* ── PATHS ── */
const JSON_PATH='data/tickets.json';
const CSV_PATH='data/tickets.csv';

/* ── STATE ── */
const shaCache={};
let cfg={}, isEditor=false;
let state={todo:[],inprogress:[],done:[]};
let draggedId=null, dropTarget={status:null,index:null};
let editingId=null, modalStatus=null, lastSavedAt=null;
let _saveRunning=false, _savePending=false, saveTimer=null;

/* ── BOOT ── */
function init(){
  /* merge: hardcoded config → localStorage overrides */
  const base=window.__FLOWBOARD_CONFIG__||{};
  cfg={
    owner:  ls('gh_owner') ||base.owner ||'',
    repo:   ls('gh_repo')  ||base.repo  ||'',
    branch: ls('gh_branch')||base.branch||'main',
    token:  ls('gh_token') ||base.token ||'',
    password: ls('board_pw')||base.password||'kanban123',
  };
  loadLocal();render();
  if(isGHReady()) loadFromGitHub();
  document.getElementById('pwInput').addEventListener('keydown',e=>{
    if(e.key==='Enter') tryPassword();
  });
}

/* ── PASSWORD ── */
window.tryPassword=function(){
  const val=document.getElementById('pwInput').value;
  const inp=document.getElementById('pwInput');
  if(val===cfg.password){
    isEditor=true;
    document.getElementById('pwScreen').style.display='none';
    render();
    setPill('ghPill','ghStatus',isGHReady()?'ok':'warn',isGHReady()?'github ok':'not configured');
    showToast('Unlocked as editor','ok');
  } else {
    inp.classList.add('shake');
    document.getElementById('pwErr').textContent='Incorrect password';
    setTimeout(()=>{inp.classList.remove('shake');document.getElementById('pwErr').textContent='';},400);
  }
};
window.enterAsViewer=function(){
  document.getElementById('pwScreen').style.display='none';
  render();
  setPill('ghPill','ghStatus',isGHReady()?'ok':'warn',isGHReady()?'github ok':'not configured');
};

/* ── GITHUB API ── */
const isGHReady=()=>!!(cfg.token&&cfg.owner&&cfg.repo);
const ghH=()=>({'Authorization':`token ${cfg.token}`,'Content-Type':'application/json','Accept':'application/vnd.github+json'});

async function ghGet(path){
  const r=await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}?ref=${cfg.branch}&_=${Date.now()}`,{headers:ghH()});
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(()=>({}))).message||''}`);
  const data=await r.json();
  if(data.sha) shaCache[path]=data.sha;
  return data;
}

async function ghPut(path,content){
  const body={
    message:`chore: update ${path} via FlowBoard`,
    content:btoa(unescape(encodeURIComponent(content))),
    branch:cfg.branch
  };
  if(shaCache[path]) body.sha=shaCache[path];
  let r=await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`,{method:'PUT',headers:ghH(),body:JSON.stringify(body)});
  if(r.status===409){
    const fresh=await ghGet(path);
    if(fresh) body.sha=fresh.sha;
    r=await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`,{method:'PUT',headers:ghH(),body:JSON.stringify(body)});
  }
  if(!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(()=>({}))).message||''}`);
  const d=await r.json();
  if(d.content&&d.content.sha) shaCache[path]=d.content.sha;
  return d;
}

async function loadFromGitHub(){
  setPill('syncPill','syncStatus','warn','loading…');
  try{
    const file=await ghGet(JSON_PATH);
    if(file){
      const raw=decodeURIComponent(escape(atob(file.content.replace(/\n/g,''))));
      const parsed=JSON.parse(raw);
      const m={todo:[],inprogress:[],done:[]};
      if(Array.isArray(parsed.tickets)){
        parsed.tickets.forEach(t=>{if(m[t.status])m[t.status].push(t);});
      } else {
        ['todo','inprogress','done'].forEach(s=>{if(Array.isArray(parsed[s]))m[s]=parsed[s];});
      }
      for(const s in m) m[s].sort((a,b)=>(a.order||0)-(b.order||0));
      state=m; saveLocal(); render();
    }
    const cf=await ghGet(CSV_PATH).catch(()=>null);
    if(cf&&cf.sha) shaCache[CSV_PATH]=cf.sha;
    setPill('ghPill','ghStatus','ok','github ok');
    setPill('syncPill','syncStatus','ok','synced');
  }catch(e){
    setPill('syncPill','syncStatus','err','load error');
    showToast('GitHub load failed: '+e.message,'err');
  }
}

async function saveToGitHub(){
  if(!isGHReady()||!isEditor) return;
  if(_saveRunning){_savePending=true;return;}
  _saveRunning=true;
  setPill('syncPill','syncStatus','warn','saving…');
  document.getElementById('savingInd').classList.add('show');
  try{
    await Promise.all([ghPut(JSON_PATH,buildJSON()),ghPut(CSV_PATH,buildCSV())]);
    lastSavedAt=new Date();
    setPill('syncPill','syncStatus','ok','synced');
    document.getElementById('stLast').textContent=lastSavedAt.toLocaleTimeString();
    showToast('Saved → tickets.json + tickets.csv','ok');
  }catch(e){
    setPill('syncPill','syncStatus','err','save failed');
    showToast('Save failed: '+e.message,'err');
  }finally{
    document.getElementById('savingInd').classList.remove('show');
    _saveRunning=false;
    if(_savePending){_savePending=false;saveToGitHub();}
  }
}

/* ── DATA BUILDERS ── */
function allTickets(){
  const a=[];
  ['todo','inprogress','done'].forEach(s=>(state[s]||[]).forEach((t,i)=>a.push({...t,status:s,order:i})));
  return a;
}
function buildJSON(){
  return JSON.stringify({updatedAt:new Date().toISOString(),tickets:allTickets()},null,2);
}
function buildCSV(){
  const f=['id','title','desc','status','priority','assignee','order','createdAt'];
  const e=v=>{if(v==null)return'';const s=String(v);return(s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`:s;};
  return[f.join(','),...allTickets().map(t=>f.map(k=>e(t[k])).join(','))].join('\n');
}
window.downloadFile=function(type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([type==='csv'?buildCSV():buildJSON()],{type:type==='csv'?'text/csv':'application/json'}));
  a.download='tickets.'+type;a.click();URL.revokeObjectURL(a.href);
};

/* ── LOCAL STORAGE ── */
const ls=k=>localStorage.getItem(k)||'';
const lsSet=(k,v)=>localStorage.setItem(k,v);
function loadLocal(){try{const s=JSON.parse(localStorage.getItem('kanbanState'));if(s)state=s;}catch(e){}}
function saveLocal(){lsSet('kanbanState',JSON.stringify(state));}
function persist(){saveLocal();clearTimeout(saveTimer);saveTimer=setTimeout(saveToGitHub,900);}

/* ── RENDER ── */
function render(){
  let total=0,done=0;
  ['todo','inprogress','done'].forEach(status=>{
    const container=document.getElementById('tickets-'+status);
    const tickets=state[status]||[];
    total+=tickets.length;if(status==='done')done=tickets.length;
    document.getElementById('count-'+status).textContent=tickets.length;
    document.getElementById('addbtn-'+status).disabled=!isEditor;
    container.innerHTML='';
    if(!tickets.length){
      const e=document.createElement('div');e.className='empty';
      e.innerHTML='<div style="font-size:18px;margin-bottom:5px;opacity:.28">&#9675;</div>No tickets here';
      container.appendChild(e);
    }
    tickets.forEach((ticket,index)=>{
      const card=document.createElement('div');
      card.className='card'+(isEditor?'':' readonly');
      card.draggable=isEditor;
      card.innerHTML=`
        <div class="card-top">
          <div class="card-title">${esc(ticket.title)}</div>
          ${isEditor?`<div class="card-acts">
            <button class="ca" onclick="openTicketModal('${status}','${ticket.id}')">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7.5 1.5l2 2-5.5 5.5H2v-2L7.5 1.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>
            </button>
            <button class="ca del" onclick="deleteTicket('${ticket.id}')">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 3h7M4.5 3V2h2v1M3.5 9h4l.5-5.5h-5L3.5 9z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>`:''}
        </div>
        ${ticket.desc?`<div class="card-desc">${esc(ticket.desc)}</div>`:''}
        <div class="card-foot">
          <div class="card-id">#${ticket.id.slice(-6)}${ticket.assignee?' · '+esc(ticket.assignee):''}</div>
          <div class="tag tag-${ticket.priority||'medium'}">${ticket.priority||'medium'}</div>
        </div>`;
      if(isEditor){
        card.addEventListener('dragstart',e=>{draggedId=ticket.id;e.dataTransfer.effectAllowed='move';setTimeout(()=>card.classList.add('dragging'),0);});
        card.addEventListener('dragend',()=>{draggedId=null;card.classList.remove('dragging');clearInds();document.querySelectorAll('.column').forEach(c=>c.classList.remove('drag-over'));dropTarget={status:null,index:null};});
      }
      container.appendChild(card);
    });
  });
  document.getElementById('boardSub').textContent=`${total} ticket${total!==1?'s':''} · ${done} done`;
  document.getElementById('viewBadge').className='view-badge '+(isEditor?'editor':'viewer');
  document.getElementById('viewBadge').textContent=isEditor?'editor':'viewer';
}

/* ── DRAG (board-level) ── */
function clearInds(){document.querySelectorAll('.drop-indicator').forEach(i=>i.remove());}

function setupDragBoard(){
  const board=document.querySelector('.board');
  if(!board)return;
  board.addEventListener('dragover',e=>{
    if(!draggedId)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    const col=e.target.closest('.column');
    if(!col)return;
    const status=col.dataset.status;
    document.querySelectorAll('.column').forEach(c=>c.classList.toggle('drag-over',c===col));
    clearInds();
    const cards=[...col.querySelectorAll('.card:not(.dragging)')];
    if(!cards.length){dropTarget={status,index:0};return;}
    let placed=false;
    for(let i=0;i<cards.length;i++){
      const rect=cards[i].getBoundingClientRect();
      if(e.clientY<rect.top+rect.height/2){
        const ind=document.createElement('div');ind.className='drop-indicator';
        cards[i].before(ind);
        dropTarget={status,index:i};
        placed=true;break;
      }
    }
    if(!placed){
      const ind=document.createElement('div');ind.className='drop-indicator';
      cards[cards.length-1].after(ind);
      dropTarget={status,index:cards.length};
    }
  });
  board.addEventListener('drop',e=>{
    e.preventDefault();
    if(!draggedId||!dropTarget.status)return;
    let moved;
    for(const s in state){const i=state[s].findIndex(t=>t.id===draggedId);if(i!==-1){[moved]=state[s].splice(i,1);break;}}
    if(!moved)return;
    moved.status=dropTarget.status;
    state[dropTarget.status].splice(dropTarget.index,0,moved);
    clearInds();
    document.querySelectorAll('.column').forEach(c=>c.classList.remove('drag-over'));
    render();persist();
  });
  board.addEventListener('dragleave',e=>{
    if(!board.contains(e.relatedTarget)){
      clearInds();
      document.querySelectorAll('.column').forEach(c=>c.classList.remove('drag-over'));
    }
  });
}

/* ── TICKET MODAL ── */
window.openTicketModal=function(status,id){
  if(!isEditor)return;
  modalStatus=status;editingId=id||null;
  const t=id?findTicket(id):null;
  document.getElementById('ticketModalTitle').textContent=id?'Edit Ticket':'New Ticket';
  document.getElementById('tTitle').value=t&&t.title||'';
  document.getElementById('tDesc').value=t&&t.desc||'';
  document.getElementById('tPriority').value=t&&t.priority||'medium';
  document.getElementById('tAssignee').value=t&&t.assignee||'';
  document.getElementById('ticketBackdrop').classList.add('open');
  setTimeout(()=>document.getElementById('tTitle').focus(),150);
};
window.closeTicketModal=()=>{document.getElementById('ticketBackdrop').classList.remove('open');editingId=null;};
window.saveTicket=function(){
  const title=document.getElementById('tTitle').value.trim();
  if(!title){document.getElementById('tTitle').focus();return;}
  const data={title,desc:document.getElementById('tDesc').value.trim(),priority:document.getElementById('tPriority').value,assignee:document.getElementById('tAssignee').value.trim()};
  if(editingId){Object.assign(findTicket(editingId),data);}
  else{state[modalStatus].push({id:crypto.randomUUID(),...data,status:modalStatus,order:state[modalStatus].length,createdAt:new Date().toISOString()});}
  closeTicketModal();render();persist();
  showToast(editingId?'Ticket updated':'Ticket created','ok');
  editingId=null;
};
window.deleteTicket=function(id){
  for(const s in state){const i=state[s].findIndex(t=>t.id===id);if(i!==-1){state[s].splice(i,1);break;}}
  render();persist();showToast('Ticket deleted','info');
};

/* ── SETTINGS ── */
window.openSettings=function(){
  document.getElementById('sToken').value=cfg.token;
  document.getElementById('sOwner').value=cfg.owner;
  document.getElementById('sRepo').value=cfg.repo;
  document.getElementById('sBranch').value=cfg.branch;
  document.getElementById('sPassword').value='';
  document.getElementById('stGH').textContent=isGHReady()?'yes':'no';
  document.getElementById('stGH').className='sval'+(isGHReady()?'':' bad');
  document.getElementById('stRole').textContent=isEditor?'editor':'viewer';
  document.getElementById('stRole').className='sval'+(isEditor?'':' bad');
  document.getElementById('stCount').textContent=allTickets().length;
  document.getElementById('stLast').textContent=lastSavedAt?lastSavedAt.toLocaleTimeString():'never';
  document.getElementById('settingsBackdrop').classList.add('open');
};
window.closeSettings=()=>document.getElementById('settingsBackdrop').classList.remove('open');
window.saveSettings=async function(){
  const vals={token:document.getElementById('sToken').value.trim(),owner:document.getElementById('sOwner').value.trim(),repo:document.getElementById('sRepo').value.trim(),branch:document.getElementById('sBranch').value.trim()||'main'};
  for(const k in vals)if(vals[k]){cfg[k]=vals[k];lsSet('gh_'+k,vals[k]);}
  const pw=document.getElementById('sPassword').value;
  if(pw){cfg.password=pw;lsSet('board_pw',pw);}
  closeSettings();
  setPill('ghPill','ghStatus',isGHReady()?'ok':'warn',isGHReady()?'github ok':'not configured');
  if(isGHReady()){await loadFromGitHub();showToast('Settings saved — syncing from GitHub…','info');}
  else showToast('Settings saved (GitHub not fully configured)','info');
};

/* ── HELPERS ── */
function setPill(pid,sid,type,text){
  document.getElementById(pid).className='hpill '+(type==='ok'?'ok':type==='warn'?'warn':'err');
  document.getElementById(sid).textContent=text;
}
const findTicket=id=>{for(const s in state){const t=state[s].find(t=>t.id===id);if(t)return t;}};
const esc=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function backdropClose(id,fn,e){if(e.target===document.getElementById(id))fn();}
window.backdropClose=backdropClose;

let toastTimer;
function showToast(msg,type){
  const el=document.getElementById('toast');
  document.getElementById('toastMsg').textContent=msg;
  el.className=`toast ${type||'info'} show`;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),3000);
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeTicketModal();closeSettings();}
  if(e.key==='Enter'&&document.getElementById('ticketBackdrop').classList.contains('open')&&document.activeElement.tagName!=='TEXTAREA'){
    e.preventDefault();saveTicket();
  }
});

/* ── START ── */
init();
setupDragBoard();

})();
