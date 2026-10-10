const canvas = document.querySelector("#chalkboard");
const ctx = canvas.getContext("2d", { alpha: true });
const chalkCursor = document.querySelector("#chalkCursor");
const notice = document.querySelector("#notice");
const newChalkButton = document.querySelector("#newChalkButton");
const roomSelect = document.querySelector("#roomSelect");
const soundToggle = document.querySelector("#soundToggle");
const dustCanvas = document.querySelector("#chalkDust");
const dustCtx = dustCanvas.getContext("2d");

const CHALK_BUDGET = 8800;
const CHALK_SIZE = 5;
const ERASER_SIZE = 32;
const ERASER_BUDGET = 9600;
const SYNC_INTERVAL = Math.max(750, Number(document.body?.dataset?.syncMs) || 3000);
const STROKE_INTERVAL = Math.max(120, Number(document.body?.dataset?.strokeMs) || 600);
const STORAGE_PREFIX = "chillpan";
const COLORS = ["#f28eaa", "#82d9ad", "#85bdf3", "#f1d46f", "#c6a0ee", "#f5ad7c"];
const GOLD = "#edc568";
const CHALK_KINDS = ["normal", "rainbow", "gold", "king", "eraser"];
const TEXT = {
  ko: {
    description: "색색의 분필로 함께 흔적을 남기는 하루짜리 칠판 Chillpan.",
    board: "함께 그리는 칠판",
    rooms: "칠판 이동",
    room: (number) => `${number}반`,
    sound: "소리",
    feedback: "피드백 보내기",
    welcome: "오늘의 분필로 흔적을 남겨요",
    gone: "분필을 다 썼어요. 새 분필을 뽑아주세요.",
    finished: "분필을 다 썼어요. 새 분필로 이어 그릴 수 있어요.",
    newDay: "자정이 되어 새로운 칠판이 열렸어요.",
    newChalk: "새 분필",
    chalkReady: "새 분필을 뽑았어요.",
    hiddenRainbow: "히든 분필 발견! 무지개 분필을 뽑았어요.",
    hiddenGold: "히든 분필 발견! 금분필을 뽑았어요.",
    hiddenKing: "히든 분필 발견! 왕분필을 뽑았어요.",
    hiddenEraser: "히든 발견! 지우개를 뽑았어요.",
    eraserGone: "지우개를 다 썼어요. 새 분필을 뽑아주세요.",
    syncError: "칠판에 다시 연결하고 있어요.",
  },
  en: {
    description: "Chillpan is a shared daily chalkboard for leaving traces in colorful chalk.",
    board: "Global chalkboard drawing surface",
    rooms: "Switch classroom",
    room: (number) => `Room ${number}`,
    sound: "Sound",
    feedback: "Send feedback",
    welcome: "leave a trace with today's chalk",
    gone: "your chalk is gone. pick a new piece.",
    finished: "the chalk is finished. pick a new piece to keep drawing.",
    newDay: "a new board opened at midnight.",
    newChalk: "New chalk",
    chalkReady: "a fresh piece of chalk is yours.",
    hiddenRainbow: "Hidden chalk! You found rainbow chalk.",
    hiddenGold: "Hidden chalk! You found golden chalk.",
    hiddenKing: "Hidden chalk! You found giant chalk.",
    hiddenEraser: "Hidden find! You found an eraser.",
    eraserGone: "your eraser is worn out. pick a new piece of chalk.",
    syncError: "reconnecting to the shared board.",
  },
};

const language = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
let noticeKey = "welcome";

let dayKey = getDayKey();
let currentRoom = roomFromPath() || localStorage.getItem(`${STORAGE_PREFIX}:room`) || "1";
if (!["1", "2", "3"].includes(currentRoom)) currentRoom = "1";
let stateKey = `${STORAGE_PREFIX}:state:${dayKey}`;
let width = 0;
let height = 0;
let pixelRatio = 1;
let boardBounds = { left: 0, top: 0 };
let replayFrame = 0;
let drawing = false;
let activePointerId = null;
let loadingBoard = false;
let initialHistoryComplete = false;
let boardLoadId = 0;
let lastPoint = null;
let chalkRemaining = CHALK_BUDGET;
let color = COLORS[Math.floor(Math.random() * COLORS.length)];
let chalkKind = "normal";
let sharedStrokes = [];
let boardNeedsReplay = false;
let stateSaveTimer = 0;
const sharedStrokeIds = new Set();
let boardCursor = 0;
let pollTimer = 0;
let sendingStrokes = false;
let retryTimer = 0;
let currentStroke = null;
let strokeStartedAt = 0;
let strokeContinuation = false;
let cursorPoint = null;
let cursorAppearance = {};
let syncFailed = false;
let pendingStrokes = [];
try { pendingStrokes = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}:pending`) || "[]"); } catch {}
if (!Array.isArray(pendingStrokes)) pendingStrokes = [];
pendingStrokes = pendingStrokes.filter((stroke) => stroke.day === dayKey);
const seenStrokes = new Set(pendingStrokes.map((stroke) => stroke.strokeId));
const optimisticStrokes = new Map(pendingStrokes.map((stroke) => [stroke.strokeId, stroke]));
let lastStrokeTime = 0;
let dustFrame = 0;
let lastDustTime = 0;
const particles = [];
let soundEnabled = localStorage.getItem(`${STORAGE_PREFIX}:sound`) !== "off";
let chalkAudio = null;
let soundStopTimer = 0;
let discoveryNotes = [];
let confirmedSurface = null;
let confirmedContext = null;
let renderedCount = 0;
let polling = false;
let pollAgain = false;
let liveSocket = null;
let liveRetry = 0;
let liveAttempt = 0;
let liveHeartbeat = 0;
let strokeTimer = 0;
let outbox = null;
let persistence = Promise.resolve();
let inputFrame = 0;
let pendingPointer = null;
let eraserPatch = null;
let resizeFrame = 0;

init();

async function init() {
  applyLanguage();
  syncRoomUrl(false);
  window.addEventListener("popstate", () => switchRoom(roomFromPath() || "1", false));
  newChalkButton.addEventListener("click", pickNewChalk);
  roomSelect.addEventListener("change", () => switchRoom(roomSelect.value));
  soundToggle.checked = soundEnabled;
  soundToggle.addEventListener("change", () => {
    soundEnabled = soundToggle.checked;
    localStorage.setItem(`${STORAGE_PREFIX}:sound`, soundEnabled ? "on" : "off");
    if (soundEnabled) prepareChalkSound();
    else { stopChalkSound(); stopDiscoverySound(); }
  });
  loadState();
  saveState();
  await waitForBoardLayout();
  resizeCanvas();
  await restoreOutbox();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(scheduleCanvasResize).observe(canvas);
  loadBoard();
  updateRoomSelection();
  updateChalkCursor();
  window.addEventListener("resize", scheduleCanvasResize);
  window.visualViewport?.addEventListener("resize", scheduleCanvasResize);
  window.visualViewport?.addEventListener("scroll", scheduleCanvasResize);
  window.addEventListener("online", () => { flushStrokes(); connectLive(); requestBoardSync(); });
  canvas.addEventListener("pointerdown", startDrawing);
  canvas.addEventListener("pointermove", schedulePointer);
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  canvas.addEventListener("lostpointercapture", stopDrawing);
  canvas.addEventListener("pointerenter", showChalkCursor);
  canvas.addEventListener("pointerleave", hideChalkCursor);
  window.addEventListener("blur", stopDrawing);
  window.addEventListener("pagehide", stopDrawing);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopDrawing();
      stopDiscoverySound();
      clearFallingDust();
    } else { connectLive(); requestBoardSync(); }
  });
  window.addEventListener("pageshow", () => { connectLive(); requestBoardSync(); });
  setInterval(tick, 1000);
  flushStrokes();
  requestAnimationFrame(softenNotice);
}

function getDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function roomFromPath(pathname = window.location?.pathname || "/") {
  return /^\/([123])\/?$/.exec(pathname)?.[1] || null;
}

function syncRoomUrl(push) {
  const { pathname, search, hash } = window.location;
  if (pathname !== `/${currentRoom}`) {
    window.history[push ? "pushState" : "replaceState"](null, "", `/${currentRoom}${search}${hash}`);
  }
}

function switchRoom(room, updateUrl = true) {
  if (!["1", "2", "3"].includes(room)) return;
  if (room === currentRoom) return;
  stopDrawing();
  currentRoom = room;
  localStorage.setItem(`${STORAGE_PREFIX}:room`, currentRoom);
  if (updateUrl) syncRoomUrl(true);
  loadBoard();
  clearFallingDust();
  updateRoomSelection();
}

function updateRoomSelection() {
  roomSelect.value = currentRoom;
  canvas.setAttribute("aria-label", `${TEXT[language].room(currentRoom)} - ${TEXT[language].board}`);
}

function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(stateKey) || "{}") || {}; } catch {}
  chalkRemaining = Number.isFinite(saved.chalkRemaining) ? saved.chalkRemaining : CHALK_BUDGET;
  chalkKind = CHALK_KINDS.includes(saved.chalkKind) ? saved.chalkKind : "normal";
  color = COLORS.includes(saved.color) ? saved.color : color;
  if (chalkKind === "gold") color = GOLD;
  chalkRemaining = Math.max(0, Math.min(chalkRemaining, toolBudget()));
}

function toolBudget() { return chalkKind === "eraser" ? ERASER_BUDGET : CHALK_BUDGET; }

function saveState() {
  clearTimeout(stateSaveTimer);
  stateSaveTimer = 0;
  localStorage.setItem(stateKey, JSON.stringify({ chalkRemaining, color, chalkKind }));
}

function scheduleStateSave() {
  if (!stateSaveTimer) stateSaveTimer = setTimeout(saveState, 250);
}

async function waitForBoardLayout() {
  // WebKit can execute the module before the stylesheet establishes the canvas box.
  await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => {
    if (link.sheet) return Promise.resolve();
    return new Promise((resolve) => {
      link.addEventListener("load", resolve, { once: true });
      link.addEventListener("error", resolve, { once: true });
    });
  }));
  await new Promise(requestAnimationFrame);
}

function scheduleCanvasResize() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resizeCanvas(); });
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  boardBounds = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.floor(bounds.width), nextHeight = Math.floor(bounds.height);
  if (nextWidth <= 0 || nextHeight <= 0) return;
  if (nextWidth === width && nextHeight === height && nextRatio === pixelRatio) return;
  const hadBoard = width > 0 && height > 0;
  if (hadBoard) stopDrawing();
  pixelRatio = nextRatio;
  width = Math.floor(bounds.width);
  height = Math.floor(bounds.height);
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  dustCanvas.width = canvas.width;
  dustCanvas.height = canvas.height;
  dustCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  clearFallingDust();
  if (hadBoard) loadBoard();
}

function drawOpeningDust(context = ctx) {
  const ctx = context;
  ctx.save();
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 420; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 1.35;
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function loadBoard() {
  cancelAnimationFrame(replayFrame);
  replayFrame = 0;
  for (const [id, stroke] of optimisticStrokes) {
    if (stroke.day !== dayKey) optimisticStrokes.delete(id);
  }
  const generation = ++boardLoadId;
  polling = false;
  pollAgain = false;
  clearTimeout(pollTimer);
  boardCursor = 0;
  sharedStrokes = [];
  boardNeedsReplay = false;
  sharedStrokeIds.clear();
  renderedCount = 0;
  confirmedSurface = document.createElement("canvas");
  confirmedSurface.width = canvas.width;
  confirmedSurface.height = canvas.height;
  confirmedContext = confirmedSurface.getContext("2d");
  confirmedContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  confirmedContext.lineCap = "round";
  confirmedContext.lineJoin = "round";
  drawOpeningDust(confirmedContext);
  seenStrokes.clear();
  pendingStrokes.forEach((stroke) => seenStrokes.add(stroke.strokeId));
  loadingBoard = true;
  initialHistoryComplete = false;
  canvas.setAttribute("aria-busy", "true");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(confirmedSurface, 0, 0, width, height);
  pollBoard(generation);
  connectLive(true);
}

function requestBoardSync() {
  clearTimeout(pollTimer);
  if (polling) { pollAgain = true; return; }
  pollBoard(boardLoadId);
}

async function pollBoard(generation) {
  if (polling) { pollAgain = true; return; }
  polling = true;
  let delay = document.hidden || liveSocket?.readyState === 1 ? 30000 : SYNC_INTERVAL;
  try {
    const response = await fetch(`/api/board?room=${currentRoom}&after=${boardCursor}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Board unavailable");
    const data = await response.json();
    if (generation !== boardLoadId) return;
    if (data.day !== dayKey) {
      resetForNewDay(data.day);
      return;
    }
    data.strokes.forEach((stroke) => {
      if (!sharedStrokeIds.has(stroke.strokeId)) {
        sharedStrokes.push(stroke);
        sharedStrokeIds.add(stroke.strokeId);
        boardNeedsReplay = true;
      }
      seenStrokes.add(stroke.strokeId);
    });
    if (boardNeedsReplay) renderBoardView();
    boardCursor = data.cursor;
    if (!data.hasMore) {
      initialHistoryComplete = true;
      finishInitialBoard();
    }
    else delay = 0;
    syncFailed = false;
  } catch {
    if (generation !== boardLoadId) return;
    delay = 2000;
    if (!syncFailed) showNotice("syncError");
    syncFailed = true;
  }
  if (generation === boardLoadId) {
    polling = false;
    if (pollAgain) { pollAgain = false; delay = 0; }
    pollTimer = setTimeout(() => pollBoard(generation), delay);
  }
}

function finishInitialBoard() {
  if (!loadingBoard || !initialHistoryComplete || boardNeedsReplay || renderedCount !== sharedStrokes.length) return;
  // Publish only the complete initial state, never intermediate drawing/erasing history.
  compositeRegion({ left: 0, top: 0, right: width, bottom: height });
  loadingBoard = false;
  canvas.setAttribute("aria-busy", "false");
}

function connectLive(force = false) {
  const url = document.body?.dataset?.liveUrl;
  if (!url || typeof WebSocket === "undefined") return;
  if (!force && liveSocket && liveSocket.readyState < 2) return;
  clearTimeout(liveRetry);
  clearInterval(liveHeartbeat);
  if (liveSocket) { liveSocket.onclose = null; liveSocket.close(); }
  const room = currentRoom;
  const socket = new WebSocket(`${url}?room=${room}`);
  liveSocket = socket;
  socket.onopen = () => {
    if (socket !== liveSocket) return;
    liveAttempt = 0;
    requestBoardSync();
    liveHeartbeat = setInterval(() => { if (socket.readyState === 1) socket.send('{"action":"ping"}'); }, 60000);
  };
  socket.onmessage = (event) => {
    if (socket !== liveSocket || room !== currentRoom) return;
    try {
      const update = JSON.parse(event.data);
      if (update.type === "board" && String(update.room) === room &&
          (update.day !== dayKey || update.cursor > boardCursor)) requestBoardSync();
    } catch {}
  };
  socket.onclose = () => {
    if (socket !== liveSocket) return;
    clearInterval(liveHeartbeat);
    liveSocket = null;
    requestBoardSync();
    liveRetry = setTimeout(connectLive, Math.min(30000, 1000 * 2 ** Math.min(liveAttempt++, 5)) + Math.random() * 500);
  };
  socket.onerror = () => socket.close();
}

function drawSharedStroke(stroke) {
  drawStrokeOn(stroke, ctx, canvas);
}

function drawStrokeOn(stroke, context, surface) {
  const ctx = context;
  const points = stroke.points.map(([x, y]) => ({ x: x * width, y: y * height }));
  if (stroke.tool === "eraser") {
    if (points.length === 1) eraseChalk(points[0], points[0], ctx, surface);
    else points.slice(1).forEach((point, index) => eraseChalk(points[index], point, ctx, surface));
    return;
  }
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  // Chalk has one fixed CSS-pixel width, including strokes saved by older clients.
  ctx.lineWidth = CHALK_SIZE;
  ctx.globalAlpha = 0.78;
  ctx.beginPath();
  if (points.length === 1) {
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }
  ctx.restore();
}

function renderBoardView() {
  boardNeedsReplay = true;
  if (replayFrame) return;
  const generation = boardLoadId;
  let steps = null;
  let active = null;
  // Advance the confirmed layer once, even during input. Never restart accumulated history.
  function pump() {
    if (generation !== boardLoadId) return;
    const start = performance.now();
    let dirty = null;
    for (let count = 0; count < 64 && performance.now() - start < 4; count += 1) {
      if (!active && renderedCount < sharedStrokes.length) {
        active = sharedStrokes[renderedCount];
        steps = strokeSteps(active);
      }
      if (!active) {
        if (dirty && !loadingBoard) compositeRegion(dirty);
        boardNeedsReplay = false;
        replayFrame = 0;
        finishInitialBoard();
        return;
      }
      if (steps.next().done) {
        renderedCount++;
        optimisticStrokes.delete(active.strokeId);
        const bounds = strokeBounds(active);
        dirty = dirty ? { left: Math.min(dirty.left, bounds.left), top: Math.min(dirty.top, bounds.top),
          right: Math.max(dirty.right, bounds.right), bottom: Math.max(dirty.bottom, bounds.bottom) } : bounds;
        active = null;
      }
    }
    if (dirty && !loadingBoard) compositeRegion(dirty);
    replayFrame = requestAnimationFrame(pump);
  }
  replayFrame = requestAnimationFrame(pump);
}

function* strokeSteps(stroke) {
  if (stroke.tool !== "eraser") {
    drawStrokeOn(stroke, confirmedContext, confirmedSurface);
    return;
  }
  for (let i = 0; i < Math.max(1, stroke.points.length - 1); i++) {
    const [x, y] = stroke.points[i];
    const [nx, ny] = stroke.points[i + 1] || stroke.points[i];
    eraseChalk({x:x * width,y:y * height}, {x:nx * width,y:ny * height}, confirmedContext, confirmedSurface);
    yield;
  }
}

function strokeBounds(stroke) {
  let left = width, top = height, right = 0, bottom = 0;
  for (const [x, y] of stroke.points) {
    left = Math.min(left, x * width); right = Math.max(right, x * width);
    top = Math.min(top, y * height); bottom = Math.max(bottom, y * height);
  }
  const pad = stroke.tool === "eraser" ? ERASER_SIZE + 8 : CHALK_SIZE + 2;
  return { left: Math.max(0, Math.floor(left - pad)), top: Math.max(0, Math.floor(top - pad)),
    right: Math.min(width, Math.ceil(right + pad)), bottom: Math.min(height, Math.ceil(bottom + pad)) };
}

function compositeRegion(rect) {
  const {left, top, right, bottom} = rect;
  if (right <= left || bottom <= top) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  ctx.clearRect(left, top, right - left, bottom - top);
  ctx.drawImage(confirmedSurface, left * pixelRatio, top * pixelRatio, (right - left) * pixelRatio,
    (bottom - top) * pixelRatio, left, top, right - left, bottom - top);
  for (const stroke of [...optimisticStrokes.values(), ...(currentStroke ? [currentStroke] : [])]) {
    if (stroke.day !== dayKey || String(stroke.room) !== currentRoom) continue;
    const bounds = strokeBounds(stroke);
    if (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom) drawSharedStroke(stroke);
  }
  ctx.restore();
}

function eraseChalk(from, to, context = ctx, surface = canvas) {
  const ctx = context;
  const canvas = surface;
  const padding = ERASER_SIZE;
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.min(from.x, to.x) - padding, Math.min(from.y, to.y) - padding,
    Math.abs(to.x - from.x) + padding * 2, Math.abs(to.y - from.y) + padding * 2);
  ctx.clip();
  // Blur the existing pigment before lifting a little of it on each pass.
  ctx.globalCompositeOperation = "copy";
  ctx.globalAlpha = 1;
  ctx.filter = "blur(1px)";
  // Include a blur halo, but never filter the full high-DPI canvas for a small eraser.
  const left = Math.max(0, Math.floor((Math.min(from.x, to.x) - padding - 4) * pixelRatio));
  const top = Math.max(0, Math.floor((Math.min(from.y, to.y) - padding - 4) * pixelRatio));
  const right = Math.min(canvas.width, Math.ceil((Math.max(from.x, to.x) + padding + 4) * pixelRatio));
  const bottom = Math.min(canvas.height, Math.ceil((Math.max(from.y, to.y) + padding + 4) * pixelRatio));
  if (right > left && bottom > top) {
    if (!eraserPatch) eraserPatch = document.createElement("canvas");
    const patchWidth = right - left, patchHeight = bottom - top;
    if (eraserPatch.width !== patchWidth) eraserPatch.width = patchWidth;
    if (eraserPatch.height !== patchHeight) eraserPatch.height = patchHeight;
    const patchContext = eraserPatch.getContext("2d");
    patchContext.clearRect(0, 0, patchWidth, patchHeight);
    patchContext.drawImage(canvas, left, top, patchWidth, patchHeight, 0, 0, patchWidth, patchHeight);
    ctx.drawImage(eraserPatch, 0, 0, patchWidth, patchHeight,
      left / pixelRatio, top / pixelRatio, (right - left) / pixelRatio, (bottom - top) / pixelRatio);
  }
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = "blur(1px)";
  ctx.globalAlpha = 0.38;
  ctx.lineWidth = ERASER_SIZE;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    ctx.arc(to.x, to.y, ERASER_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();
}

function normalizedPoint(point) {
  return [Math.max(0, Math.min(1, point.x / width)), Math.max(0, Math.min(1, point.y / height))];
}

function beginStroke(point, continuation = false) {
  strokeContinuation = continuation;
  strokeStartedAt = performance.now();
  currentStroke = {
    strokeId: crypto.randomUUID(), day: dayKey, room: Number(currentRoom), color,
    size: CHALK_SIZE / width, points: [normalizedPoint(point)],
    ...(chalkKind === "eraser" ? { tool: "eraser" } : {}),
  };
  clearTimeout(strokeTimer);
  strokeTimer = setTimeout(() => {
    if (drawing && currentStroke?.points.length > 1) queueStroke(true);
  }, STROKE_INTERVAL);
}

function queueStroke(continueDrawing = false) {
  if (!currentStroke) return;
  pendingStrokes.push(currentStroke);
  optimisticStrokes.set(currentStroke.strokeId, currentStroke);
  seenStrokes.add(currentStroke.strokeId);
  currentStroke = null;
  if (continueDrawing) {
    // Rainbow colors travel as ordinary strokes, without adding API calls or a new protocol.
    if (chalkKind === "rainbow") color = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
    beginStroke(lastPoint, true);
  }
  savePendingStrokes().catch(() => showNotice("syncError"));
  flushStrokes();
}

function outboxTransaction(strokes, removed = []) {
  if (!outbox) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const transaction = outbox.transaction("strokes", "readwrite");
    const store = transaction.objectStore("strokes");
    strokes.forEach((stroke) => store.put(stroke));
    removed.forEach((id) => store.delete(id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Outbox aborted"));
  });
}

async function restoreOutbox() {
  if (typeof indexedDB === "undefined") return;
  try {
    outbox = await new Promise((resolve, reject) => {
      const request = indexedDB.open("chillpan-outbox", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("strokes", { keyPath: "strokeId" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Outbox blocked"));
    });
    const stored = await new Promise((resolve, reject) => {
      const request = outbox.transaction("strokes").objectStore("strokes").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    pendingStrokes = [...new Map([...stored, ...pendingStrokes].filter((stroke) => stroke.day === dayKey)
      .map((stroke) => [stroke.strokeId, stroke])).values()];
    pendingStrokes.forEach((stroke) => optimisticStrokes.set(stroke.strokeId, stroke));
    await outboxTransaction(pendingStrokes, stored.filter((stroke) => stroke.day !== dayKey).map((stroke) => stroke.strokeId));
    sessionStorage.removeItem(`${STORAGE_PREFIX}:pending`);
  } catch {
    outbox = null;
    showNotice("syncError");
  }
}

function savePendingStrokes(removed = []) {
  if (!outbox) {
    try { sessionStorage.setItem(`${STORAGE_PREFIX}:pending`, JSON.stringify(pendingStrokes)); } catch {}
    return Promise.resolve();
  }
  const snapshot = pendingStrokes.slice();
  persistence = persistence.catch(() => {}).then(() => outboxTransaction(snapshot, removed));
  return persistence;
}

async function flushStrokes() {
  if (sendingStrokes) return;
  pendingStrokes = pendingStrokes.filter((stroke) => stroke.day === dayKey);
  if (!pendingStrokes.length) return;
  clearTimeout(retryTimer);
  sendingStrokes = true;
  const batch = pendingStrokes.slice(0, 32);
  let retry = false;
  try {
    await persistence;
    const body = JSON.stringify({ strokes: batch });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const response = await fetch("/api/board", {
      method: "POST", headers: { "Content-Type": "application/json", "x-amz-content-sha256": hash },
      body,
    });
    if (response.status === 409) {
      const data = await response.json();
      resetForNewDay(data.day);
    } else {
      if (!response.ok) throw new Error("Stroke not saved");
      const saved = new Set(batch.map((stroke) => stroke.strokeId));
      pendingStrokes = pendingStrokes.filter((stroke) => !saved.has(stroke.strokeId));
    }
    await savePendingStrokes(response.ok ? batch.map((stroke) => stroke.strokeId) : []);
    requestBoardSync();
  } catch {
    retry = true;
    if (!syncFailed) showNotice("syncError");
    syncFailed = true;
  } finally {
    sendingStrokes = false;
    if (pendingStrokes.length) retryTimer = setTimeout(flushStrokes, retry ? 2000 : 0);
  }
}

function startDrawing(event) {
  const bounds = canvas.getBoundingClientRect();
  boardBounds = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  showChalkCursor(event);
  if (loadingBoard || drawing) return;
  if (chalkRemaining <= 0) {
    showNotice(chalkKind === "eraser" ? "eraserGone" : "gone");
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  activePointerId = event.pointerId;
  drawing = true;
  lastPoint = getPoint(event);
  beginStroke(lastPoint);
  lastStrokeTime = performance.now();
  prepareChalkSound();
  if (chalkKind !== "eraser") {
    emitFallingDust(lastPoint, lastPoint, 4);
    placeChalkDust(lastPoint.x, lastPoint.y, CHALK_SIZE * 0.7);
  }
}

function schedulePointer(event) {
  pendingPointer = { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId };
  if (!inputFrame) inputFrame = requestAnimationFrame(() => {
    inputFrame = 0;
    const point = pendingPointer;
    pendingPointer = null;
    if (point) draw(point);
  });
}

function draw(event) {
  showChalkCursor(event);
  if (!drawing || event.pointerId !== activePointerId || !lastPoint || chalkRemaining <= 0) return;
  let point = getPoint(event);
  let distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  if (distance < 0.4) return;

  const rate = chalkKind === "eraser" ? 1 : CHALK_SIZE / 7;
  if (distance * rate > chalkRemaining) {
    const fraction = chalkRemaining / (distance * rate);
    point = { x: lastPoint.x + (point.x - lastPoint.x) * fraction, y: lastPoint.y + (point.y - lastPoint.y) * fraction };
    distance *= fraction;
  }
  const spend = Math.max(distance * rate, 0.7);
  chalkRemaining = Math.max(0, chalkRemaining - spend);
  if (chalkKind === "eraser") eraseChalk(lastPoint, point);
  else {
    drawChalkLine(lastPoint, point, CHALK_SIZE);
    emitFallingDust(lastPoint, point, Math.min(18, Math.max(2, Math.ceil(distance / 7))));
  }
  const now = performance.now();
  playChalkSound(distance / Math.max(8, now - lastStrokeTime));
  lastStrokeTime = now;
  lastPoint = point;
  currentStroke.points.push(normalizedPoint(point));
  if (currentStroke.points.length >= 64 || now - strokeStartedAt >= STROKE_INTERVAL) queueStroke(true);
  updateChalkCursor();
  scheduleStateSave();

  if (chalkRemaining <= 0) {
    stopDrawing(event);
    showNotice(chalkKind === "eraser" ? "eraserGone" : "finished");
  }
}

function stopDrawing() {
  cancelAnimationFrame(inputFrame);
  inputFrame = 0;
  const point = pendingPointer;
  pendingPointer = null;
  if (point && drawing && chalkRemaining > 0) draw(point);
  clearTimeout(strokeTimer);
  stopChalkSound();
  saveState();
  if (!drawing) return;
  if (chalkKind === "eraser" && currentStroke?.points.length === 1 && !strokeContinuation) {
    eraseChalk(lastPoint, lastPoint);
    chalkRemaining = Math.max(0, chalkRemaining - 12);
    saveState();
    updateChalkCursor();
  }
  drawing = false;
  if (strokeContinuation && currentStroke?.points.length === 1) currentStroke = null;
  queueStroke();
  lastPoint = null;
  if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
  if (boardNeedsReplay && !loadingBoard) renderBoardView();
}

function emitFallingDust(from, to, count) {
  for (let i = 0; i < count; i += 1) {
    if (particles.length >= 240) particles.shift();
    const t = Math.random();
    const life = 0.7 + Math.random() * 0.7;
    particles.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      vx: (Math.random() - 0.5) * 45,
      vy: 12 + Math.random() * 40,
      size: 0.7 + Math.random() * 1.7,
      life,
      duration: life,
      color: chalkKind === "rainbow" ? COLORS[Math.floor(Math.random() * COLORS.length)] : color,
    });
  }
  if (!dustFrame) {
    lastDustTime = performance.now();
    dustFrame = requestAnimationFrame(animateFallingDust);
  }
}

function animateFallingDust(now) {
  const elapsed = Math.min((now - lastDustTime) / 1000, 0.04);
  lastDustTime = now;
  dustCtx.clearRect(0, 0, width, height);
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= elapsed;
    if (particle.life <= 0 || particle.y > height) {
      particles.splice(i, 1);
      continue;
    }
    particle.vy += 160 * elapsed;
    particle.x += particle.vx * elapsed;
    particle.y += particle.vy * elapsed;
    dustCtx.globalAlpha = Math.min(0.75, particle.life / particle.duration);
    dustCtx.fillStyle = particle.color;
    dustCtx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  dustCtx.globalAlpha = 1;
  dustFrame = particles.length ? requestAnimationFrame(animateFallingDust) : 0;
}

function clearFallingDust() {
  cancelAnimationFrame(dustFrame);
  dustFrame = 0;
  particles.length = 0;
  dustCtx.clearRect(0, 0, width, height);
}

function prepareChalkSound() {
  if (!soundEnabled) return;
  try {
    if (!chalkAudio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.8;
      const gain = context.createGain();
      gain.gain.value = 0;
      noise.connect(filter).connect(gain).connect(context.destination);
      noise.start();
      chalkAudio = { context, filter, gain };
    }
    if (chalkAudio.context.state === "suspended") chalkAudio.context.resume().catch(() => {});
  } catch {
    // Drawing remains available when a browser cannot initialize audio.
    chalkAudio = null;
  }
}

function playChalkSound(speed) {
  if (!soundEnabled || !chalkAudio) return;
  const { context, filter, gain } = chalkAudio;
  const intensity = Math.min(1, speed / 1.8);
  const now = context.currentTime;
  filter.frequency.setTargetAtTime(1100 + intensity * 1700 + Math.random() * 200, now, 0.025);
  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(0.07 + intensity * 0.11, now, 0.012);
  clearTimeout(soundStopTimer);
  soundStopTimer = setTimeout(stopChalkSound, 90);
}

function stopChalkSound() {
  clearTimeout(soundStopTimer);
  if (!chalkAudio) return;
  const { context, gain } = chalkAudio;
  gain.gain.cancelScheduledValues(context.currentTime);
  gain.gain.setTargetAtTime(0, context.currentTime, 0.015);
}

function stopDiscoverySound() {
  for (const { oscillator, gain } of discoveryNotes) {
    gain.disconnect();
    try { oscillator.stop(); } catch { /* Already completed. */ }
  }
  discoveryNotes = [];
}

function playDiscoverySound() {
  if (!soundEnabled) return;
  prepareChalkSound();
  if (!chalkAudio) return;
  stopDiscoverySound();
  try {
    const { context } = chalkAudio;
    const start = context.currentTime + 0.04;
    // Three rising brass-like notes: pa-ra-bam, with a longer final chord.
    for (const [offset, duration, frequencies] of [[0, 0.14, [392]], [0.16, 0.14, [523.25]], [0.32, 0.65, [523.25, 659.25, 783.99]]]) {
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start + offset);
        gain.gain.linearRampToValueAtTime(0.09 / frequencies.length, start + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, start + offset + duration);
        oscillator.connect(gain).connect(context.destination);
        const note = { oscillator, gain };
        discoveryNotes.push(note);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          discoveryNotes = discoveryNotes.filter((active) => active !== note);
        };
        oscillator.start(start + offset);
        oscillator.stop(start + offset + duration + 0.02);
      }
    }
  } catch {
    stopDiscoverySound();
  }
}

function getPoint(event) {
  return {
    x: (event.clientX - boardBounds.left) * (boardBounds.width > 0 ? width / boardBounds.width : 1),
    y: (event.clientY - boardBounds.top) * (boardBounds.height > 0 ? height / boardBounds.height : 1),
  };
}

function drawChalkLine(from, to, size) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.globalAlpha = 0.78;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const flecks = Math.min(24, Math.ceil(distance / 3));
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < flecks; i += 1) {
    const t = Math.random();
    const x = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * size * 1.6;
    const y = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * size * 1.6;
    placeChalkDust(x, y, Math.random() * size * 0.38);
  }
  ctx.restore();
}

function placeChalkDust(x, y, radius) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.42 + Math.random() * 0.22;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(radius, 0.6), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function updateChalkCursor() {
  const cursorScale = Math.max(0, Math.min(1, chalkRemaining / toolBudget()));
  const height = `${Math.round(chalkKind === "eraser" ? 10 + 20 * cursorScale : 13 + (chalkKind === "king" ? 126 : 81) * cursorScale)}px`;
  const cursorWidth = chalkKind === "eraser" ? "48px" : chalkKind === "king" ? "26px" : "15px";
  if (cursorAppearance.color !== color) document.documentElement.style.setProperty("--chalk", color);
  if (cursorAppearance.height !== height) chalkCursor.style.height = height;
  if (cursorAppearance.width !== cursorWidth) chalkCursor.style.width = cursorWidth;
  if (cursorAppearance.kind !== chalkKind) document.documentElement.dataset.chalkKind = chalkKind;
  cursorAppearance = { color, height, width: cursorWidth, kind: chalkKind };
  chalkCursor.classList.toggle("is-spent", chalkRemaining <= 0);
  if (cursorPoint) moveChalkCursor(cursorPoint);
}

function pickNewChalk() {
  stopDrawing();
  chalkKind = rollChalkKind();
  const choices = COLORS.filter((candidate) => candidate !== color);
  color = chalkKind === "gold" ? GOLD : choices[Math.floor(Math.random() * choices.length)];
  chalkRemaining = toolBudget();
  saveState();
  updateChalkCursor();
  showNotice(({ rainbow: "hiddenRainbow", gold: "hiddenGold", king: "hiddenKing", eraser: "hiddenEraser" })[chalkKind] || "chalkReady");
}

function rollChalkKind(roll = Math.random()) {
  if (roll < 0.01) return "gold";
  if (roll < 0.04) return "rainbow";
  if (roll < 0.06) return "king";
  if (roll < 0.08) return "eraser";
  return "normal";
}

function tick() {
  const currentDay = getDayKey();
  if (currentDay !== dayKey) resetForNewDay(currentDay);
}

function resetForNewDay(nextDayKey) {
  stopDrawing();
  dayKey = nextDayKey;
  stateKey = `${STORAGE_PREFIX}:state:${dayKey}`;
  chalkRemaining = CHALK_BUDGET;
  chalkKind = "normal";
  color = COLORS[Math.floor(Math.random() * COLORS.length)];
  pendingStrokes = pendingStrokes.filter((stroke) => stroke.day === dayKey);
  savePendingStrokes();
  loadBoard();
  clearFallingDust();
  saveState();
  updateChalkCursor();
  showNotice("newDay");
}

function applyLanguage() {
  const text = TEXT[language];
  document.documentElement.lang = language;
  document.querySelector('meta[name="description"]').content = text.description;
  canvas.setAttribute("aria-label", text.board);
  roomSelect.setAttribute("aria-label", text.rooms);
  [...roomSelect.options].forEach((option) => { option.textContent = text.room(option.value); });
  document.querySelector("#soundLabel").textContent = text.sound;
  const feedbackButton = document.querySelector("#feedbackButton");
  feedbackButton.setAttribute("aria-label", text.feedback);
  feedbackButton.title = text.feedback;
  notice.textContent = text[noticeKey];
  document.querySelector("#newChalkLabel").textContent = text.newChalk;
  newChalkButton.setAttribute("aria-label", text.newChalk);
}

function showNotice(key) {
  noticeKey = key;
  const hidden = key.startsWith("hidden");
  notice.classList.toggle("is-hidden-find", hidden);
  if (hidden) {
    playDiscoverySound();
    const words = TEXT[language][key].split(" ");
    notice.replaceChildren(...words.map((word, index) => {
      const span = document.createElement("span");
      span.textContent = word;
      span.style.color = COLORS[index % COLORS.length];
      return span;
    }));
  } else notice.textContent = TEXT[language][key];
  notice.classList.remove("is-hidden");
  clearTimeout(showNotice.timeout);
  showNotice.timeout = setTimeout(softenNotice, hidden ? 8000 : 3200);
}

function softenNotice() {
  notice.classList.add("is-hidden");
}

function showChalkCursor(event) {
  moveChalkCursor(event);
  chalkCursor.classList.add("is-visible");
}

function hideChalkCursor() {
  chalkCursor.classList.remove("is-visible");
}

function moveChalkCursor(event) {
  cursorPoint = { clientX: event.clientX, clientY: event.clientY };
  const halfWidth = chalkKind === "eraser" ? 24 : chalkKind === "king" ? 13 : 7.5;
  chalkCursor.style.transform = `translate3d(${event.clientX - halfWidth}px, ${event.clientY}px, 0) rotate(${chalkKind === "eraser" ? -12 : -45}deg)`;
}
