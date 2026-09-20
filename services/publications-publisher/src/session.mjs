// Browser transport for the isolated Publications publisher.
// Default: a self-hosted Chrome connection. Browser Use is an explicit fallback,
// never an implicit paid dependency.

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowser, stopBrowser, browserUseApiConfigured, profileName } from './browser_use.mjs';

const mode=()=>process.env.PUBLICATIONS_BROWSER_MODE||'cdp';
const cdpUrl=()=>process.env.PUBLICATIONS_CDP_URL||'';
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export function describeTransport(){
  if(mode()==='browser_use') return {transport:'browser-use-remote',profile:profileName()};
  if(cdpUrl()) return {transport:'self-hosted-cdp',cdp_url:'configured'};
  return {transport:'self-hosted-persistent',headless:process.env.PUBLICATIONS_HEADLESS==='true'};
}

export async function downloadImages(urls,limit=17){
  const dir=await mkdtemp(join(tmpdir(),'publication-images-'));
  const paths=[];
  for(let i=0;i<Math.min(urls.length,limit);i+=1){
    const response=await fetch(urls[i]);
    if(!response.ok){if(response.status===404)continue;throw new Error('image_http_'+response.status);}
    const path=join(dir,String(i+1).padStart(2,'0')+'.jpg');
    await writeFile(path,Buffer.from(await response.arrayBuffer()));
    paths.push(path);
  }
  return paths;
}
async function bind(browser,context,page,close){
  const cdp=await context.newCDPSession(page);
  return {transport:describeTransport().transport,page,send:(method,params)=>cdp.send(method,params),stageImages:urls=>downloadImages(urls||[]),close};
}
async function selfHostedSession(){
  const {chromium}=await import('playwright');
  if(cdpUrl()){
    const browser=await chromium.connectOverCDP(cdpUrl());
    const context=browser.contexts()[0]||await browser.newContext();
    const page=context.pages()[0]||await context.newPage();
    return bind(browser,context,page,()=>browser.close());
  }
  const userDataDir=process.env.PUBLICATIONS_CHROME_USER_DATA_DIR||'/home/ubuntu/.local/share/aicc-publications-chrome';
  const context=await chromium.launchPersistentContext(userDataDir,{
    headless:process.env.PUBLICATIONS_HEADLESS==='true',
    executablePath:process.env.PUBLICATIONS_CHROME_EXECUTABLE_PATH||undefined,
    args:['--disable-dev-shm-usage'],
  });
  const page=context.pages()[0]||await context.newPage();
  return bind(null,context,page,()=>context.close());
}
async function browserUseSession(){
  if(!browserUseApiConfigured()) throw new Error('Browser Use fallback е избран, но BROWSER_USE_API_KEY липсва.');
  const {chromium}=await import('playwright');
  const created=await createBrowser();
  let browser;
  try{browser=await chromium.connectOverCDP(created.cdpUrl);}catch(error){await stopBrowser(created.id).catch(()=>undefined);throw error;}
  const context=browser.contexts()[0]||await browser.newContext();
  const page=context.pages()[0]||await context.newPage();
  const session=await bind(browser,context,page,async()=>{await browser.close().catch(()=>undefined);if(process.env.BROWSER_USE_KEEP_BROWSER!=='true')await stopBrowser(created.id).catch(()=>undefined);});
  return {...session,browserId:created.id,liveUrl:created.liveUrl,transport:'browser-use-remote'};
}
export async function openSession(){
  if(mode()==='browser_use') return browserUseSession();
  return selfHostedSession();
}
export { sleep };
