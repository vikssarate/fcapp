/* Flash Cards + Pencil Pad
   - Front: question image on top + canvas pad
   - Back : solution image
   - Double-tap anywhere flips card
   - Notes persist per card in localStorage
*/
const $ = (sel) => document.querySelector(sel);

const state = {
  cards: [],
  idx: 0,
  pen: { size: 3, erasing: false },
  strokes: [],
  redoStack: [],
  lastTap: 0,
  flipped: false,
  // NEW: keep palm rejection by default (finger off)
  allowFinger: false
};

// UI
const qImg = $("#qImg");
const aImg = $("#aImg");
const card3d = $("#card3d");
const counter = $("#counter");
const title = $("#cardTitle");
const pad = $("#pad");
const padToolbar = $("#padToolbar");
const size = $("#size");
const sizeVal = $("#sizeVal");

// Buttons
$("#prevBtn").onclick = () => gotoCard(state.idx - 1);
$("#nextBtn").onclick = () => gotoCard(state.idx + 1);
$("#showFrontBtn").onclick = () => setFlipped(false);
$("#showBackBtn").onclick = () => setFlipped(true);
$("#penBtn").onclick = () => { state.pen.erasing = false; };
$("#eraserBtn").onclick = () => { state.pen.erasing = true; };
$("#clearBtn").onclick = clearPad;
$("#undoBtn").onclick = undo;
$("#redoBtn").onclick = redo;
$("#saveBtn").onclick = savePNG;

size.oninput = () => { state.pen.size = +size.value; sizeVal.textContent = size.value; };

// Canvas setup
const ctx = pad.getContext("2d");
let dpr = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  const rect = pad.getBoundingClientRect();
  pad.width = Math.round(rect.width * dpr);
  pad.height = Math.round(rect.height * dpr);
  ctx.setTransform(1,0,0,1,0,0); // reset before scaling
  ctx.scale(dpr, dpr);
  redraw();
}
window.addEventListener("resize", resizeCanvas);

// ---------- Drawing (UPDATED: Pencil-smooth handlers) ----------
let drawing = false;
let last = null;

function drawLine(a, b, erase, width) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  if (erase) {
    ctx.globalCompositeOperation = "destination-out";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#e5e7eb"; // light ink on dark pad
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function pointerPos(e) {
  const r = pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPointerDown(e) {
  // Pencil or mouse always; finger only if explicitly allowed
  if (e.pointerType === "touch" && !state.allowFinger) return;

  drawing = true;
  last = pointerPos(e);
  state.currentStroke = [{ ...last, p: e.pressure || 0.5 }];
  try { pad.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drawing) return;

  // Use coalesced events (Safari/Chrome on iPad) for silky lines
  const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of batch) {
    const now = pointerPos(ev);
    const pressure = ev.pressure || 0.5;

    // width = base size × pressure; bigger when erasing
    const w = (state.pen.erasing ? 24 : state.pen.size) * (0.6 + pressure * 0.8);
    drawLine(last, now, state.pen.erasing, w);

    state.currentStroke.push({ ...now, p: pressure, erase: state.pen.erasing, size: state.pen.size });
    last = now;
  }
  e.preventDefault();
}

function onPointerUp(e) {
  if (!drawing) return;
  drawing = false;

  if (state.currentStroke && state.currentStroke.length > 1) {
    state.strokes.push({ points: state.currentStroke, erase: state.pen.erasing, size: state.pen.size });
    state.redoStack = [];
    persistPad();
  }
  state.currentStroke = null;
  try { pad.releasePointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}

pad.addEventListener("pointerdown", onPointerDown, { passive: false });
window.addEventListener("pointermove", onPointerMove, { passive: false });
window.addEventListener("pointerup", onPointerUp, { passive: false });
window.addEventListener("pointercancel", onPointerUp, { passive: false });

// Double-tap flip (anywhere on main stage)
["#stage", "#front", "#back"].forEach(sel => {
  document.querySelector(sel).addEventListener("pointerup", (e) => {
    const t = Date.now();
    if (t - state.lastTap < 300) {
      setFlipped(!state.flipped);
    }
    state.lastTap = t;
  });
});

function setFlipped(v) {
  state.flipped = v;
  if (v) card3d.classList.add("flip");
  else  card3d.classList.remove("flip");
}

function clearPad() {
  state.strokes = [];
  state.redoStack = [];
  redraw();
  persistPad();
}
function undo() {
  const s = state.strokes.pop();
  if (s) state.redoStack.push(s);
  redraw(); persistPad();
}
function redo() {
  const s = state.redoStack.pop();
  if (s) state.strokes.push(s);
  redraw(); persistPad();
}
function redraw() {
  ctx.clearRect(0,0,pad.width, pad.height);
  // replay strokes
  for (const s of state.strokes) {
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i-1], b = s.points[i];
      const w = (s.erase ? 24 : s.size) * (0.6 + (b.p||0.5) * 0.8);
      drawLine(a, b, s.erase, w);
    }
  }
}

function persistKey() {
  const card = state.cards[state.idx];
  return card ? 'pad:' + card.id : 'pad:__none__';
}
function persistPad() {
  const key = persistKey();
  try {
    localStorage.setItem(key, JSON.stringify(state.strokes));
  } catch(e) {}
}
function restorePad() {
  const key = persistKey();
  const saved = localStorage.getItem(key);
  state.strokes = saved ? JSON.parse(saved) : [];
  state.redoStack = [];
  redraw();
}

async function loadCards() {
  try {
    const res = await fetch('questions.json?cachebust=' + Date.now());
    state.cards = await res.json();
  } catch (e) {
    console.error("Failed to load questions.json", e);
    state.cards = [{
      id: "demo1",
      title: "Demo Card",
      question: "images/demo-question.png",
      solution: "images/demo-solution.png"
    }];
  }
  state.idx = 0;
  gotoCard(0);
}

function gotoCard(next) {
  if (!state.cards.length) return;
  if (next < 0) next = 0;
  if (next >= state.cards.length) next = state.cards.length - 1;
  state.idx = next;
  const card = state.cards[state.idx];
  qImg.src = card.question;
  aImg.src = card.solution;
  title.textContent = card.title || ("Card " + (state.idx+1));
  counter.textContent = (state.idx + 1) + " / " + state.cards.length;
  setFlipped(false);
  setTimeout(resizeCanvas, 30); // size canvas after layout
  restorePad();
}

// keyboard nav
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') gotoCard(state.idx + 1);
  else if (e.key === 'ArrowLeft') gotoCard(state.idx - 1);
  else if (e.key.toLowerCase() === 'b') setFlipped(true);
  else if (e.key.toLowerCase() === 'f') setFlipped(false);
});

function savePNG() {
  // Export only the pad area over a white background
  const rect = pad.getBoundingClientRect();
  const tmp = document.createElement('canvas');
  const scale = dpr;
  tmp.width = Math.round(rect.width * scale);
  tmp.height = Math.round(rect.height * scale);
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0,0,tmp.width,tmp.height);
  // redraw strokes into tmp in device pixels
  for (const s of state.strokes) {
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i-1], b = s.points[i];
      tctx.save();
      tctx.lineCap = 'round'; tctx.lineJoin='round';
      const w = (s.erase ? 24 : s.size) * (0.6 + (b.p||0.5)*0.8) * scale;
      if (s.erase) {
        tctx.globalCompositeOperation = 'destination-out';
      } else {
        tctx.globalCompositeOperation = 'source-over';
        tctx.strokeStyle = '#111827';
      }
      tctx.lineWidth = w;
      tctx.beginPath();
      tctx.moveTo(a.x * scale, a.y * scale);
      tctx.lineTo(b.x * scale, b.y * scale);
      tctx.stroke();
      tctx.restore();
    }
  }
  const url = tmp.toDataURL('image/png');
  const a = document.createElement('a');
  const id = (state.cards[state.idx]?.id) || 'pad';
  a.download = id + '-notes.png';
  a.href = url;
  a.click();
}

// PWA: register SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}

// boot
loadCards();
