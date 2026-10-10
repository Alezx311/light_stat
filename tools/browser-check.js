'use strict';
// Dependency-free Chrome DevTools smoke test. Uses a separate headless profile.
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  await fs.mkdir(path.join(root,'.cache'),{recursive:true});
  const profile=await fs.mkdtemp(path.join(root,'.cache','browser-'));
  const candidates=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'];
  let executable;
  for(const candidate of candidates.filter(Boolean)){try{await fs.access(candidate);executable=candidate;break;}catch{}}
  if(!executable)throw new Error('Set CHROME_PATH to a Chrome/Chromium executable.');
  const built=spawnSync(process.execPath,[path.join(root,'tools/build-site.js')],{cwd:root,encoding:'utf8'});
  if(built.status!==0)throw new Error('Site build failed: '+built.stderr);
  const site=path.join(root,'_site');
  const server=spawn(process.execPath,[path.join(root,'tools/serve.js'),'_site'],{cwd:root,windowsHide:true,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let serverOutput='';server.stdout.on('data',chunk=>serverOutput+=chunk);
  let serverURL;
  for(let i=0;i<100;i++){serverURL=serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(serverURL)break;await wait(100);}
  if(!serverURL){server.kill();throw new Error('Preview server did not start');}
  const flags=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'];
  // The isolated local QA profile needs this on restricted Windows runners.
  if(process.platform==='win32'||process.env.CHROME_NO_SANDBOX==='1')flags.unshift('--no-sandbox','--disable-gpu-sandbox');
  const chrome=spawn(executable,flags,{windowsHide:true,stdio:'ignore'});
  process.on('exit',()=>{server.kill();chrome.kill();});
  for(let i=0;i<100;i++){try{await fs.access(path.join(profile,'DevToolsActivePort'));break;}catch{}await wait(100);}
  const output=path.join(root,'.cache','qa');await fs.mkdir(output,{recursive:true});
  const portFile=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');
  const port=Number(portFile.split('\n')[0]);
  const target=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let sequence=0;const pending=new Map(),errors=[];
  ws.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.reject(new Error(message.error.message));else p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);};
  function send(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
  async function ready(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(100);}throw new Error('Timed out: '+expression);}
  async function screenshot(name){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,name+'.png'),Buffer.from(shot.data,'base64'));}
  const engine=require('../lib/electricity');
  const eventsPath=path.join(root,'data','events.json');
  const expectedPoints=engine.importData(JSON.parse(await fs.readFile(eventsPath,'utf8'))).points.length;
  const addresses=JSON.parse(await fs.readFile(path.join(root,'data','addresses.json'),'utf8')).addresses;
  try{
    await send('Page.enable');await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1120,deviceScaleFactor:1,mobile:false});
    // Public atlas: map first, every subgroup at once, address search, subgroup detail.
    await send('Page.navigate',{url:serverURL+'/'});
    await ready('document.querySelectorAll("#rows .row").length>0 && document.querySelectorAll(".addr").length>0');
    assert.equal(await evaluate('document.querySelectorAll("#rows .row, #inactiveRows .row").length'),expectedPoints);
    assert.equal(await evaluate('document.querySelectorAll(".addr").length'),addresses.length);
    assert.ok(await evaluate('document.querySelector("#statusText").textContent.startsWith("Зараз без світла:")'));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await wait(1500);await screenshot('site-desktop');
    await evaluate('document.querySelector("[data-range=week]").click()');
    assert.ok(await evaluate('document.querySelectorAll("#axis span").length>=6'));
    await evaluate('document.querySelector("#rows .row").dispatchEvent(new MouseEvent("mouseover",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("#map").classList.contains("focusing")'),true);
    await evaluate('document.querySelector("#search").value="Булаховського 5";document.querySelector("#search").dispatchEvent(new Event("input"))');
    assert.ok(await evaluate('document.querySelectorAll("#searchResults li").length>0'));
    await evaluate('document.querySelector("#search").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    await ready('document.querySelector(".leaflet-popup .pop h3")');
    assert.ok(await evaluate('document.querySelector(".leaflet-popup .pop").textContent.includes("Булаховського")'));
    await wait(800);await screenshot('site-popup');
    await evaluate('location.hash="sg=sg30"');
    await ready('!document.querySelector("#detail").hidden && document.querySelectorAll("#heat .cell").length>0');
    assert.equal(await evaluate('document.querySelector("#detailTitle").textContent'),'SG30');
    assert.ok(await evaluate('document.querySelectorAll("#detail [data-address]").length>0'));
    await evaluate('document.querySelector("#heat .cell").click()');
    assert.ok(await evaluate('document.querySelector("#cellInfo").textContent.includes(":00 —")'));
    await evaluate('document.querySelector("#heat .cell").focus()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
    assert.equal(await evaluate('document.activeElement.dataset.cell'),'1');
    await screenshot('site-detail');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('location.hash="";scrollTo(0,0)');
    await wait(600);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await screenshot('site-mobile');
    await evaluate('document.querySelector("#groups").scrollIntoView()');
    await screenshot('site-mobile-groups');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1120,deviceScaleFactor:1,mobile:false});
    // Advanced analytics with the bundled archive.
    await send('Page.navigate',{url:serverURL+'/explore.html'});
    await ready('document.querySelectorAll(".heat-cell").length>0');
    assert.equal(await evaluate('document.querySelectorAll("#pointSelect option").length'),expectedPoints);
    assert.equal(await evaluate('document.querySelector("#pointName").textContent'),'SG30');
    assert.ok(await evaluate('document.querySelectorAll(".heat-cell").length<=720'));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await screenshot('desktop');
    await evaluate('document.querySelector(".heat-cell").focus()');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
    assert.equal(await evaluate('document.activeElement.dataset.cell'),'1');
    assert.ok(await evaluate('document.querySelector("#cellDetail").textContent.includes("реконструкція") || document.querySelector("#cellDetail").textContent.includes("меж")'));
    await evaluate('document.querySelector("#search").value="nonexistent";document.querySelector("#search").dispatchEvent(new Event("input"))');
    assert.equal(await evaluate('document.querySelector("#pointName").textContent'),'Немає збігів');
    await evaluate('document.querySelector("#search").value="";document.querySelector("#search").dispatchEvent(new Event("input"))');
    await evaluate('document.querySelector("#period").value="all";document.querySelector("#period").dispatchEvent(new Event("change"))');
    assert.equal(await evaluate('document.querySelector("#calendarPrev").disabled'),false);
    await evaluate('document.querySelector("#calendarPrev").click()');
    assert.equal(await evaluate('document.querySelector("#calendarNext").disabled'),false);
    await evaluate('document.querySelector("[data-view=coverage]").click()');
    assert.equal(await evaluate('document.querySelector("#mapEmpty").hidden'),false);
    assert.equal(await evaluate('document.querySelectorAll("#mapTiles img").length'),0);
    await screenshot('coverage-empty');
    await evaluate('document.querySelector("[data-view=sources]").click()');
    assert.ok(await evaluate('document.querySelector("#sourcesList").textContent.includes("telegram:")'));
    await screenshot('sources');
    await evaluate('document.querySelector("[data-view=analytics]").click();document.querySelector("#period").value="30";document.querySelector("#period").dispatchEvent(new Event("change"))');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await screenshot('mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await evaluate('document.querySelector("#comparisonBody .point-button").click()');
    await screenshot('mobile-detail');
    // Local-file mode remains usable without fetch or a CDN.
    await send('Page.navigate',{url:'file:///'+site.replace(/\\/g,'/')+'/electricity_dashboard_standalone.html'});
    await ready('document.querySelector("#emptyState") && !document.querySelector("#emptyState").hidden');
    assert.equal(await evaluate('document.querySelector("#loadBundled").hidden'),true);
    await send('DOM.enable');
    const doc=await send('DOM.getDocument');const input=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#fileInput'});
    await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[eventsPath]});
    await ready('document.querySelectorAll(".heat-cell").length>0');
    assert.equal(await evaluate('document.querySelectorAll("#pointSelect option").length'),expectedPoints);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await screenshot('file-mode');
    // Custom date validation must preserve the previous valid result on failure.
    await evaluate('document.querySelector("#period").value="custom";document.querySelector("#period").dispatchEvent(new Event("change"));document.querySelector("#dateFrom").value="2026-02-10";document.querySelector("#dateTo").value="2026-02-01";document.querySelector("#applyDates").click()');
    assert.equal(await evaluate('document.querySelector("#notice").classList.contains("error")'),true);
    await evaluate('document.querySelector("#dateFrom").value="2026-02-01";document.querySelector("#dateTo").value="2026-02-02";document.querySelector("#applyDates").click()');
    assert.equal(await evaluate('document.querySelectorAll(".heat-cell").length'),48);
    await evaluate('document.querySelector("[data-view=sources]").click();document.querySelector("#clearBtn").click()');
    assert.equal(await evaluate('document.querySelector("#emptyState").hidden'),false);
    const fixture={schemaVersion:1,sources:[{id:'qa-sensor',name:'=QA source',kind:'observations',maxAgeSeconds:120}],
      points:[{sourceId:'qa-sensor',id:'fixture',name:'<img src=x onerror="window.__xss=true">',coordinates:{lat:50.45,lon:30.52}}],
      events:[{sourceId:'qa-sensor',pointId:'fixture',timestamp:'2026-02-01T00:00:00+02:00',validUntil:'2026-02-01T06:00:00+02:00',state:'on',evidence:'measured'},
        {sourceId:'qa-sensor',pointId:'fixture',timestamp:'2026-02-01T06:00:00+02:00',validUntil:'2026-02-01T12:00:00+02:00',state:'off',evidence:'measured'}]};
    const fixturePath=path.join(output,'synthetic-fixture.json');await fs.writeFile(fixturePath,JSON.stringify(fixture));
    await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[fixturePath]});
    await ready('document.querySelectorAll("#pointSelect option").length===1');
    assert.equal(await evaluate('window.__xss===undefined && document.querySelector("#pointName img")===null'),true);
    assert.ok(await evaluate('document.querySelector("#pointName").textContent.includes("<IMG")'));
    await evaluate('document.querySelector("[data-view=coverage]").click()');
    assert.equal(await evaluate('document.querySelectorAll(".map-point").length'),1);
    assert.ok(await evaluate('document.querySelectorAll("#mapTiles img").length>0'));
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1120,deviceScaleFactor:1,mobile:false});
    await screenshot('synthetic-coverage');
    await evaluate('document.querySelector(".map-point").click()');
    assert.equal(await evaluate('document.querySelector("#analyticsView").hidden'),false);
    await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output});
    await evaluate('document.querySelector("#exportBtn").click()');
    for(let i=0;i<50;i++){try{await fs.access(path.join(output,'light-stat.csv'));break;}catch{}await wait(100);}
    const csv=await fs.readFile(path.join(output,'light-stat.csv'),'utf8');assert.ok(csv.includes("'=QA source"),'CSV formula prefix must be escaped');
    await evaluate('document.querySelector("[data-view=sources]").click();document.querySelector("#normalizedExport").click()');
    for(let i=0;i<50;i++){try{await fs.access(path.join(output,'light-stat-archive.json'));break;}catch{}await wait(100);}
    const exported=engine.importData(JSON.parse(await fs.readFile(path.join(output,'light-stat-archive.json'),'utf8')));
    assert.equal(exported.events.length,2);assert.equal(exported.events[0].evidence,'measured');
    const badPath=path.join(output,'invalid.json');await fs.writeFile(badPath,'{broken');
    await send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[badPath]});
    await ready('document.querySelector("#notice").classList.contains("error")');
    assert.equal(await evaluate('document.querySelectorAll("#pointSelect option").length'),1);
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log('PASS: public atlas (map, all subgroups, search, popup, detail, mobile), archive loading, keyboard details, filters, custom dates, pagination, empty and geolocated coverage, mobile layout, self-contained offline import, XSS escaping, safe CSV, archive export roundtrip, invalid import recovery; no browser exceptions.');
  }finally{await send('Browser.close').catch(()=>{});ws.close();server.kill();chrome.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
