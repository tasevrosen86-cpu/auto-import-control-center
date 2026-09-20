// One-time login verifier for the self-hosted Publications Chrome profile.
// Chrome itself is started by aicc-publications-browser.service and keeps the
// profile on disk. This script never receives or stores Mobile.bg credentials.

import { openSession, describeTransport } from './session.mjs';
import { FORM_URL, ensureLoggedIn, inspectForm } from './form.mjs';

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const session=await openSession();
console.log('Транспорт:',JSON.stringify(describeTransport()));
if(session.transport==='self-hosted-cdp'){
  console.log('Chrome е постоянният VPS профил. Отвори го през защитения VNC тунел и влез ръчно в Mobile.bg.');
}
let signedIn=false;
try{
  await session.page.goto(FORM_URL,{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>undefined);
  const deadline=Date.now()+8*60*1000;
  for(let attempt=1;Date.now()<deadline;attempt+=1){
    const login=await ensureLoggedIn(session);
    if(login.state==='already_logged_in'){signedIn=true;break;}
    if(attempt===1||attempt%6===0)console.log('чакам вход…',login.state);
    if(attempt%12===0)await session.page.reload({waitUntil:'domcontentloaded'}).catch(()=>undefined);
    await sleep(5000);
  }
  const form=await inspectForm(session);
  console.log(JSON.stringify({signed_in:signedIn,form}));
}finally{await session.close().catch(()=>undefined);}
process.exit(signedIn?0:1);
