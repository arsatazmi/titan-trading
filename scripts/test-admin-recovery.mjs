// Isolated local mock. No production, no broker, no user credentials.
import {spawn} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {once} from 'node:events';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'titan-recovery-'));const port=3487;const base=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),HOST:'127.0.0.1',TITAN_DATA_DIR:dir,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',VERCEL:''};let proc;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const assert=(b,msg)=>{if(!b)throw Error(msg);console.log('PASS',msg)};
async function req(url,body,token,csrf){let r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`,'X-CSRF-Token':csrf}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
async function start(){proc=spawn('node',['server.mjs'],{env,stdio:'ignore'});for(let i=0;i<50;i++){try{await fetch(base+'/api/health');return}catch{await sleep(100)}}throw Error('server failed')}
async function stop(){proc.kill();await once(proc,'exit')}
try{
 await start();const initial=await req('/api/auth/login',{email:'admin@titantrading.demo',password:'TitanAdmin!2026'});assert(initial.status===200,'seed admin login in isolated test');
 const token=initial.data.sessionToken,csrf=initial.data.csrfToken;
 const creds={deviceId:crypto.randomBytes(16).toString('hex'),secret:crypto.randomBytes(32).toString('hex')};
 assert((await req('/api/pilot/register',creds,token,csrf)).status===200,'existing mock pairing');
 const hb=await req('/api/pilot/heartbeat',{...creds,status:{protocol:4,connected:true,demo:true,ready:true,enabled:true,state:'stopped',quoteOkBtc:true}});assert(!hb.data.run,'pilot disabled during transition');
 assert((await req('/api/admin/reset-demo',{},token,csrf)).status===403,'unsafe demo reset disabled');
 await stop();const f=path.join(dir,'db.json'),db=JSON.parse(fs.readFileSync(f));
 const code=crypto.randomBytes(32).toString('hex');db.adminRecovery={userId:initial.data.user.id,codeHash:crypto.createHash('sha256').update(code).digest('hex'),expiresAt:new Date(Date.now()-1000).toISOString()};fs.writeFileSync(f,JSON.stringify(db));
 await start();assert((await req('/api/auth/recover-admin',{code,password:'LongUniquePassphrase!123'})).status===400,'expired code rejected');
 assert((await req('/api/auth/login',{email:'admin@titantrading.demo',password:'TitanAdmin!2026'})).status===403,'expired code does not unlock old password');
 await stop();const d2=JSON.parse(fs.readFileSync(f));d2.adminRecovery.expiresAt=new Date(Date.now()+120000).toISOString();fs.writeFileSync(f,JSON.stringify(d2));
 await start();
 assert((await req('/api/admin/reset-demo',{},token,csrf)).status===401,'pending recovery blocks existing admin session');
 assert((await req('/api/auth/login',{email:'admin@titantrading.demo',password:'TitanAdmin!2026'})).status===403,'old admin login locked during recovery');
 assert((await req('/api/auth/recover-admin',{code:'f'.repeat(64),password:'LongUniquePassphrase!123'})).status===400,'wrong code rejected');
 assert((await req('/api/auth/recover-admin',{code,password:'short'})).status===400,'short new password rejected');
 assert((await req('/api/auth/recover-admin',{code,password:'LongUniquePassphrase!123'})).status===200,'recovery success');
 assert((await req('/api/auth/recover-admin',{code,password:'LongUniquePassphrase!123'})).status===400,'recovery cannot be replayed');
 assert((await req('/api/auth/login',{email:'admin@titantrading.demo',password:'TitanAdmin!2026'})).status===401,'old password invalid');
 assert((await req('/api/auth/login',{email:'admin@titantrading.demo',password:'LongUniquePassphrase!123'})).status===200,'new admin password works');
 assert((await req('/api/pilot/heartbeat',{...creds,status:{}})).status===403,'old device secret revoked');
}finally{if(proc&&proc.exitCode===null)await stop();fs.rmSync(dir,{recursive:true,force:true});}
