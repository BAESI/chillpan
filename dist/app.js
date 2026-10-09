const canvas = document.querySelector("#chalkboard");
const ctx = canvas.getContext("2d", { alpha: true });
const chalkCursor = document.querySelector("#chalkCursor");
const notice = document.querySelector("#notice");

const CHALK_BUDGET = 8800;
const CHALK_SIZE = 5;
const STORAGE_PREFIX = "chillpan";
const COLORS = ["#eeeadd", "#dbe8d2", "#f0d1d4", "#ccdced", "#eadfb8"];

let dayKey = getDayKey();
let boardKey = `${STORAGE_PREFIX}:board:${dayKey}`;
let stateKey = `${STORAGE_PREFIX}:state:${dayKey}`;
let width = 0;
let height = 0;
let pixelRatio = 1;
let drawing = false;
let lastPoint = null;
let chalkRemaining = CHALK_BUDGET;
let color = COLORS[Math.floor(Math.random() * COLORS.length)];
let lastSavedAt = 0;

init();

function init() {
  loadState();
  saveState();
  resizeCanvas();
  drawOpeningDust();
  loadBoard();
  updateChalkCursor();
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("storage", handleStorageSync);
  canvas.addEventListener("pointerdown", startDrawing);
  canvas.addEventListener("pointermove", draw);
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  canvas.addEventListener("pointerenter", showChalkCursor);
  canvas.addEventListener("pointerleave", hideChalkCursor);
  setInterval(tick, 1000);
  requestAnimationFrame(softenNotice);
}

function getDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const previous = document.createElement("canvas");
  previous.width = canvas.width;
  previous.height = canvas.height;
  previous.getContext("2d").drawImage(canvas, 0, 0);

  const bounds = canvas.getBoundingClientRect();
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = Math.floor(bounds.width);
  height = Math.floor(bounds.height);
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.drawImage(previous, 0, 0, width, height);
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
  const src = localStorage.getItem(boardKey);
  if (!src) return;
  const image = new Image();
  image.onload = () => {
    ctx.drawImage(image, 0, 0, width, height);
  };
  image.src = src;
}

function persistBoard() {
  const now = Date.now();
  if (now - lastSavedAt < 600) return;
  lastSavedAt = now;
  localStorage.setItem(boardKey, canvas.toDataURL("image/png"));
}

function handleStorageSync(event) {
  if (event.key !== boardKey || !event.newValue) return;
  const image = new Image();
  image.onload = () => ctx.drawImage(image, 0, 0, width, height);
  image.src = event.newValue;
}

function startDrawing(event) {
  moveChalkCursor(event);
  if (chalkRemaining <= 0) {
    showNotice("today's chalk is gone. come back after midnight.");
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  lastPoint = getPoint(event);
  placeChalkDust(lastPoint.x, lastPoint.y, CHALK_SIZE * 0.7);
}

function draw(event) {
  moveChalkCursor(event);
  if (!drawing || !lastPoint || chalkRemaining <= 0) return;
  const point = getPoint(event);
  const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  if (distance < 0.4) return;

  const spend = Math.max(distance * (CHALK_SIZE / 7), 0.7);
  chalkRemaining = Math.max(0, chalkRemaining - spend);
  drawChalkLine(lastPoint, point, CHALK_SIZE);
  lastPoint = point;
  updateChalkCursor();
  saveState();
  persistBoard();

  if (chalkRemaining <= 0) {
    stopDrawing(event);
    showNotice("the chalk is finished. your trace stays until midnight.");
  }
}

function stopDrawing(event) {
  if (!drawing) return;
  drawing = false;
  lastPoint = null;
  if (event?.pointerId !== undefined) canvas.releasePointerCapture(event.pointerId);
  persistBoard();
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

function tick() {
  const currentDay = getDayKey();
  if (currentDay !== dayKey) resetForNewDay(currentDay);
}

function resetForNewDay(nextDayKey) {
  dayKey = nextDayKey;
  boardKey = `${STORAGE_PREFIX}:board:${dayKey}`;
  stateKey = `${STORAGE_PREFIX}:state:${dayKey}`;
  chalkRemaining = CHALK_BUDGET;
  color = COLORS[Math.floor(Math.random() * COLORS.length)];
  ctx.clearRect(0, 0, width, height);
  drawOpeningDust();
  saveState();
  updateChalkCursor();
  showNotice("a new board opened at midnight.");
}

function showNotice(message) {
  notice.textContent = message;
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
