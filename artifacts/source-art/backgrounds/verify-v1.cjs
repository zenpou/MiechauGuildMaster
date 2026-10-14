const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(path.resolve(root, '../GuildQuest/node_modules/playwright'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest-v1.json'), 'utf8'));
const out = path.join(root, 'artifacts/backgrounds-review-v1');
fs.mkdirSync(out, {recursive:true});
(async()=>{
 const browser = await chromium.launch({channel:'chrome',headless:true});
 const evidence=[];
 try {
  for(const [name,width,height] of [['desktop',1280,900],['mobile',375,812]]){
   const page = await browser.newPage({viewport:{width,height}});
   const errors=[]; page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:4194/artifacts/source-art/backgrounds/index.html');
   await page.locator('figure img').first().waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('figure img')].every(i=>i.complete&&i.naturalWidth===1536));
   await page.screenshot({path:path.join(out,`gallery-${name}.png`),fullPage:true});
   await page.locator('#play').click();
   for(let i=0;i<manifest.assets.length;i++){
    const asset=manifest.assets[i];
    await page.waitForFunction(runtime=>{const im=document.querySelector('.vn-player-background');return im?.src.endsWith(runtime)&&im.complete&&im.naturalWidth===1536&&!im.hidden;},asset.runtime);
    await page.waitForTimeout(900);
    await page.screenshot({path:path.join(out,`${asset.id}-${name}.png`)});
    evidence.push({viewport:name,id:asset.id,loaded:true});
    if(i<manifest.assets.length-1){
     for(let attempt=0;attempt<3;attempt++){
      if(!(await page.locator('.vn-player-background').getAttribute('src')).endsWith(asset.runtime))break;
      await page.locator('[data-story-next]').click();
      await page.waitForTimeout(150);
     }
    }
   }
   assert.deepEqual(errors,[]);
   await page.goto('http://127.0.0.1:4194/');
   await page.waitForFunction(()=>{const im=document.querySelector('.vn-player-background');return im?.complete&&im.naturalWidth===1536&&!im.hidden;});
   await page.waitForTimeout(1200);
   await page.screenshot({path:path.join(out,`game-prologue-${name}.png`)});
   await page.close();
  }
 } finally {await browser.close();}
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({date:'2026-10-13',evidence,productionPrologue:['desktop','mobile'],screenshots:out},null,2));
 console.log(JSON.stringify({passed:evidence.length,productionPrologue:2,screenshots:out}));
})().catch(e=>{console.error(e);process.exitCode=1});

