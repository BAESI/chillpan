import assert from "node:assert/strict";

const origin = "http://127.0.0.1:4173";
async function setup(context) {
  await context.addInitScript(() => {
    localStorage.setItem("chillpan:sound", "off");
    window.__perf = {long:[],frames:[]};
    new PerformanceObserver(list => list.getEntries().forEach(entry => window.__perf.long.push(entry.duration))).observe({type:"longtask",buffered:true});
    let previous;
    function frame(now) { if (previous) window.__perf.frames.push(now-previous); previous=now; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  });
}
async function ready(page) {
  await page.waitForFunction(() => window.__boardQA && document.querySelector("#chalkboard").getAttribute("aria-busy") === "false" && !window.__boardQA.stats().busy);
}
async function draw(page, eraser = false, hold = false) {
  if (eraser) await page.evaluate(() => window.__boardQA.eraser());
  await page.mouse.move(120,180);
  await page.mouse.down();
  for(let i=0;i<90;i++) {
    await page.mouse.move(120 + i*5,180 + Math.sin(i/6)*70);
    await page.waitForTimeout(8);
  }
  if (!hold) await page.mouse.up();
}
async function verifyInitialLoad(browser) {
  const results=[];
  for (const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:2});
    await setup(context);
    await context.addInitScript(()=>{
      window.__initialDraws=0;
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(...args){
        if(this.canvas.id==="chalkboard") window.__initialDraws++;
        return draw.apply(this,args);
      };
    });
    const page=await context.newPage();
    const cpu=await context.newCDPSession(page);await cpu.send("Emulation.setCPUThrottlingRate",{rate:4});
    await page.goto(`${origin}/1`);await ready(page);
    const initial=await page.evaluate(()=>({draws:window.__initialDraws,...window.__boardQA.stats()}));
    assert.equal(initial.draws,2); // Background once, completed history once; no intermediate frames.
    assert.equal(initial.rendered,initial.shared);
    await page.reload();await ready(page);
    assert.equal(await page.evaluate(()=>window.__initialDraws),2);
    results.push({width,history:initial.shared,mainCanvasCopies:initial.draws,reload:true});
    await page.goto(`${origin}/1`);
    await page.waitForFunction(()=>window.__boardQA && window.__boardQA.stats().busy);
    await page.selectOption("#roomSelect","3");await ready(page);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>window.__boardQA.stats().shared),0);
    await context.close();
  }
  return results;
}
export async function verify(page) {
  const browser = page.context().browser();
  const report = {};
  report.initialSnapshot=await verifyInitialLoad(browser);
  for (const version of ["baseline", "1"]) {
    const context = await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:2});
    await setup(context);
    const target = await context.newPage();
    const cpu = await context.newCDPSession(target);
    await cpu.send("Emulation.setCPUThrottlingRate", {rate:4});
    const errors=[]; target.on("pageerror", error => errors.push(String(error)));
    const start = Date.now();
    await target.goto(`${origin}/${version}`);
    await ready(target);
    const loadMs = Date.now()-start;
    await target.evaluate(() => {window.__perf.long=[];window.__perf.frames=[];window.__boardQA.resetWork()});
    await draw(target, true);
    await target.waitForTimeout(3500);
    await ready(target);
    report[version] = await target.evaluate(() => {
      const frames=window.__perf.frames.sort((a,b)=>a-b);
      return {longTasks:window.__perf.long.length,maxLongTaskMs:Math.max(0,...window.__perf.long),
        p95FrameMs:frames[Math.floor(frames.length*.95)],maxFrameMs:Math.max(...frames),stats:window.__boardQA.stats(),work:window.__boardQA.work()};
    });
    report[version].loadMs=loadMs;
    assert.deepEqual(errors, []);
    if (version === "1") {
      assert.equal(report[version].stats.shared,report[version].stats.rendered);
      assert.equal(report[version].stats.pending,0);
      assert.equal(report[version].work.historicalDraws,0);
      await target.screenshot({path:"output/playwright/desktop-performance.png"});
    }
    await context.close();
  }
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  await setup(context);
  const a=await context.newPage(), b=await context.newPage();
  await a.goto(`${origin}/2`); await b.goto(`${origin}/2`); await ready(a); await ready(b);
  await b.waitForFunction(() => window.__boardQA.stats().live === 1);
  await b.mouse.move(800,400); await b.mouse.down();
  await b.mouse.move(810,410); // Keep B drawing while A writes.
  const start=Date.now();
  await a.mouse.move(150,220); await a.mouse.down(); await a.mouse.move(250,220); await a.mouse.up();
  await b.waitForFunction(() => window.__boardQA.stats().shared >= 1 && window.__boardQA.stats().rendered >= 1);
  report.remoteWhileDrawingMs=Date.now()-start;
  assert.equal(await b.evaluate(() => window.__boardQA.stats().drawing),true);
  await b.mouse.up();
  await b.evaluate(() => window.__boardQA.disconnect());
  await a.mouse.move(150,250); await a.mouse.down(); await a.mouse.move(250,250); await a.mouse.up();
  await b.waitForFunction(() => window.__boardQA.stats().live === 1 && window.__boardQA.stats().pending===0);
  await a.waitForFunction(() => window.__boardQA.stats().pending===0);
  await b.waitForFunction(() => window.__boardQA.stats().shared>=3);
  report.reconnect=true;
  await b.selectOption("#roomSelect","3"); await ready(b);
  assert.equal(await b.evaluate(() => window.__boardQA.stats().shared),0);
  await b.goBack(); await ready(b);
  assert.equal(await b.evaluate(() => window.__boardQA.stats().room),"2");
  report.roomIsolation=true;
  await context.setOffline(true);
  await a.mouse.move(150,300); await a.mouse.down(); await a.mouse.move(250,300); await a.mouse.up();
  await a.waitForFunction(() => window.__boardQA.stats().pending>0);
  const savedIds = await a.evaluate(() => new Promise(resolve => {
    const open=indexedDB.open("chillpan-outbox",1);
    open.onsuccess=()=>{const db=open.result;const read=db.transaction("strokes").objectStore("strokes").getAll();
      read.onsuccess=()=>{resolve(read.result.map(s=>s.strokeId));db.close()}};
  }));
  assert.equal(savedIds.length>0,true);
  await a.waitForTimeout(200);
  await a.close();
  await context.setOffline(false);
  const restored=await context.newPage(); await restored.goto(`${origin}/2`); await ready(restored);
  await restored.waitForFunction(() => window.__boardQA.stats().pending===0);
  const recoveredIds=await restored.evaluate(async () => (await (await fetch("/api/board?room=2")).json()).strokes.map(s=>s.strokeId));
  for (const id of savedIds) assert.equal(recoveredIds.filter(value=>value===id).length,1);
  report.closedTabRecovery=true;
  await context.close();
  const mobile = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await setup(mobile);
  const phone=await mobile.newPage(); await phone.goto(`${origin}/3`); await ready(phone);
  // Touch-compatible pointer input exercises the same capture and frame path.
  const session=await mobile.newCDPSession(phone);
  await session.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:70,y:200}]});
  for(let i=1;i<=20;i++) await session.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:70+i*5,y:200+i*2}]});
  await session.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await phone.waitForFunction(() => window.__boardQA.stats().shared>0 && window.__boardQA.stats().pending===0);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await phone.screenshot({path:"output/playwright/mobile-performance.png"});
  report.mobileTouch=true;
  await mobile.close();
  return report;
}
