// Local isolated mock server; no broker or production calls.
import {spawn} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'titan-protocol-'));const port=3478;
const proc=spawn('node',['server.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TITAN_DATA_DIR:dir,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',VERCEL:''},stdio:'ignore'});
const base=`http://127.0.0.1:${port}`, sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(condition,msg)=>{if(!condition)throw Error(msg);console.log('PASS',msg)};
async function req(url,body,token,csrf){const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`,'X-CSRF-Token':csrf}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
try {
  let up=false;for(let i=0;i<40;i++){try{await fetch(base+'/api/health');up=true;break}catch{await sleep(100)}} if(!up)throw Error('server not ready');
  const login=await req('/api/auth/login',{email:'admin@titantrading.demo',password:'TitanAdmin!2026'});
  check(login.status===200,'local admin login');const token=login.data.sessionToken,csrf=login.data.csrfToken;
  const creds={deviceId:crypto.randomBytes(16).toString('hex'),secret:crypto.randomBytes(32).toString('hex')};
  check((await req('/api/pilot/register',creds,token,csrf)).status===200,'pair mock device');
  const hb=(protocol,boot=false)=>req('/api/pilot/heartbeat',{...creds,boot,status:{protocol,connected:true,demo:true,ready:true,enabled:true,state:'stopped',quoteOkBtc:true,quoteOkXau:true}});
  const ctrl=(action,symbol)=>req('/api/pilot/control',{...creds,action,symbol},token,csrf);
  await hb(3);check((await ctrl('start','#BTCUSD')).status===400,'v3 BTC rejected');
  check((await ctrl('start','XAUUSD')).status===200,'v3 gold still allowed');
  await ctrl('stop','XAUUSD');await hb(4,true);check((await ctrl('start','#BTCUSD')).status===200,'v4 BTC accepted');
  check((await hb(4)).data.run===true,'v4 BTC lease active');
  check((await hb(3)).data.run===false,'downgrade BTC revokes lease');
  check((await ctrl('renew','#BTCUSD')).status===400,'revoked lease cannot renew');
} finally {proc.kill();fs.rmSync(dir,{recursive:true,force:true});}
