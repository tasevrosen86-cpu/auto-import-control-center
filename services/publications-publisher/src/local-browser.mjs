// Permanent visible Chrome used only by the Publications publisher.
// It keeps cookies under PUBLICATIONS_CHROME_USER_DATA_DIR. It receives no
// Mobile.bg username/password and listens for CDP only on localhost.

import { chromium } from 'playwright';

const dir=process.env.PUBLICATIONS_CHROME_USER_DATA_DIR||'/home/ubuntu/.local/share/aicc-publications-chrome';
const context=await chromium.launchPersistentContext(dir,{
  headless:false,
  args:['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--disable-dev-shm-usage','--no-first-run'],
});
await (context.pages()[0]||context.newPage());
console.log('Publications Chrome is ready on local CDP port 9222.');
const close=async()=>{await context.close().catch(()=>undefined);process.exit(0);};
process.once('SIGTERM',close);process.once('SIGINT',close);
await new Promise(()=>{});
