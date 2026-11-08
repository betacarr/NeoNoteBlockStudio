import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Real application, isolated profile and hidden window. Optical fixtures contain
// only generated application DOM; no desktop/user window capture or model calls.
const base = path.resolve('.local/liquid-glass-qa'); await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'run-')), profile=path.join(root,'profile'); await mkdir(profile);
const packaged=process.argv.indexOf('--packaged');
if(packaged>=0&&!process.argv[packaged+1])throw new Error('--packaged requires the app executable.');
const executablePath=packaged>=0?path.resolve(process.argv[packaged+1]):undefined;
const imagePython=process.env.NEONBS_QA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const env={...process.env,NBSX_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.NBSX_DEV_URL;
const launch=()=>electron.launch({executablePath,args:[...(executablePath?[]:['.']),'--mute-audio',`--user-data-dir=${profile}`],env,timeout:120000});
const report={status:'running',root,profile,cases:[],errors:[],screenshots:[]};let desktop;
const pass=(name,evidence={})=>{report.cases.push({name,status:'passed',...evidence});console.log('PASS',name);};
try{
  desktop=await launch();
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
  const page=await desktop.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
  assert.equal(await desktop.evaluate(({app})=>app.getPath('userData')),profile);
  await page.waitForFunction(()=>document.querySelectorAll('.sample-dot.loaded').length>=16);
  report.renderer=await page.locator('script[type=module]').getAttribute('src');
  report.runtime=await desktop.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform}));
  const shot=async name=>{const file=path.join(root,`${name}.png`);await page.screenshot({path:file});report.screenshots.push(file);return file;};
  const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const settings=async()=>{await page.getByRole('menuitem',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观',exact:true}).click();};
  const mode=async value=>page.waitForFunction(value=>document.querySelector('.studio').dataset.glassMode===value,value);
  const musical=()=>page.evaluate(()=>['.piano-viewport canvas','.piano-viewport','.toolbar','.library','.inspector'].map(sel=>{const s=getComputedStyle(document.querySelector(sel));return{sel,filter:s.filter,backdrop:s.backdropFilter,background:s.background};}));
  assert.equal(await page.locator('.studio').getAttribute('data-appearance'),'classic');assert.equal(await page.locator('.liquid-glass-backdrop').count(),0);
  const original=await musical();await shot('classic');pass('Classic default has zero optical layers');
  // Count only the optical maps, not the musical rendering canvas.
  await page.evaluate(()=>{window.__glassQa={encodes:0};const old=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...a){window.__glassQa.encodes++;return old.apply(this,a);};});
  await settings();await page.getByRole('radio',{name:'Liquid Glass · 跨平台'}).check();await mode('refracted');
  await page.waitForFunction(()=>[...document.querySelectorAll('feImage')].some(e=>e.getAttribute('href')?.startsWith('data:image/png')));
  assert.deepEqual(await musical(),original);await page.locator('.control-bar .liquid-glass-backdrop').waitFor({ state: 'attached' });
  await shot('settings');
  for(let i=0;i<10;i++){await page.keyboard.press(i%2?'Tab':'Shift+Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')));}
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);pass('Explicit opt-in; glass control bar and unchanged musical canvas; modal Tab and Escape');
  // Existing menu keyboard navigation and command targets are unchanged.
  await page.getByRole('menuitem',{name:'文件',exact:true}).click();await page.waitForSelector('.menu-items .liquid-glass-backdrop');await frames();await shot('menu');
  await page.keyboard.press('ArrowDown');assert(await page.evaluate(()=>!!document.activeElement.closest('[role=menu]')));await page.keyboard.press('Escape');
  await page.locator('[data-glass-tooltip]').first().hover();await page.getByRole('tooltip').waitFor();await page.waitForSelector('.glass-tooltip .liquid-glass-backdrop');
  assert.equal(await page.getByRole('tooltip').evaluate(e=>getComputedStyle(e).pointerEvents),'none');await shot('tooltip');await page.mouse.move(800,500);await page.getByRole('tooltip').waitFor({state:'detached'});
  pass('Menus and noninteractive tooltips use the shared live optical layer');
  await settings();await page.getByRole('button',{name:'操作与快捷键',exact:true}).click();await page.getByLabel('快捷键基础预设').selectOption('logic');await page.getByRole('button',{name:'应用快捷键',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.locator('.piano-viewport canvas').focus();await page.keyboard.press('Shift+F10');await page.waitForSelector('[data-glass-surface=menu] .liquid-glass-backdrop');await shot('piano-context-menu');await page.keyboard.press('Escape');
  assert(await page.locator('.piano-viewport canvas').evaluate(e=>e===document.activeElement));pass('Logic context menu retains keyboard target and restores piano focus');
  // Known in-app striped content proves actual backdrop sampling and distortion.
  await page.evaluate(()=>{const fixture=document.createElement('div');fixture.id='glass-optical-fixture';fixture.style.cssText='position:fixed;left:350px;top:230px;width:280px;height:200px;z-index:8000;background:repeating-linear-gradient(90deg,#ff7777 0 7px,#112233 7px 14px)';const surface=document.createElement('div');surface.dataset.glassSurface='menu';surface.id='glass-optical-test';surface.style.cssText='position:absolute;left:20px;top:20px;width:240px;height:160px';fixture.append(surface);document.querySelector('.studio').append(fixture);});
  await page.waitForSelector('#glass-optical-test .liquid-glass-backdrop');await frames();
  const layer=page.locator('#glass-optical-test .liquid-glass-backdrop');const optical=page.locator('#glass-optical-test');
  const mapsBeforeHover=await page.evaluate(()=>window.__glassQa.encodes);
  await optical.hover();await page.waitForSelector('#glass-optical-test [data-glass-shine]');
  await page.mouse.move(800,500);await page.waitForSelector('#glass-optical-test [data-glass-shine]',{state:'detached'});
  assert.equal(await page.evaluate(()=>window.__glassQa.encodes),mapsBeforeHover);
  pass('Pointer highlight follows the glass surface without regenerating optical maps');
  const filter=await layer.evaluate(e=>e.style.backdropFilter);assert.match(filter,/url/);
  await layer.evaluate((e,filter)=>{e.style.backdropFilter=filter.split(' blur')[0];},filter);await frames();
  const refracted=path.join(root,'optical-refracted.png');await optical.screenshot({path:refracted});
  const filterId=filter.match(/#([\w-]+)/)[1];
  const scales=await page.locator(`#${filterId} feDisplacementMap`).evaluateAll(nodes=>{
    const scales=nodes.map(node=>node.getAttribute('scale'));
    nodes.forEach(node=>node.setAttribute('scale',scales[1]));
    return scales;
  });
  assert.equal(new Set(scales).size,3);
  await frames();const aligned=path.join(root,'optical-aligned-rgb.png');await optical.screenshot({path:aligned});
  await page.locator(`#${filterId} feDisplacementMap`).evaluateAll((nodes,scales)=>nodes.forEach((node,i)=>node.setAttribute('scale',scales[i])),scales);
  await layer.evaluate(e=>e.style.backdropFilter='none');await frames();const plain=path.join(root,'optical-plain.png');await optical.screenshot({path:plain});
  await layer.evaluate((e,filter)=>e.style.backdropFilter=filter,filter);await page.locator('#glass-optical-fixture').evaluate(e=>e.style.background='repeating-linear-gradient(90deg,#77aaff 0 7px,#112233 7px 14px)');await frames();const live=path.join(root,'optical-live-blue.png');await optical.screenshot({path:live});
  const pixels=JSON.parse(execFileSync(imagePython,['-c',`from PIL import Image,ImageChops\nimport json,sys\na,b,c,rgb=[Image.open(p).convert('RGB') for p in sys.argv[1:]]\nd=ImageChops.difference(a,b);w,h=a.size\nedge=center=0\nfor y in range(h):\n for x in range(w):\n  if max(d.getpixel((x,y)))>18:\n   if min(x,y,w-1-x,h-1-y)<32:edge+=1\n   else:center+=1\nprint(json.dumps({'edgePixelsChanged':edge,'centerPixelsChanged':center,'liveBackgroundChanged':ImageChops.difference(a,c).getbbox() is not None,'colorSeparationVisible':ImageChops.difference(a,rgb).getbbox() is not None}))`,refracted,plain,live,aligned],{encoding:'utf8',windowsHide:true}));
  assert(pixels.edgePixelsChanged>100,'SVG filter must visibly displace real edge pixels');assert(pixels.centerPixelsChanged<pixels.edgePixelsChanged*.15,'Flat center must stay substantially unwarped');assert(pixels.liveBackgroundChanged);
  assert(pixels.colorSeparationVisible,'Per-channel displacement must visibly change the rendered pixels');
  report.optical=pixels;await page.locator('#glass-optical-fixture').evaluate(e=>e.remove());pass('Real DOM background sampling and actual edge refraction, with an unwarped center',pixels);
  await page.mouse.move(800,500);await frames();
  const before=await page.evaluate(()=>window.__glassQa.encodes);await page.locator('.play-button').click();await page.mouse.move(800,500);await frames();
  const steadyBefore=await page.evaluate(()=>window.__glassQa.encodes);
  const timing=await page.evaluate(()=>new Promise(resolve=>{let last=performance.now();const deltas=[];const tick=now=>{deltas.push(now-last);last=now;if(deltas.length<120)requestAnimationFrame(tick);else resolve(deltas.sort((a,b)=>a-b));};requestAnimationFrame(tick);}));
  assert(await page.locator('.play-button').evaluate(e=>e.classList.contains('is-playing')));
  assert.equal(await page.evaluate(()=>window.__glassQa.encodes),steadyBefore,'Steady playback cannot regenerate optical maps');
  await page.locator('.play-button').click();report.frameTiming={median:timing[60],p95:timing[114],startupMaps:steadyBefore-before,mapsDuringPlayback:0};pass('Playback remains active with no per-frame optical map work',report.frameTiming);
  await settings();await page.getByLabel('玻璃渲染',{exact:true}).selectOption('solid');await mode('solid');assert.equal(await page.locator('.liquid-glass-backdrop').count(),0);await shot('solid-fallback');
  await page.getByLabel('玻璃渲染',{exact:true}).selectOption('auto');await mode('refracted');
  await page.emulateMedia({reducedMotion:'reduce'});await mode('solid');assert.equal(await page.locator('.liquid-glass-backdrop').count(),0);await page.emulateMedia({reducedMotion:'no-preference'});await mode('refracted');
  await page.emulateMedia({forcedColors:'active'});await mode('solid');await shot('high-contrast');await page.emulateMedia({forcedColors:'none'});await mode('refracted');
  // Simulate reduced-transparency via CDP, which Playwright does not expose directly.
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});await mode('solid');await cdp.send('Emulation.setEmulatedMedia',{features:[]});await mode('refracted');await cdp.detach();
  pass('Manual solid, reduced motion, reduced transparency and forced-colors fallbacks');
  await page.evaluate(()=>{window.__glassSupports=CSS.supports.bind(CSS);CSS.supports=(...args)=>args.join(' ').includes('backdrop-filter')?false:window.__glassSupports(...args);});
  await page.getByLabel('玻璃渲染',{exact:true}).selectOption('solid');await page.getByLabel('玻璃渲染',{exact:true}).selectOption('auto');await mode('solid');assert.equal(await page.locator('.liquid-glass-backdrop').count(),0);
  await page.evaluate(()=>{CSS.supports=window.__glassSupports;delete window.__glassSupports;});await page.getByLabel('玻璃渲染',{exact:true}).selectOption('solid');await page.getByLabel('玻璃渲染',{exact:true}).selectOption('auto');await mode('refracted');
  pass('Unsupported background filter capability uses a solid surface');
  await page.getByRole('button',{name:'关闭',exact:true}).click();await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1050,720));await settings();await shot('minimum-window');
  const bounds=await page.getByRole('radio',{name:'Liquid Glass · 跨平台'}).boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<1050&&bounds.y+bounds.height<720);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));await page.getByRole('menuitem',{name:'文件',exact:true}).click();await frames();await shot('zoom-125');
  const menu=await page.locator('.menu-items').boundingBox();const viewport=page.viewportSize()??await page.evaluate(()=>({width:innerWidth,height:innerHeight}));assert(menu.x+menu.width<=viewport.width+1);await page.keyboard.press('Escape');await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  pass('Minimum desktop window and 125% zoom preserve reachable controls');
  await settings();await page.getByRole('radio',{name:'经典',exact:true}).check();await page.waitForFunction(()=>!document.querySelector('.liquid-glass-backdrop')&&!document.querySelector('.liquid-glass-definitions'));await page.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual(await musical(),original);
  await page.locator('[data-glass-tooltip]').first().hover();assert(await page.locator('[data-glass-tooltip]').first().getAttribute('title'));pass('Disable cleans layers and restores native titles without changing musical pixels');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('nbsx-preferences')).appearance),'classic');
  await settings();await page.getByRole('radio',{name:'Liquid Glass · 跨平台'}).check();await page.getByLabel('玻璃渲染',{exact:true}).selectOption('solid');await mode('solid');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await desktop.close();
  desktop=await launch();await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));
  const restored=await desktop.firstWindow();await restored.waitForFunction(()=>document.querySelector('.studio')?.dataset.glassMode==='solid');assert.equal(await restored.locator('.studio').getAttribute('data-appearance'),'liquid-glass');assert.equal(await restored.locator('.liquid-glass-backdrop').count(),0);
  assert.equal(await restored.evaluate(()=>JSON.parse(localStorage.getItem('nbsx-preferences')).glassQuality),'solid');pass('Real application restart restores opt-in and the low-performance choice');
  assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.error=error.stack??String(error);console.error(report.error);process.exitCode=1;}
finally{await desktop?.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await desktop?.close().catch(()=>{});await writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(path.join(root,'report.json'));}
