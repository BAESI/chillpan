const canvas = document.querySelector("#chalkboard");
const ctx = canvas.getContext("2d", { alpha: true });
const chalkCursor = document.querySelector("#chalkCursor");
const notice = document.querySelector("#notice");
const newChalkButton = document.querySelector("#newChalkButton");

const CHALK_BUDGET = 8800;
const CHALK_SIZE = 5;
const STORAGE_PREFIX = "chillpan";
const COLORS = ["#f28eaa", "#82d9ad", "#85bdf3", "#f1d46f", "#c6a0ee", "#f5ad7c"];
const TEXT = {
  ko: {
    description: "색색의 분필로 함께 흔적을 남기는 하루짜리 칠판 Chillpan.",
    board: "함께 그리는 칠판",
    tray: "분필 받침대",
    welcome: "오늘의 분필로 흔적을 남겨요",
    gone: "분필을 다 썼어요. 새 분필을 뽑아주세요.",
    finished: "분필을 다 썼어요. 새 분필로 이어 그릴 수 있어요.",
    newDay: "자정이 되어 새로운 칠판이 열렸어요.",
    newChalk: "새 분필",
    chalkReady: "새 분필을 뽑았어요.",
  },
  en: {
    description: "Chillpan is a shared daily chalkboard for leaving traces in colorful chalk.",
    board: "Global chalkboard drawing surface",
    tray: "Chalk tray",
    welcome: "leave a trace with today's chalk",
    gone: "your chalk is gone. pick a new piece.",
    finished: "the chalk is finished. pick a new piece to keep drawing.",
    newDay: "a new board opened at midnight.",
    newChalk: "New chalk",
    chalkReady: "a fresh piece of chalk is yours.",
  },
};

const language = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
let noticeKey = "welcome";

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
  applyLanguage();
  newChalkButton.addEventListener("click", pickNewChalk);
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
    showNotice("gone");
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
    showNotice("finished");
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

function pickNewChalk() {
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
  dayKey = nextDayKey;
  boardKey = `${STORAGE_PREFIX}:board:${dayKey}`;
  stateKey = `${STORAGE_PREFIX}:state:${dayKey}`;
  chalkRemaining = CHALK_BUDGET;
  color = COLORS[Math.floor(Math.random() * COLORS.length)];
  ctx.clearRect(0, 0, width, height);
  drawOpeningDust();
  saveState();
  updateChalkCursor();
  showNotice("newDay");
}

function applyLanguage() {
  const text = TEXT[language];
  document.documentElement.lang = language;
  document.querySelector('meta[name="description"]').content = text.description;
  canvas.setAttribute("aria-label", text.board);
  document.querySelector(".chalk-tray").setAttribute("aria-label", text.tray);
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
