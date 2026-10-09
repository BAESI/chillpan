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
const SYNC_INTERVAL = Math.max(750, Number(document.body?.dataset?.syncMs) || 750);
const STROKE_INTERVAL = Math.max(120, Number(document.body?.dataset?.strokeMs) || 120);
const STORAGE_PREFIX = "chillpan";
const COLORS = ["#f28eaa", "#82d9ad", "#85bdf3", "#f1d46f", "#c6a0ee", "#f5ad7c"];
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
let drawing = false;
let activePointerId = null;
let loadingBoard = false;
let boardLoadId = 0;
let lastPoint = null;
let chalkRemaining = CHALK_BUDGET;
let color = COLORS[Math.floor(Math.random() * COLORS.length)];
let boardCursor = 0;
let pollTimer = 0;
let sendingStrokes = false;
let retryTimer = 0;
let currentStroke = null;
let strokeStartedAt = 0;
let syncFailed = false;
let pendingStrokes = [];
try { pendingStrokes = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}:pending`) || "[]"); } catch {}
if (!Array.isArray(pendingStrokes)) pendingStrokes = [];
pendingStrokes = pendingStrokes.filter((stroke) => stroke.day === dayKey);
const seenStrokes = new Set(pendingStrokes.map((stroke) => stroke.strokeId));
let lastStrokeTime = 0;
let dustFrame = 0;
let lastDustTime = 0;
const particles = [];
let soundEnabled = localStorage.getItem(`${STORAGE_PREFIX}:sound`) !== "off";
let chalkAudio = null;
let soundStopTimer = 0;

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
    else stopChalkSound();
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
  const saved = JSON.parse(localStorage.getItem(stateKey) || "{}");
  chalkRemaining = Number.isFinite(saved.chalkRemaining) ? saved.chalkRemaining : CHALK_BUDGET;
  color = COLORS.includes(saved.color) ? saved.color : color;
}

function saveState() {
  localStorage.setItem(stateKey, JSON.stringify({ chalkRemaining, color }));
}

function resizeCanvas() {
  const hadBoard = width > 0 && height > 0;
  if (hadBoard) stopDrawing();

  const bounds = canvas.getBoundingClientRect();
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

function drawOpeningDust() {
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
  const generation = ++boardLoadId;
  clearTimeout(pollTimer);
  boardCursor = 0;
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
    data.strokes.forEach((stroke) => {
      if (!seenStrokes.has(stroke.strokeId)) drawSharedStroke(stroke);
      seenStrokes.add(stroke.strokeId);
    });
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
  const points = stroke.points.map(([x, y]) => ({ x: x * width, y: y * height }));
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

function normalizedPoint(point) {
  return [Math.max(0, Math.min(1, point.x / width)), Math.max(0, Math.min(1, point.y / height))];
}

function beginStroke(point) {
  strokeStartedAt = performance.now();
  currentStroke = {
    strokeId: crypto.randomUUID(), day: dayKey, room: Number(currentRoom), color,
    size: CHALK_SIZE / width, points: [normalizedPoint(point)],
  };
}

function queueStroke(continueDrawing = false) {
  if (!currentStroke) return;
  pendingStrokes.push(currentStroke);
  seenStrokes.add(currentStroke.strokeId);
  currentStroke = null;
  if (continueDrawing) beginStroke(lastPoint);
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
  moveChalkCursor(event);
  if (loadingBoard || drawing) return;
  if (chalkRemaining <= 0) {
    showNotice("gone");
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  activePointerId = event.pointerId;
  drawing = true;
  lastPoint = getPoint(event);
  beginStroke(lastPoint);
  lastStrokeTime = performance.now();
  prepareChalkSound();
  emitFallingDust(lastPoint, lastPoint, 4);
  placeChalkDust(lastPoint.x, lastPoint.y, CHALK_SIZE * 0.7);
}

function draw(event) {
  moveChalkCursor(event);
  if (!drawing || event.pointerId !== activePointerId || !lastPoint || chalkRemaining <= 0) return;
  const point = getPoint(event);
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  if (distance < 0.4) return;

  const spend = Math.max(distance * (CHALK_SIZE / 7), 0.7);
  chalkRemaining = Math.max(0, chalkRemaining - spend);
  drawChalkLine(lastPoint, point, CHALK_SIZE);
  emitFallingDust(lastPoint, point, Math.min(18, Math.max(2, Math.ceil(distance / 7))));
  const now = performance.now();
  playChalkSound(distance / Math.max(8, now - lastStrokeTime));
  lastStrokeTime = now;
  lastPoint = point;
  currentStroke.points.push(normalizedPoint(point));
  if (currentStroke.points.length >= 64 || now - strokeStartedAt >= STROKE_INTERVAL) queueStroke(true);
  updateChalkCursor();
  saveState();

  if (chalkRemaining <= 0) {
    stopDrawing(event);
    showNotice("finished");
  }
}

function stopDrawing() {
  stopChalkSound();
  if (!drawing) return;
  drawing = false;
  queueStroke();
  lastPoint = null;
  if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
    canvas.releasePointerCapture(activePointerId);
  }
  activePointerId = null;
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
      color,
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

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
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
  const flecks = Math.ceil(distance / 3);
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
  const cursorScale = Math.max(0, Math.min(1, chalkRemaining / CHALK_BUDGET));
  document.documentElement.style.setProperty("--chalk", color);
  chalkCursor.style.height = `${13 + 81 * cursorScale}px`;
  chalkCursor.classList.toggle("is-spent", chalkRemaining <= 0);
}

function pickNewChalk() {
  stopDrawing();
  const choices = COLORS.filter((candidate) => candidate !== color);
  color = choices[Math.floor(Math.random() * choices.length)];
  chalkRemaining = CHALK_BUDGET;
  saveState();
  updateChalkCursor();
  showNotice("chalkReady");
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
  notice.textContent = TEXT[language][key];
  notice.classList.remove("is-hidden");
  clearTimeout(showNotice.timeout);
  showNotice.timeout = setTimeout(softenNotice, 3200);
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
  chalkCursor.style.transform = `translate3d(${event.clientX - 7.5}px, ${event.clientY}px, 0) rotate(-45deg)`;
}
