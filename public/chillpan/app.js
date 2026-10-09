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
let currentRoom = localStorage.getItem(`${STORAGE_PREFIX}:room`) || "1";
if (!["1", "2", "3"].includes(currentRoom)) currentRoom = "1";
let stateKey = `${STORAGE_PREFIX}:state:${dayKey}`;
let width = 0;
let height = 0;
let pixelRatio = 1;
let boardBounds = { left: 0, top: 0 };
let replayFrame = 0;
let replayRevision = 0;
let localPaintVersion = 0;
let drawing = false;
let activePointerId = null;
let loadingBoard = false;
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

init();

function init() {
  applyLanguage();
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
  resizeCanvas();
  loadBoard();
  updateRoomSelection();
  updateChalkCursor();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("online", () => { flushStrokes(); });
  canvas.addEventListener("pointerdown", startDrawing);
  canvas.addEventListener("pointermove", draw);
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
    }
  });
  setInterval(tick, 1000);
  flushStrokes();
  requestAnimationFrame(softenNotice);
}

function getDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function switchRoom(room) {
  if (room === currentRoom) return;
  stopDrawing();
  currentRoom = room;
  localStorage.setItem(`${STORAGE_PREFIX}:room`, currentRoom);
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

function resizeCanvas() {
  const hadBoard = width > 0 && height > 0;
  if (hadBoard) stopDrawing();

  const bounds = canvas.getBoundingClientRect();
  boardBounds = { left: bounds.left, top: bounds.top };
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
  replayRevision += 1;
  for (const [id, stroke] of optimisticStrokes) {
    if (stroke.day !== dayKey) optimisticStrokes.delete(id);
  }
  const generation = ++boardLoadId;
  clearTimeout(pollTimer);
  boardCursor = 0;
  sharedStrokes = [];
  boardNeedsReplay = false;
  sharedStrokeIds.clear();
  seenStrokes.clear();
  pendingStrokes.forEach((stroke) => seenStrokes.add(stroke.strokeId));
  loadingBoard = true;
  canvas.setAttribute("aria-busy", "true");
  ctx.clearRect(0, 0, width, height);
  drawOpeningDust();
  pendingStrokes.filter((stroke) => stroke.day === dayKey && String(stroke.room) === currentRoom).forEach(drawSharedStroke);
  pollBoard(generation);
}

async function pollBoard(generation) {
  let delay = document.hidden ? Math.max(4000, SYNC_INTERVAL * 10) : SYNC_INTERVAL;
  try {
    const response = await fetch(`/api/board?room=${currentRoom}&after=${boardCursor}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Board unavailable");
    const data = await response.json();
    if (generation !== boardLoadId) return;
    if (data.day !== dayKey) {
      resetForNewDay(data.day);
      return;
    }
    // Append only when the visible canvas is already in server order.
    const canAppend = !loadingBoard && !boardNeedsReplay && !drawing && !currentStroke &&
      !pendingStrokes.length && seenStrokes.size === sharedStrokeIds.size &&
      data.strokes.length <= 8 && !data.strokes.some((stroke) => stroke.tool === "eraser");
    data.strokes.forEach((stroke) => {
      if (!sharedStrokeIds.has(stroke.strokeId)) {
        sharedStrokes.push(stroke);
        sharedStrokeIds.add(stroke.strokeId);
        if (canAppend) drawSharedStroke(stroke);
        else boardNeedsReplay = true;
      }
      seenStrokes.add(stroke.strokeId);
      optimisticStrokes.delete(stroke.strokeId);
    });
    if (!data.hasMore && (loadingBoard || boardNeedsReplay)) {
      if (drawing) boardNeedsReplay = true;
      else renderBoardView();
    }
    boardCursor = data.cursor;
    if (!data.hasMore) {
      loadingBoard = false;
      canvas.setAttribute("aria-busy", "false");
    }
    else delay = 0;
    syncFailed = false;
  } catch {
    if (generation !== boardLoadId) return;
    delay = 2000;
    if (!syncFailed) showNotice("syncError");
    syncFailed = true;
  }
  if (generation === boardLoadId) pollTimer = setTimeout(() => pollBoard(generation), delay);
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

function* boardReplaySteps(strokes, context, surface) {
  drawOpeningDust(context);
  for (const stroke of strokes) {
    if (stroke.tool !== "eraser") {
      drawStrokeOn(stroke, context, surface);
      yield;
      continue;
    }
    for (let i = 0; i < Math.max(1, stroke.points.length - 1); i += 1) {
      const [x, y] = stroke.points[i];
      const [nextX, nextY] = stroke.points[i + 1] || stroke.points[i];
      eraseChalk({ x: x * width, y: y * height }, { x: nextX * width, y: nextY * height }, context, surface);
      yield;
    }
  }
}

function renderBoardView() {
  boardNeedsReplay = true;
  cancelAnimationFrame(replayFrame);
  const revision = ++replayRevision;
  const generation = boardLoadId;
  const paintVersion = localPaintVersion;
  const sharedCount = sharedStrokes.length;
  const surface = document.createElement("canvas");
  surface.width = canvas.width;
  surface.height = canvas.height;
  const context = surface.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineCap = "round";
  context.lineJoin = "round";
  const local = [...optimisticStrokes.values()].filter((stroke) =>
    stroke.day === dayKey && String(stroke.room) === currentRoom && !sharedStrokeIds.has(stroke.strokeId));
  const steps = boardReplaySteps([...sharedStrokes, ...local], context, surface);
  // Build out of view in short slices, then swap once. Never block pointer-up with history replay.
  function pump() {
    if (revision !== replayRevision || generation !== boardLoadId) return;
    if (drawing) { replayFrame = requestAnimationFrame(pump); return; }
    if (paintVersion !== localPaintVersion || sharedCount !== sharedStrokes.length) {
      renderBoardView();
      return;
    }
    const start = performance.now();
    for (let count = 0; count < 64 && performance.now() - start < 4; count += 1) {
      if (steps.next().done) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(surface, 0, 0, canvas.width, canvas.height, 0, 0, width, height);
        boardNeedsReplay = false;
        replayFrame = 0;
        return;
      }
    }
    replayFrame = requestAnimationFrame(pump);
  }
  replayFrame = requestAnimationFrame(pump);
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
    ctx.drawImage(canvas, left, top, right - left, bottom - top,
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
  localPaintVersion += 1;
  strokeContinuation = continuation;
  strokeStartedAt = performance.now();
  currentStroke = {
    strokeId: crypto.randomUUID(), day: dayKey, room: Number(currentRoom), color,
    size: CHALK_SIZE / width, points: [normalizedPoint(point)],
    ...(chalkKind === "eraser" ? { tool: "eraser" } : {}),
  };
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
  savePendingStrokes();
  flushStrokes();
}

function savePendingStrokes() {
  sessionStorage.setItem(`${STORAGE_PREFIX}:pending`, JSON.stringify(pendingStrokes));
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
    savePendingStrokes();
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
  boardBounds = { left: bounds.left, top: bounds.top };
  moveChalkCursor(event);
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

function draw(event) {
  moveChalkCursor(event);
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
    x: event.clientX - boardBounds.left,
    y: event.clientY - boardBounds.top,
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
