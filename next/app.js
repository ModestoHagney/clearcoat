// Clearcoat, new screen: the state, the canvas, and what the menus do.
// Stage 1 of the refresh — a shell on the existing plumbing (../js): it loads
// a template, shows the pieces, sets an exact base colour, opens projects
// from the original screen and saves to iRacing. The drawing tools, Map and
// Finish modes arrive in later stages.

import {
  SIZE, GOOGLE_FONTS, createDoc, renderPaint, renderSpec, templateOverlay,
  serializeDoc, deserializeDoc, regenerateText, layerCorners,
} from '../js/engine.js';
import { canvasToTGA } from '../js/tga.js';
import * as persist from '../js/persist.js';
import { regionOutline } from '../js/regions.js';
import { loadTemplate } from '../js/template.js';
import { saveToIracing, paintFilenames, validCustid } from '../js/iracing.js';
import { initUI } from './ui.js';

export const VERSION = 'v0.68-pieces.8 · stage 1';

const $ = (id) => document.getElementById(id);
const cv = $('view');
const ctx = cv.getContext('2d');

export const app = {
  doc: null,
  view: { x: 0, y: 0, zoom: 0.3 },   // screen = (doc + offset) * zoom
  mode: 'paint',
  tool: 'select',
  sel: 'base',                        // a layer id, 'base', or null
  // the template's own linework already draws every piece's border, so the
  // computed piece outlines start off here; they are Map mode's to show
  show: { layers: true, props: true, outlines: false, lines: true },
  custid: '',
  live: false,
  liveBad: false,                     // the last live save failed
  projectId: null,                    // browser project autosave writes through to
  canUndo: false,
  canRedo: false,
  theme: 'system',
};
let ui = null;

// ---------- the doc ----------

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// template linework has to read against the base coat it sits on
// how strongly the template's inner linework shows; this screen sets it, not
// the doc (the original screen's per-project opacity suited its dark canvas)
const LINE_ALPHA = 0.8;
function syncLineColour(doc) {
  doc.templateColor = luminance(doc.baseColor) > 0.5 ? '#101114' : '#ffffff';
  doc.templateBold = true; // hairlines are too faint at fit-to-screen zoom
}
function newDoc() {
  const doc = createDoc();
  doc.baseColor = '#ffffff';
  syncLineColour(doc);
  return doc;
}

// ---------- view ----------

const screenToDoc = (sx, sy) => ({ x: sx / app.view.zoom - app.view.x, y: sy / app.view.zoom - app.view.y });
const docToScreen = (dx, dy) => ({ x: (dx + app.view.x) * app.view.zoom, y: (dy + app.view.y) * app.view.zoom });

function fit() {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  app.view.zoom = Math.min(w / SIZE, h / SIZE) * 0.9;
  app.view.x = (w / app.view.zoom - SIZE) / 2;
  app.view.y = (h / app.view.zoom - SIZE) / 2;
  requestDraw();
}
function setZoom(z, cx = cv.clientWidth / 2, cy = cv.clientHeight / 2) {
  const before = screenToDoc(cx, cy); // keep the doc point under (cx, cy) fixed
  app.view.zoom = Math.max(0.05, Math.min(8, z));
  const after = screenToDoc(cx, cy);
  app.view.x += after.x - before.x;
  app.view.y += after.y - before.y;
  requestDraw();
}

// ---------- drawing ----------

let dirty = true;       // the paint composite needs re-rendering
let composite = null;
let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

function draw() {
  if (!app.doc) return; // a resize can land before the first doc exists
  const doc = app.doc, dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (dirty || !composite) { composite = renderPaint(doc); dirty = false; }

  ctx.save();
  ctx.scale(app.view.zoom, app.view.zoom);
  ctx.translate(app.view.x, app.view.y);
  ctx.save(); // the sheet lifts off the backdrop
  ctx.shadowColor = 'rgba(10, 16, 28, .3)';
  ctx.shadowBlur = 28 * dpr;
  ctx.shadowOffsetY = 6 * dpr;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(composite, 0, 0);
  if (doc.template && app.show.lines) {
    const ov = templateOverlay(doc);
    ctx.save();
    ctx.globalAlpha = LINE_ALPHA;
    if (ov.multiply) ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(ov.img, 0, 0, SIZE, SIZE);
    ctx.restore();
  }
  ctx.restore();

  // screen space from here: lines stay hairline at any zoom
  const trace = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const q = docToScreen(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath();
  };
  if (app.show.outlines && doc.regionMap) {
    const onLight = luminance(doc.baseColor) > 0.5;
    ctx.lineJoin = 'round';
    for (const r of doc.regionMap.regions) {
      if (!r.points || r.kind) continue; // pieces only; the kit's zones are Map mode's
      trace(regionOutline(r));
      // one solid line that contrasts with the base coat, over a soft halo of
      // the opposite tone so it still shows where paint of its own tone is
      ctx.strokeStyle = onLight ? 'rgba(255, 255, 255, .6)' : 'rgba(16, 17, 20, .6)'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = onLight ? '#101114' : '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  const sel = doc.layers.find(l => l.id === app.sel);
  if (sel && sel.visible) {
    try {
      trace(layerCorners(sel));
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f5fe0';
      ctx.lineWidth = 1.5; ctx.stroke();
    } catch { /* a layer with no picture yet has no box */ }
  }
  $('zoom-readout').textContent = Math.round(app.view.zoom * 100) + '%';
  $('empty').hidden = !!(doc.template || doc.layers.length);
}

// ---------- undo / redo ----------
// Snapshot-based, as in the original screen: one step per settled change.
// Long strings (embedded pictures) are swapped for references so 40 snapshots
// of a logo-heavy livery do not hold 40 copies of every logo.
// ponytail: the table is never pruned; clear it per project if memory bites.
const interned = new Map(), internedBack = [];
const pack = (data) => JSON.stringify(data, (k, v) => {
  if (typeof v !== 'string' || v.length < 1024) return v;
  let n = interned.get(v);
  if (n === undefined) { n = internedBack.push(v) - 1; interned.set(v, n); }
  return '\u0001' + n;
});
const unpack = (snap) => JSON.parse(snap, (k, v) => (typeof v === 'string' && v[0] === '\u0001' ? internedBack[+v.slice(1)] : v));

const undoStack = [], redoStack = [];
let skipCapture = false; // the save that follows an undo must not re-record it
function capture(data) {
  if (skipCapture) { skipCapture = false; return; }
  const snap = pack(data || serializeDoc(app.doc));
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > 40) undoStack.shift();
  redoStack.length = 0;
  syncUndo();
}
function syncUndo() {
  app.canUndo = undoStack.length > 1;
  app.canRedo = redoStack.length > 0;
  $('btn-undo').disabled = !app.canUndo;
  $('btn-redo').disabled = !app.canRedo;
}
async function applySnap(snap) {
  app.doc = await deserializeDoc(unpack(snap));
  if (app.sel !== 'base' && !app.doc.layers.some(l => l.id === app.sel)) app.sel = 'base';
  syncUndo();
  change();
  skipCapture = true; // after change(), which clears it for real edits
}
function undo() {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  applySnap(undoStack[undoStack.length - 1]);
}
function redo() {
  if (!redoStack.length) return;
  const snap = redoStack.pop();
  undoStack.push(snap);
  applySnap(snap);
}
function resetHistory() {
  undoStack.length = redoStack.length = 0;
  skipCapture = false;
  capture();
}

// ---------- saving: history, autosave, live ----------

// Every edit ends here. panels: false when the edit came from a control in a
// panel that must not be rebuilt under the user's hand (a colour box, a slider).
function change({ panels = true } = {}) {
  skipCapture = false; // a real edit after an undo is recorded
  dirty = true;
  requestDraw();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(runSave, 450);
  if (ui) panels ? ui.refresh() : ui.refreshChrome();
}

let saveTimer = null, lastJson = null;
function projectThumb() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(renderPaint(app.doc), 0, 0, 128, 128);
  return c.toDataURL('image/jpeg', 0.6);
}
async function runSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const data = serializeDoc(app.doc);
  const json = JSON.stringify(data); // stringify before capture, which is free to intern
  capture(data);
  if (json !== lastJson) {
    lastJson = json;
    try {
      // its own slot: the original screen's autosave is never overwritten from here
      await persist.saveBlob('next-autosave', json);
      await persist.saveSetting('next-project', app.projectId);
      if (app.projectId) await persist.saveProject(app.projectId, { name: app.doc.name, thumb: projectThumb() }, json);
    } catch { /* quota or private mode — the livery is still on screen */ }
  }
  liveTick();
}

let liveBusy = false, liveAgain = false;
async function liveTick() {
  if (!app.live) return;
  if (liveBusy) { liveAgain = true; return; }
  liveBusy = true;
  const res = await saveToIracing(app.doc, app.custid, { quiet: true });
  liveBusy = false;
  if (app.liveBad !== !res.ok) {
    app.liveBad = !res.ok;
    if (!res.ok) ui.say('Live paused: click Live to reconnect', true);
    ui.refreshChrome();
  }
  if (liveAgain) { liveAgain = false; liveTick(); }
}

// ---------- fonts ----------
// text layers are pictures of text; a Google font has to be on the page
// before they can be re-drawn in it
const fontLoads = new Map();
function ensureDocFonts() {
  const families = new Set(app.doc.layers.filter(l => l.type === 'text').map(l => l.font));
  for (const family of families) {
    if (!GOOGLE_FONTS.includes(family) || fontLoads.has(family)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + family.replace(/ /g, '+') + '&display=swap';
    document.head.appendChild(link);
    const p = new Promise(r => { link.onload = r; link.onerror = r; })
      .then(() => document.fonts.load(`160px "${family}"`))
      .then(() => {
        let touched = false;
        for (const l of app.doc.layers) if (l.type === 'text' && l.font === family) { regenerateText(l); touched = true; }
        if (touched) { dirty = true; requestDraw(); }
      })
      .catch(() => fontLoads.delete(family)); // offline: a later open may retry
    fontLoads.set(family, p);
  }
}

// ---------- what the menus do ----------

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const safeName = () => (app.doc.name || 'livery').replace(/[^\w.-]+/g, '_');

async function setDoc(doc, projectId) {
  await flush();
  syncLineColour(doc);
  app.doc = doc;
  app.projectId = projectId;
  app.sel = 'base';
  lastJson = null;
  ensureDocFonts();
  fit();
  resetHistory();
  change();
}
// lands any pending edit in its own project before the doc is swapped
const flush = () => (saveTimer ? runSave() : Promise.resolve());

const actions = {
  undo, redo, fit,
  zoomBy: (f) => setZoom(app.view.zoom * f),
  change,

  async newLivery() {
    const d = app.doc;
    if ((d.layers.length || d.template) && !app.projectId
        && !await ui.ask({ title: 'Start a new livery?', body: 'This one is not saved as a project yet.', ok: 'Start new' })) return;
    await setDoc(newDoc(), null);
  },

  async open() {
    const list = (await persist.listProjects().catch(() => [])).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const id = await ui.pickProject(list);
    if (!id) return;
    try {
      let data = await persist.loadProject(id);
      if (typeof data === 'string') data = JSON.parse(data);
      if (!data) throw new Error('missing');
      await setDoc(await deserializeDoc(data), id);
      ui.say(`Opened ${app.doc.name}`);
    } catch {
      ui.say('Could not open that project', true);
    }
  },

  async save() {
    if (!app.projectId) {
      const name = await ui.askText({ title: 'Save as project', label: 'Name', value: app.doc.name || 'untitled livery', ok: 'Save' });
      if (!name) return;
      app.doc.name = name;
      app.projectId = Date.now().toString(36);
      lastJson = null;
    }
    await runSave();
    ui.say(`Saved ${app.doc.name}`);
    ui.refreshChrome();
  },

  pickTemplate: () => $('file-template').click(),
  async loadTemplateFile(file) {
    ui.say('Reading template…');
    try {
      const d = app.doc;
      const t = await loadTemplate(file, d.regionMap);
      d.template = t.template;
      d.paintMask = t.paintMask;
      d.regionMap = t.regionMap;
      if (!d.name || d.name === 'untitled livery') d.name = t.carName;
      fit();
      change();
      ui.say(t.pieces ? `${t.pieces} pieces found` : 'Template loaded');
    } catch (err) {
      ui.say('Could not load that template: ' + (err.message || 'unknown error'), true);
    }
  },

  async carSetup() {
    const root = await persist.getPaintsFolder().catch(() => null);
    const cars = root ? (await persist.listSubdirs(root).catch(() => [])).filter(n => n !== 'clearcoat-backup') : [];
    const car = await persist.loadSetting('paintsCar').catch(() => null);
    const res = await ui.carSetup({ custid: app.custid, target: app.doc.target, customNumber: app.doc.customNumber, folder: root ? root.name : null, cars, car });
    if (!res) return false;
    app.custid = res.custid.trim();
    persist.saveSetting('custid', app.custid).catch(() => {});
    if (cars.length) persist.saveSetting('paintsCar', res.car || null).catch(() => {});
    app.doc.target = res.target;
    app.doc.customNumber = res.customNumber;
    change();
    return validCustid(app.custid);
  },

  async linkFolder() {
    if (!persist.fsSupported()) { ui.say('Linking a folder needs Chrome or Edge', true); return false; }
    try {
      const h = await persist.pickPaintsFolder();
      ui.say(`Linked ${h.name}`);
      return true;
    } catch (err) {
      if (err && err.name !== 'AbortError') ui.say('Could not link that folder', true);
      return false;
    }
  },

  // quiet: false asks for the folder permission, so it must come from a click
  async saveIracing() {
    if (!persist.fsSupported()) { ui.say('Saving to iRacing needs Chrome or Edge. Use Export TGA instead.', true); return false; }
    if (!validCustid(app.custid) && !await actions.carSetup()) return false;
    if (!await persist.getPaintsFolder().catch(() => null) && !await actions.linkFolder()) return false;
    const res = await saveToIracing(app.doc, app.custid);
    if (res.ok) ui.say(res.backed ? `Saved ${res.paintName}. Your previous paint is kept in clearcoat-backup.` : `Saved ${res.paintName}`);
    else ui.say(res.error, true);
    return res.ok;
  },

  async toggleLive() {
    if (app.live && !app.liveBad) {
      app.live = false;
    } else if (await actions.saveIracing()) { // a real save first: it proves the folder and the number
      app.live = true;
      app.liveBad = false;
    } else {
      return;
    }
    persist.saveSetting('liveSync', app.live).catch(() => {});
    ui.refreshChrome();
  },

  exportTga() {
    const [paintName, specName] = paintFilenames(app.doc, validCustid(app.custid) ? app.custid : safeName());
    download(canvasToTGA(renderPaint(app.doc)), paintName);
    if (specName) download(canvasToTGA(renderSpec(app.doc), { alpha: true }), specName);
    ui.say(specName ? `${paintName} is the paint; ${specName} is the finish map` : `Exported ${paintName}`);
  },
  exportPng() {
    renderPaint(app.doc).toBlob((b) => { if (b) download(b, safeName() + '.png'); }, 'image/png');
  },

  setTheme(theme) {
    app.theme = theme;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('next-theme', theme); } catch { /* fine */ }
    requestDraw(); // the selection outline takes the accent colour
    ui.refreshChrome();
  },

  select(id) { app.sel = id; requestDraw(); ui.refresh(); },
  setBase(hex) { app.doc.baseColor = hex; syncLineColour(app.doc); change({ panels: false }); },
};

// ---------- pointer and keys ----------

let spaceHeld = false, pan = null;
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  setZoom(app.view.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
  e.preventDefault();
  pan = { x: e.clientX, y: e.clientY };
  cv.setPointerCapture(e.pointerId);
  cv.classList.add('panning');
});
cv.addEventListener('pointermove', (e) => {
  if (!pan) return;
  app.view.x += (e.clientX - pan.x) / app.view.zoom;
  app.view.y += (e.clientY - pan.y) / app.view.zoom;
  pan = { x: e.clientX, y: e.clientY };
  requestDraw();
});
const endPan = () => { pan = null; cv.classList.remove('panning'); };
cv.addEventListener('pointerup', endPan);
cv.addEventListener('pointercancel', endPan);

// Shortcuts stay alive after a slider or colour box is used; only a box you
// type in swallows keys.
const typing = () => {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'button', 'file'].includes(el.type);
};
window.addEventListener('keydown', (e) => {
  if ($('dlg').open || typing()) return;
  const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
  if (e.code === 'Space') { spaceHeld = true; cv.classList.add('pan'); e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); actions.save(); return; }
  if (mod) return;
  if (k === 'f') fit();
  else if (k === '+' || k === '=') actions.zoomBy(1.25);
  else if (k === '-') actions.zoomBy(0.8);
  else if (k === '?') ui.shortcuts();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceHeld = false; cv.classList.remove('pan'); } });
window.addEventListener('blur', () => { spaceHeld = false; cv.classList.remove('pan'); });
// a file dropped anywhere on the sheet is taken as a template
$('stage').addEventListener('dragover', (e) => e.preventDefault());
$('stage').addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) actions.loadTemplateFile(f);
});
$('file-template').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) actions.loadTemplateFile(f);
});
$('btn-empty-template').addEventListener('click', actions.pickTemplate);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-live').addEventListener('click', actions.toggleLive);
$('btn-zoom-in').addEventListener('click', () => actions.zoomBy(1.25));
$('btn-zoom-out').addEventListener('click', () => actions.zoomBy(0.8));
$('btn-fit').addEventListener('click', fit);
new ResizeObserver(requestDraw).observe($('stage'));

// ---------- start ----------

async function boot() {
  try { applyStoredTheme(localStorage.getItem('next-theme')); } catch { /* default theme */ }
  app.doc = newDoc();
  app.custid = (await persist.loadSetting('custid').catch(() => '')) || '';
  app.live = !!(await persist.loadSetting('liveSync').catch(() => false)) && persist.fsSupported();
  try {
    const json = await persist.loadBlob('next-autosave');
    if (json) {
      app.doc = await deserializeDoc(JSON.parse(json));
      app.projectId = (await persist.loadSetting('next-project').catch(() => null)) || null;
      lastJson = json;
    }
  } catch { /* a bad autosave must not stop the app opening */ }
  syncLineColour(app.doc);
  ui = initUI(app, actions, VERSION);
  ensureDocFonts();
  fit();
  resetHistory();
  ui.refresh();
  requestDraw();
}
function applyStoredTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  app.theme = theme;
  document.documentElement.dataset.theme = theme;
}
boot();

// The site's service worker holds its update until a page asks for it. This
// page asks straight away, then reloads once on the new one, so a `git pull`
// shows up without a manual cache clear.
if ('serviceWorker' in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    flush().finally(() => location.reload());
  });
  const take = (w) => w && w.postMessage({ type: 'SKIP_WAITING' });
  navigator.serviceWorker.register('../sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) take(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) take(w); });
    });
  }).catch(() => { /* no worker (plain http on a LAN address): the page still works */ });
}
