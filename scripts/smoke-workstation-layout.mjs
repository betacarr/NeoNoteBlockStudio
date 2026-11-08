import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=path.resolve('.local/workstation-layout'); await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'run-'));
const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.NBSX_DEV_URL;
const app=await electron.launch({args:['.', '--mute-audio',`--user-data-dir=${path.join(root,'profile')}`],env});
const errors=[], checks=[];
try {
 const page=await app.firstWindow(); page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.piano-viewport canvas').waitFor();
 const initialTitle=await page.title();
 const choose=async label=>page.getByRole('group',{name:'编辑工作区布局'}).getByRole('button',{name:label,exact:true}).click();
 for(let i=0;i<3;i++) {
  await choose('编曲'); assert.equal(await page.locator('.piano-panel').isVisible(),false); assert.equal(await page.locator('.arrangement-panel').isVisible(),true);
  assert.equal(await page.locator('.arrangement-panel').getAttribute('data-active'),'true');
  await choose('钢琴卷帘'); assert.equal(await page.locator('.arrangement-panel').isVisible(),false); assert.equal(await page.locator('.piano-panel').getAttribute('data-active'),'true');
  await choose('分屏'); assert.equal(await page.locator('.editor-splitter').isVisible(),true);
 }
 assert.equal(await page.title(),initialTitle); checks.push('view switching retains document and routes editor focus');
 const sidebar=await page.locator('.inspector').boundingBox(), center=await page.locator('.center-workspace').boundingBox();
 assert(sidebar.x+sidebar.width<=center.x+1); checks.push('inspector precedes timeline');
 for(const [width,height] of [[1440,900],[1100,760]]) {
  await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
  await page.waitForFunction(w=>window.innerWidth===w,width);
  const bar=await page.locator('.control-bar').boundingBox(), out=await page.locator('.export-button').boundingBox();
  assert(out.x+out.width<=bar.x+bar.width+1,'Export remains in viewport');
  for(const mode of ['编曲','钢琴卷帘','分屏']) {await choose(mode); await page.screenshot({path:path.join(root,`${width}-${mode}.png`)});}
  checks.push(`viewport ${width}x${height}`);
 }
 for(const label of ['显示音色库','显示检查器']) { await page.getByRole('button',{name:label,exact:true}).click(); }
 await page.screenshot({path:path.join(root,'focused-editor.png')});
 for(const label of ['显示音色库','显示检查器']) { await page.getByRole('button',{name:label,exact:true}).click(); }
 await page.getByRole('button',{name:'混音器',exact:true}).click();
 await page.locator('.mixer-console').waitFor(); checks.push('sidebars and mixer remain available');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(root,'report.json'),JSON.stringify({status:'passed',checks,errors,root},null,2));
 console.log(JSON.stringify({status:'passed',checks,root}));
} finally {await app.close();}
