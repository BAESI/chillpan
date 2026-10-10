import assert from "node:assert/strict";

export async function verifyMobileLayout(page) {
  const context=await page.context().browser().newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem("chillpan:sound","off"));
  const phone=await context.newPage();
  const errors=[];phone.on("pageerror",error=>errors.push(String(error)));
  // Exercise the cold-cache WebKit race instead of relying on an already cached stylesheet.
  await context.route("**/chillpan/styles.css",async route=>{await phone.waitForTimeout(300);await route.continue()});
  const ready=()=>phone.waitForFunction(()=>window.__boardQA && !window.__boardQA.stats().busy &&
    document.querySelector("#chalkboard").getAttribute("aria-busy")==="false");
  const dimensions=()=>phone.evaluate(()=>{
    const canvas=document.querySelector("#chalkboard"),rect=canvas.getBoundingClientRect();
    return {cssWidth:Math.floor(rect.width),cssHeight:Math.floor(rect.height),width:canvas.width,height:canvas.height,
      ratio:Math.min(devicePixelRatio,2)};
  });
  const checkSize=async()=>{const size=await dimensions();assert.equal(size.width,size.cssWidth*size.ratio);assert.equal(size.height,size.cssHeight*size.ratio);return size};
  try {
    await phone.goto("http://127.0.0.1:4173/1");await ready();
    const portrait=await checkSize();
    const ink=await phone.evaluate(()=>{
      const c=document.querySelector("#chalkboard"),pixels=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>60)count++;return count;
    });
    assert.equal(ink>0,true);
    await phone.evaluate(()=>{
      window.__reloads=0;new MutationObserver(records=>{for(const record of records)
        if(record.attributeName==="aria-busy" && record.target.getAttribute("aria-busy")==="true")window.__reloads++;
      }).observe(document.querySelector("#chalkboard"),{attributes:true});
      for(let i=0;i<20;i++)window.dispatchEvent(new Event("resize"));
    });
    await phone.waitForTimeout(250);
    assert.equal(await phone.evaluate(()=>window.__reloads),0);
    await phone.selectOption("#roomSelect","2");await ready();
    const box=await dimensions();
    for(const y of [180,500])await phone.touchscreen.tap(150,y);
    await phone.waitForFunction(()=>window.__boardQA.stats().pending===0 && window.__boardQA.stats().shared>=2);
    const points=await phone.evaluate(async()=> (await(await fetch("/api/board?room=2")).json()).strokes.slice(-2).map(s=>s.points[0]));
    for(let i=0;i<2;i++) {
      assert.equal(Math.abs(points[i][0]-150/box.cssWidth)<.002,true);
      assert.equal(Math.abs(points[i][1]-[180,500][i]/box.cssHeight)<.002,true);
    }
    await phone.setViewportSize({width:844,height:390});await ready();
    await phone.waitForFunction(()=>document.querySelector("#chalkboard").width===1688);
    const landscape=await checkSize();
    await phone.mouse.move(200,120);await phone.mouse.down();await phone.mouse.move(300,160);await phone.mouse.up();
    await phone.waitForFunction(()=>window.__boardQA.stats().pending===0 && window.__boardQA.stats().shared>=3);
    await phone.setViewportSize({width:390,height:844});
    await phone.waitForFunction(()=>document.querySelector("#chalkboard").width===780);await ready();
    await phone.selectOption("#roomSelect","1");await ready();await checkSize();
    await phone.screenshot({path:"output/playwright/mobile-layout-fixed.png"});
    assert.deepEqual(errors,[]);
    return {portrait,landscape,visibleInkPixels:ink,touchPoints:points,unchangedResizeReloads:0,errors};
  } finally {await context.close()}
}
