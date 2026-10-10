import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/chillpan/app.js", import.meta.url), "utf8");

function board() {
  const lines = [];
  const dots = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { lines.push(this.lineWidth); },
    arc(x, y, radius) { dots.push(radius); },
    fill() {}, setTransform() {}, clearRect() {},
  };
  const canvas = {
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 1440, height: 900 }),
  };
  const storage = { getItem: () => null };
  const sandbox = vm.createContext({
    document: { querySelector: () => canvas },
    navigator: { language: "ko-KR" },
    localStorage: storage, sessionStorage: storage,
    window: { devicePixelRatio: 2 },
  });
  vm.runInContext(source.replace("\ninit();\n", "\n"), sandbox);
  return { sandbox, lines, dots, canvas };
}

test("mobile and desktop strokes replay at the same fixed width on every viewport", () => {
  const { sandbox, lines, dots } = board();
  for (const viewport of [320, 390, 768, 1440, 2560]) {
    for (const originalWidth of [320, 390, 1440, 2560]) {
      vm.runInContext(`
        width = ${viewport}; height = 900;
        drawSharedStroke({ color: "#f28eaa", size: 5 / ${originalWidth}, points: [[0.2, 0.4], [0.8, 0.4]] });
        drawSharedStroke({ color: "#f28eaa", size: 5 / ${originalWidth}, points: [[0.2, 0.4]] });
      `, sandbox);
    }
  }
  assert.equal(lines.length, 20);
  assert.ok(lines.every((line) => line === 5));
  assert.ok(dots.every((radius) => radius === 2.5));
});

test("resize finishes the active stroke and reloads vectors instead of scaling a bitmap", () => {
  const { sandbox, canvas } = board();
  vm.runInContext(`
    var events = [];
    stopDrawing = () => events.push("stop");
    clearFallingDust = () => events.push("clear-dust");
    loadBoard = () => events.push("reload");
    width = 390; height = 844;
    resizeCanvas();
  `, sandbox);
  assert.deepEqual(Array.from(sandbox.events), ["stop", "clear-dust", "reload"]);
  assert.equal(canvas.width, 2880);
  assert.equal(canvas.height, 1800);
});

test("initial canvas sizing leaves initial board loading to init", () => {
  const { sandbox } = board();
  vm.runInContext(`
    var events = [];
    stopDrawing = () => events.push("stop");
    clearFallingDust = () => events.push("clear-dust");
    loadBoard = () => events.push("reload");
    resizeCanvas();
  `, sandbox);
  assert.deepEqual(Array.from(sandbox.events), ["clear-dust"]);
});

test("unchanged viewport events preserve the bitmap and do not reload history", () => {
  const {sandbox}=board();
  vm.runInContext(`var events=[];stopDrawing=()=>events.push("stop");clearFallingDust=()=>events.push("clear");loadBoard=()=>events.push("reload");
    width=1440;height=900;pixelRatio=2;resizeCanvas()`,sandbox);
  assert.deepEqual(Array.from(sandbox.events),[]);
});

test("touch coordinates map a stale CSS box to logical canvas coordinates", () => {
  const {sandbox}=board();
  const point=vm.runInContext(`width=300;height=150;boardBounds={left:10,top:20,width:390,height:602};getPoint({clientX:205,clientY:321})`,sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(point)),{x:150,y:75});
});
