/* Flash Cards + Pencil Pad */
const $ = (sel) => document.querySelector(sel);

const state = {
  cards: [],
  idx: 0,
  pen: { size: 3, erasing: false },
  strokes: [],
  redoStack: [],
  lastTap: 0,
  flipped: false,
  allowFinger: false // palm rejection by default
};

// UI refs
const qImg = $("#qImg");
const aImg = $("#aImg");
const card3d = $("#card3d");
const counter = $("#counter");
const title   = $("#cardTitle");
const pad     = $("#pad");
const size    = $("#size");
const sizeVal = $("#sizeVal");

// Buttons
$("#prevBtn").onclick = () => gotoCard(state.idx - 1);
$("#nextBtn").onclick = () => gotoCard(state.idx + 1);
$("#showFrontBtn").onclick = () => setFlipped(false);
$("#showBackBtn").onclick  = () => setFlipped(true);
$("#penBtn").onclick    = () => { state.pen.erasing = false; };
$("#eraserBtn").onclick = () => { state.pen.erasing = true; };
$("#clearBtn").onclick = clearPad;
$("#undoBtn").onclick  = undo;
$("#redoBtn").onclick  = redo;
$("#saveBtn").onclick  = savePNG;

size.oninput = () => { state.pen.size = +size.value; sizeVal.textContent = size.value; };

// ---------- Canvas ----------
const ctx = pad.getContext("2d", { alpha:true, desynchronized:true, willReadFrequently:true });
let dpr = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
  const rect = pad.getBoundingClientRect();
  pad.width  = Math.round(rect.width  * dpr);
  pad.height = Math.round(rect.height * dpr);
  ctx.setTransform(1,0,0,1,0,0); // reset before scaling
  ctx.scale(dpr, dpr);
  redraw();
}
window.addEventListener("resize", resizeCanvas);

// ---------- Drawing (Bezier-smooth with pressure & velocity) ----------
let drawing = false;

function pointerPos(e) {
  const r = pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
const INK = "#f3f4f6";
function dist(a,b){ const dx=b.x-a.x, dy=b.y-a.y; return Math.hypot(dx,dy); }
function mid(a,b){ return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; }
function widthFrom(erase, base, pressure, v){
  const k = Math.min(1, v / 0.02);     // velocity factor 0..1
  const vel = 1 - 0.5*k;               // thinner when faster
  const press = 0.6 + 0.8*(pressure || 0.5);
  return Math.max(0.5, (erase ? 24 : base) * vel * press);
}

function onPointerDown(e) {
  // Pencil/mouse always; finger only if explicitly allowed
  if (e.pointerType === "touch" && !state.allowFinger) return;

  drawing = true;
  const p = pointerPos(e);
  state.currentStroke = [{ ...p, p: e.pressure || 0.5, t: performance.now() }];
  try { pad.setPointerCapture(e.pointerId); } catch(_) {}
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drawing) return;

  const batch = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of batch) {
    const now = pointerPos(ev);
    const t   = performance.now();
    const pr  = ev.pressure || 0.5;
    const pts = state.currentStroke;

    pts.push({ ...now, p: pr, t });

    if (pts.length >= 3) {
      const n  = pts.length;
      const p0 = pts[n-3], p1 = pts[n-2], p2 = pts[n-1];
      const m1 = mid(p0, p1), m2 = mid(p1, p2);
      const dt = Math.max(8, (p2.t - p1.t) || 16);
      const v  = dist(p1, p2) / dt;
      const w  = widthFrom(state.pen.erasing, state.pen.size, p1.p, v);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = w;
      ctx.globalCompositeOperation = state.pen.erasing ? "destination-out" : "source-over";
      if (!state.pen.erasing) ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
      ctx.stroke();
      ctx.restore();
    }
  }
  e.preventDefault();
}

function onPointerUp(e) {
  if (!drawing) return;
  drawing = false;

  const pts = state.currentStroke;
  if (pts && pts.length === 2) {
    const [a,b] = pts;
    const dt = Math.max(8, (b.t - a.t) || 16);
    const v  = dist(a,b) / dt;
    const w  = widthFrom(state.pen.erasing, state.pen.size, b.p, v);
    ctx.save();
    ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth = w;
    ctx.globalCompositeOperation = state.pen.erasing ? 'destination-out' : 'source-over';
    if (!state.pen.erasing) ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.restore();
  }

  if (pts && pts.length > 1) {
    state.strokes.push({ points: pts, erase: state.pen.erasing, size: state.pen.size });
    state.redoStack = [];
    persistPad();
  }
  state.currentStroke = null;
  try { pad.releasePointerCapture(e.pointerId); } catch(_) {}
  e.preventDefault();
}

// Pointer + touch listeners (touch blocked to prevent page scroll)
pad.addEventListener("pointerdown", onPointerDown, { passive:false });
window.addEventListener("pointermove", onPointerMove, { passive:false });
window.addEventListener("pointerup", onPointerUp, { passive:false });
window.addEventListener("pointercancel", onPointerUp, { passive:false });

pad.addEventListener("touchstart", (e)=> e.preventDefault(), { passive:false });
pad.addEventListener("touchmove",  (e)=> e.preventDefault(), { passive:false });
pad.addEventListener("touchend",   (e)=> e.preventDefault(), { passive:false });
pad.addEventListener("gesturestart", (e)=> e.preventDefault(), { passive:false }); // Safari pinch
pad.addEventListener("gesturechange",(e)=> e.preventDefault(), { passive:false });
pad.addEventListener("gestureend",   (e)=> e.preventDefault(), { passive:false });
pad.addEventListener("contextmenu",  (e)=> e.preventDefault());

// ---------- Flip on double tap (ignore while writing / on canvas) ----------
["#stage", "#front", "#back"].forEach(sel => {
  document.querySelector(sel).addEventListener("pointerup", (e) => {
    if (drawing || e.target === pad) { state.lastTap = 0; return; }
    const t = Date.now();
    if (t - state.lastTap < 300) setFlipped(!state.flipped);
    state.lastTap = t;
  }, { passive:false });
});
function setFlipped(v) {
  state.flipped = v;
  if (v) card3d.classList.add("flip"); else card3d.classList.remove("flip");
}

// ---------- Edit ops ----------
function clearPad(){ state.strokes=[]; state.redoStack=[]; redraw(); persistPad(); }
function undo(){ const s=state.strokes.pop(); if(s) state.redoStack.push(s); redraw(); persistPad(); }
function redo(){ const s=state.redoStack.pop(); if(s) state.strokes.push(s); redraw(); persistPad(); }

// Repaint saved strokes (same smoothing)
function redraw() {
  ctx.clearRect(0,0,pad.width,pad.height);
  for (const s of state.strokes) {
    const pts = s.points;
    if (!pts || pts.length < 2) continue;
    for (let i = 2; i < pts.length; i++) {
      const p0 = pts[i-2], p1 = pts[i-1], p2 = pts[i];
      const m1 = mid(p0, p1), m2 = mid(p1, p2);
      const dt = Math.max(8, (p2.t - p1.t) || 16);
      const v  = dist(p1, p2) / dt;
      const w  = widthFrom(s.erase, s.size, p1.p, v);

      ctx.save();
      ctx.lineCap='round'; ctx.lineJoin='round'; ctx.lineWidth = w;
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      if (!s.erase) ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, m2.x, m2.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------- Persistence ----------
function persistKey() {
  const card = state.cards[state.idx];
  return card ? 'pad:' + card.id : 'pad:__none__';
}
function persistPad() {
  try { localStorage.setItem(persistKey(), JSON.stringify(state.strokes)); } catch(_) {}
}
function restorePad() {
  const saved = localStorage.getItem(persistKey());
  state.strokes = saved ? JSON.parse(saved) : [];
  state.redoStack = [];
  redraw();
}

// ---------- Cards ----------
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
  state.idx = Math.max(0, Math.min(next, state.cards.length - 1));
  const card = state.cards[state.idx];
  qImg.src = card.question;
  aImg.src = card.solution;
  title.textContent = card.title || ("Card " + (state.idx+1));
  counter.textContent = (state.idx + 1) + " / " + state.cards.length;
  setFlipped(false);
  setTimeout(resizeCanvas, 30);
  restorePad();
}

// keyboard nav
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') gotoCard(state.idx + 1);
  else if (e.key === 'ArrowLeft') gotoCard(state.idx - 1);
  else if (e.key.toLowerCase() === 'b') setFlipped(true);
  else if (e.key.toLowerCase() === 'f') setFlipped(false);
});

// ---------- Export (Bezier rendering on white background) ----------
function savePNG() {
  const rect = pad.getBoundingClientRect();
  const scale = dpr;
  const tmp = document.createElement('canvas');
  tmp.width  = Math.round(rect.width  * scale);
  tmp.height = Math.round(rect.height * scale);
  const tctx = tmp.getContext('2d');

  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0,0,tmp.width,tmp.height);

  function drawStroke(pts, erase, size) {
    if (pts.length < 2) return;
    for (let i = 2; i < pts.length; i++) {
      const p0 = pts[i-2], p1 = pts[i-1], p2 = pts[i];
      const m1 = mid(p0, p1), m2 = mid(p1, p2);
      const dt = Math.max(8, (p2.t - p1.t) || 16);
      const v  = dist(p1, p2) / dt;
      const w  = widthFrom(erase, size, p1.p, v) * scale;

      tctx.save();
      tctx.lineCap='round'; tctx.lineJoin='round'; tctx.lineWidth = w;
      tctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      if (!erase) tctx.strokeStyle = '#111827';
      tctx.beginPath();
      tctx.moveTo(m1.x * scale, m1.y * scale);
      tctx.quadraticCurveTo(p1.x * scale, p1.y * scale, m2.x * scale, m2.y * scale);
      tctx.stroke();
      tctx.restore();
    }
  }
  for (const s of state.strokes) drawStroke(s.points, s.erase, s.size);

  const url = tmp.toDataURL('image/png');
  const a = document.createElement('a');
  const id = (state.cards[state.idx]?.id) || 'pad';
  a.download = id + '-notes.png';
  a.href = url;
  a.click();
}

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}

// boot
loadCards();
