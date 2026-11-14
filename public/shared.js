const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtIDR = (n) => 'Rp ' + Number(n||0).toLocaleString('id-ID');
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('id-ID', {dateStyle:'medium', timeStyle:'short'}) : '-';
const fmtNum = (n) => Number(n||0).toLocaleString('id-ID', {maximumFractionDigits:2});

let csrfToken = sessionStorage.getItem('tt_csrf') || '';
function setCsrf(t){ csrfToken = t || ''; if(t) sessionStorage.setItem('tt_csrf', t); else sessionStorage.removeItem('tt_csrf'); }
function toast(msg, isErr=false){
  let box = $('.toast'); if(!box){ box=document.createElement('div'); box.className='toast'; document.body.appendChild(box); }
  const el=document.createElement('div'); if(isErr) el.className='err'; el.textContent=msg; box.appendChild(el);
  setTimeout(()=>el.remove(), 5200);
}
async function api(path, opts={}){
  const headers = {'Content-Type':'application/json', ...(opts.headers||{})};
  if(opts.method && !['GET','HEAD'].includes(opts.method) && csrfToken) headers['X-CSRF-Token']=csrfToken;
  const res = await fetch(path, { credentials:'include', ...opts, headers });
  let data; try{ data = await res.json(); }catch{ data = {ok:false, error:'Respons server tidak valid.'}; }
  if(data.csrfToken) setCsrf(data.csrfToken);
  if(!res.ok || data.ok===false) throw new Error(data.error || 'Permintaan gagal.');
  return data;
}
async function me(){ try{ const d=await api('/api/me'); return d.user; }catch{ return null; } }
async function logout(){
  try{ await api('/api/auth/logout', {method:'POST', body:'{}'}); }catch{}
  setCsrf(''); location.href='/';
}
function statusPill(s){
  const map={active:['green','Aktif'],pending:['gold','Menunggu'],approved:['green','Disetujui'],rejected:['red','Ditolak'],expired:['red','Kedaluwarsa'],inactive:['red','Nonaktif'],suspended:['red','Ditangguhkan'],running:['green','Berjalan'],stopped:['blue','Berhenti']};
  const [cls,label]=map[s]||['blue',s||'-']; return `<span class="pill ${cls}">${label}</span>`;
}
function methodLabel(id, methods=[]){
  const m=(methods||[]).find(x=>x.id===id); return m?m.label:id;
}
