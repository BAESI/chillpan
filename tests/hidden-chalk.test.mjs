import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/chillpan/app.js", import.meta.url), "utf8");
function board(saved = {}, pathname = "/") {
  const properties = {};
  const root = { dataset: {}, style: { setProperty: (key, value) => { properties[key] = value; } } };
  const cursor = { style: {}, classList: { toggle() {} } };
  const storage = { getItem: () => JSON.stringify(saved), setItem() {} };
  const sandbox = vm.createContext({
    document: { documentElement: root, querySelector: (selector) => selector === "#chalkCursor" ? cursor : { getContext: () => ({}) } },
    navigator: { language: "ko-KR" }, localStorage: storage,
    sessionStorage: { getItem: () => "[]", setItem() {} },
    window: { location: { pathname, search: "", hash: "" } }, performance: { now: () => 1000 }, crypto: { randomUUID: () => "stroke-id" },
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(source.replace("\ninit();\n", "\n"), sandbox);
  return { sandbox, root, cursor, properties, run: (code) => vm.runInContext(code, sandbox) };
}

test("hidden chalk rolls have exact boundaries and keep normal chalk most common", () => {
  const { run } = board();
  assert.deepEqual(Array.from(run("[0, .0099, .01, .0399, .04, .0599, .06, .0799, .08, .999].map(rollChalkKind)")),
    ["gold", "gold", "rainbow", "rainbow", "king", "king", "eraser", "eraser", "normal", "normal"]);
});

test("hidden chalk persists across refresh and king remains fixed-width ink", () => {
  for (const kind of ["normal", "rainbow", "gold", "king"]) {
    const { run, cursor, root, properties } = board({ chalkKind: kind, color: "#85bdf3", chalkRemaining: 4400 });
    run("loadState(); updateChalkCursor()");
    assert.equal(root.dataset.chalkKind, kind);
    assert.equal(cursor.style.width, kind === "king" ? "26px" : "15px");
    assert.equal(run("CHALK_SIZE"), 5);
    assert.equal(properties["--chalk"], kind === "gold" ? "#edc568" : "#85bdf3");
  }
});

test("rainbow keeps each stored chunk monochrome and advances only at the existing boundary", () => {
  const { run } = board();
  run(`
    chalkKind = "rainbow"; color = COLORS[0]; width = 390; height = 700;
    lastPoint = { x: 20, y: 30 };
    savePendingStrokes = () => Promise.resolve(); flushStrokes = () => {};
    beginStroke(lastPoint); queueStroke(true);
  `);
  assert.equal(run("pendingStrokes[0].color"), "#f28eaa");
  assert.equal(run("currentStroke.color"), "#82d9ad");
  assert.equal(run("pendingStrokes.length"), 1);
  assert.equal(run("STROKE_INTERVAL"), 600);
});

test("older saved chalk without kind loads as normal", () => {
  const { run, root } = board({ color: "#f28eaa", chalkRemaining: 400 });
  run("loadState(); updateChalkCursor()");
  assert.equal(root.dataset.chalkKind, "normal");
  assert.equal(run("chalkRemaining"), 400);
});

test("hidden fanfare respects mute, replaces previous notes and cleans up", () => {
  const { run } = board();
  run(`var started = 0, stopped = 0, disconnected = 0;
    prepareChalkSound = () => {};
    chalkAudio = { context: {
      currentTime: 10, destination: {},
      createOscillator: () => ({frequency:{value:0}, connect(node){return node}, disconnect(){}, start(){started++}, stop(){stopped++}}),
      createGain: () => ({gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},
        connect(){}, disconnect(){disconnected++}})
    }};
    soundEnabled = false; playDiscoverySound();`);
  assert.equal(run("started"), 0);
  run("soundEnabled = true; playDiscoverySound()");
  assert.equal(run("started"), 5);
  assert.equal(run("discoveryNotes.length"), 5);
  run("playDiscoverySound()");
  assert.equal(run("started"), 10);
  assert.equal(run("disconnected"), 5);
  run("stopDiscoverySound()");
  assert.equal(run("discoveryNotes.length"), 0);
  assert.equal(run("disconnected"), 10);
});

test("eraser restores a bounded budget and uses its own cursor and wire tool", () => {
  const { run, cursor } = board({ chalkKind: "eraser", chalkRemaining: 99999 });
  run("loadState(); updateChalkCursor(); width = 390; height = 700; beginStroke({x:20,y:30})");
  assert.equal(run("chalkRemaining"), 9600);
  assert.equal(cursor.style.width, "48px");
  assert.equal(cursor.style.height, "30px");
  assert.equal(run("currentStroke.tool"), "eraser");
});

test("remote eraser replays every segment instead of drawing colored ink", () => {
  const { run, sandbox } = board();
  run(`var erased = []; eraseChalk = (from, to) => erased.push([from, to]); width = 100; height = 100;
    drawSharedStroke({ tool: "eraser", points: [[.1,.2],[.3,.2],[.1,.2]] });`);
  assert.equal(sandbox.erased.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.erased[0])), [{x:10,y:20},{x:30,y:20}]);
});

test("confirmed actions preserve ink/eraser order and yield between eraser segments", () => {
  const { run } = board();
  run(`var replay = []; ctx.clearRect = () => {}; drawOpeningDust = () => {};
    drawStrokeOn = stroke => replay.push(stroke.strokeId);
    eraseChalk = () => replay.push("erase");
    sharedStrokes = [{strokeId:"ink"},{strokeId:"erase",tool:"eraser",points:[[.1,.1]]}];
    sharedStrokeIds.add("ink"); sharedStrokeIds.add("erase");
    pendingStrokes = [{strokeId:"erase",tool:"eraser",day:dayKey,room:1},{strokeId:"next",day:dayKey,room:1}];
    currentRoom = "1"; for (const stroke of sharedStrokes) for (const step of strokeSteps(stroke)) {}`);
  assert.deepEqual(Array.from(run("replay")), ["ink", "erase"]);
});

test("polling schedules incremental rendering even while drawing and deduplicates actions", async () => {
  const { run, sandbox } = board();
  sandbox.setTimeout = () => 1;
  run(`var replayCount = 0, painted = []; canvas.setAttribute = () => {};
    renderBoardView = () => { replayCount++; boardNeedsReplay = false; };
    drawSharedStroke = stroke => painted.push(stroke.strokeId);
    sharedStrokeIds.add("old"); seenStrokes.add("old");
    var reply = {day:dayKey,strokes:[{strokeId:"new"}],cursor:2,hasMore:false};`);
  sandbox.fetch = async () => ({ ok: true, json: async () => run("reply") });
  await run("pollBoard(boardLoadId)");
  assert.equal(run("replayCount"), 1);
  run('drawing = true; reply.strokes = [{strokeId:"remote-eraser",tool:"eraser"}];');
  await run("pollBoard(boardLoadId)");
  assert.equal(run("replayCount"), 2);
  assert.equal(run("sharedStrokes.length"), 2);
  run("drawing = false; reply.strokes = [];");
  await run("pollBoard(boardLoadId)");
  assert.equal(run("replayCount"), 2);
});

test("eraser filters a bounded high-DPI patch instead of its destination canvas", () => {
  const { run, sandbox } = board();
  sandbox.document.createElement = () => ({getContext: () => ({clearRect(){},drawImage(){}})});
  run(`var imageArgs;
    width = 1920; height = 1080; pixelRatio = 2; canvas.width = 3840; canvas.height = 2160;
    for (const method of ["save","restore","beginPath","rect","clip","moveTo","lineTo","stroke"]) ctx[method] = () => {};
    ctx.drawImage = (...args) => { imageArgs = args; };
    eraseChalk({x:500,y:500},{x:510,y:510});`);
  assert.ok(run("imageArgs[3] * imageArgs[4] < canvas.width * canvas.height / 100"));
  assert.equal(run("imageArgs[3] / pixelRatio"), run("imageArgs[7]"));
  assert.equal(run("imageArgs[0] === canvas"), false);
});

test("movement storage is coalesced and final state flush cancels the timer", () => {
  const { run, sandbox } = board();
  let timers = 0, writes = 0;
  sandbox.setTimeout = () => ++timers;
  sandbox.clearTimeout = () => {};
  sandbox.localStorage.setItem = () => writes++;
  run("for(let i=0;i<100;i++) scheduleStateSave()");
  assert.equal(timers, 1);
  assert.equal(writes, 0);
  run("saveState()");
  assert.equal(writes, 1);
  assert.equal(run("stateSaveTimer"), 0);
});

test("confirmed history advances once during input, accepts new actions and cancels stale rooms", () => {
  const { run, sandbox } = board();
  let frames = [], clock = 0;
  sandbox.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  sandbox.cancelAnimationFrame = () => {};
  sandbox.performance.now = () => ++clock;
  sandbox.document.createElement = () => ({ getContext: () => ({ setTransform() {} }) });
  run(`var painted = [], commits = 0;
    compositeRegion = () => commits++;
    drawStrokeOn = stroke => painted.push(stroke.strokeId);
    sharedStrokes = Array.from({length:200}, (_,i) => ({strokeId:String(i),points:[[.1,.2]]}));
    optimisticStrokes.set("ack-local", {strokeId:"ack-local",day:dayKey,room:1});
    pendingStrokes = []; renderBoardView();`);
  assert.equal(run("painted.length"), 0);
  frames.shift()();
  assert.ok(run("painted.length") > 0 && run("painted.length") < 200);
  assert.equal(run("commits"), 1);
  const paintedBeforeInput = run("painted.length");
  run("drawing = true");
  frames.shift()();
  assert.ok(run("painted.length") > paintedBeforeInput);
  run('sharedStrokes.push({strokeId:"late",points:[[.1,.2]]}); renderBoardView()');
  for (let i = 0; frames.length && i < 300; i++) frames.shift()();
  assert.equal(run("painted.length"), 201);
  assert.equal(run("painted.at(-1)"), "late");
  assert.equal(run('optimisticStrokes.has("ack-local")'), true);
  assert.equal(run("boardNeedsReplay"), false);
  run('sharedStrokes.push({strokeId:"stale",points:[[.1,.2]]}); renderBoardView(); boardLoadId++');
  frames.shift()();
  assert.equal(run("painted.length"), 201);
});

test("pointer movement is coalesced to one sample per frame", () => {
  const { run, sandbox } = board();
  const frames = [];
  sandbox.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  run('var samples = []; draw = event => samples.push(event.clientX); for(let i=0;i<100;i++) schedulePointer({clientX:i,clientY:1,pointerId:1})');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(Array.from(run("samples")), [99]);
});

test("stationary held pointer flushes its final segment on the chunk timer", () => {
  const { run, sandbox } = board();
  let timer;
  sandbox.setTimeout = callback => { timer = callback; return 1; };
  run('var chunks = 0; queueStroke = () => chunks++; drawing = true; beginStroke({x:1,y:1}); currentStroke.points.push([.2,.2])');
  timer();
  assert.equal(run("chunks"), 1);
});

test("live notifications catch up by HTTP, ignore old rooms and reconnect with polling fallback", () => {
  const {run, sandbox} = board();
  const sockets=[];
  sandbox.WebSocket=class {
    readyState=0;
    constructor(url){this.url=url;sockets.push(this)}
    close(){this.readyState=3}
  };
  sandbox.clearInterval=()=>{};
  sandbox.setInterval=()=>1;
  sandbox.document.body={dataset:{liveUrl:"wss://test.example/live"}};
  run("var syncs=0; requestBoardSync=()=>syncs++; connectLive()");
  assert.equal(sockets[0].url,"wss://test.example/live?room=1");
  sockets[0].readyState=1; sockets[0].onopen();
  assert.equal(run("syncs"),1);
  sockets[0].onmessage({data:run('JSON.stringify({type:"board",room:1,day:dayKey,cursor:5})')});
  assert.equal(run("syncs"),2);
  run('currentRoom="2";connectLive(true)');
  sockets[0].onmessage({data:run('JSON.stringify({type:"board",room:1,day:dayKey,cursor:6})')});
  assert.equal(run("syncs"),2);
  sockets[1].onclose();
  assert.equal(run("syncs"),3);
  assert.equal(run("liveSocket"),null);
  assert.equal(run("liveAttempt"),1);
});

test("pointer coordinates do not force a layout read for each movement", () => {
  const { run } = board();
  run(`canvas.getBoundingClientRect = () => { throw new Error("forced layout") };
    boardBounds = {left:10,top:20};`);
  assert.deepEqual(JSON.parse(JSON.stringify(run("getPoint({clientX:30,clientY:50})"))), {x:20,y:30});
});

test("classroom share paths override saved room and history navigation avoids extra pushes", () => {
  const { run, sandbox } = board({}, "/3/");
  assert.equal(run("currentRoom"), "3");
  assert.deepEqual(Array.from(run('["/1","/2/","/3","/4","/api/board","/13"].map(roomFromPath)')),
    ["1", "2", "3", null, null, null]);
  const paths = [];
  sandbox.window.history = { pushState: (_state, _unused, url) => paths.push(url) };
  run("stopDrawing = () => {}; loadBoard = () => {}; clearFallingDust = () => {}; updateRoomSelection = () => {}; switchRoom('2')");
  assert.deepEqual(paths, ["/2"]);
  run("switchRoom('1', false); switchRoom('9')");
  assert.equal(run("currentRoom"), "1");
  assert.deepEqual(paths, ["/2"]);
});

test("pointer movement restores chalk visibility even when pointerenter was missed", () => {
  const { run, cursor } = board();
  const classes = new Set();
  cursor.classList.add = (name) => classes.add(name);
  cursor.classList.remove = (name) => classes.delete(name);
  run("draw({clientX:100,clientY:200})");
  assert.equal(classes.has("is-visible"), true);
  assert.ok(cursor.style.transform.includes("translate3d(92.5px, 200px"));
  run("hideChalkCursor()");
  assert.equal(classes.has("is-visible"), false);
});
