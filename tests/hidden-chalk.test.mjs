import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/chillpan/app.js", import.meta.url), "utf8");
function board(saved = {}) {
  const properties = {};
  const root = { dataset: {}, style: { setProperty: (key, value) => { properties[key] = value; } } };
  const cursor = { style: {}, classList: { toggle() {} } };
  const storage = { getItem: () => JSON.stringify(saved), setItem() {} };
  const sandbox = vm.createContext({
    document: { documentElement: root, querySelector: (selector) => selector === "#chalkCursor" ? cursor : { getContext: () => ({}) } },
    navigator: { language: "ko-KR" }, localStorage: storage,
    sessionStorage: { getItem: () => "[]", setItem() {} },
    window: {}, performance: { now: () => 1000 }, crypto: { randomUUID: () => "stroke-id" },
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
    savePendingStrokes = () => {}; flushStrokes = () => {};
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

test("canonical replay orders shared strokes before pending edits and avoids duplicate erasing", () => {
  const { run } = board();
  run(`var replay = []; ctx.clearRect = () => {}; drawOpeningDust = () => {};
    drawSharedStroke = stroke => replay.push(stroke.strokeId);
    sharedStrokes = [{strokeId:"ink"},{strokeId:"erase",tool:"eraser"}];
    sharedStrokeIds.add("ink"); sharedStrokeIds.add("erase");
    pendingStrokes = [{strokeId:"erase",tool:"eraser",day:dayKey,room:1},{strokeId:"next",day:dayKey,room:1}];
    currentRoom = "1"; renderBoardView();`);
  assert.deepEqual(Array.from(run("replay")), ["ink", "erase", "next"]);
});
