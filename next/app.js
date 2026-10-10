// Clearcoat, new screen: the state, the canvas, and what the menus do.
// The refresh, built in stages on the existing plumbing (../js). Stage 1: load
// a template, show the pieces, an exact base colour, open projects from the
// original screen, save to iRacing. Stage 2: shapes you draw and keep editing
// (./tools.js), with exact colours. Stage 3: Map mode (./map.js) and the
// tools that work from the map: fill a panel, trim to panels, mirror.
// Stage 4: text and pictures (logos). Stage 5: Finish mode (../js/finish.js):
// finishes by colour, by layer, or by a drawn area.

import {
  SIZE, GOOGLE_FONTS, createDoc, renderPaint, renderSpec,
  serializeDoc, deserializeDoc, regenerateText, layerCorners, newId,
  createTextLayer, createImageLayer, loadImage, registerCustomFont,
} from '../js/engine.js';
import { canvasToTGA } from '../js/tga.js';
import * as persist from '../js/persist.js';
import { regionOutline } from '../js/regions.js';
import { loadTemplate } from '../js/template.js';
import { saveToIracing, paintFilenames, validCustid, exportPaintCanvas, paintsDir } from '../js/iracing.js';
import { initUI } from './ui.js';
import { initTools, isShape, isBox, moveLayer, setShape, fadeEnds } from './tools.js';
import { joined, boxOutline, pieces, SHAPES } from '../js/shapes.js';
import { LIBRARY, libraryItemToLayerSource } from '../js/library.js';
import { createFillLayer } from '../js/engine.js';
import { moved } from '../js/shapes.js';
import { paintLayers } from '../js/engine.js';
import { finishSpec } from '../js/finish.js';
import { withFinishes, withPatterns, setRule, clearRule, ruleFor, layerColour, isArea, hasOwnFinish, readFinish, writeFinish, presetOf, FINISHES, SPARKLE } from '../js/finish.js';
import { MATERIALS } from '../js/engine.js';
import { initMap, syncGuide, guideLayer } from './map.js';
import { mirrorLayer, mirrorImage, withMirrors } from '../js/mirror.js';
import { parseRegionMap, regionById, renameRegion, setMirror } from '../js/regions.js';

export const VERSION = 'v0.68-pieces.40';

const $ = (id) => document.getElementById(id);
const cv = $('view');
const ctx = cv.getContext('2d');

export const app = {
  doc: null,
  view: { x: 0, y: 0, zoom: 0.3 },   // screen = (doc + offset) * zoom
  mode: 'paint',
  tool: 'select',
  sel: 'base',                        // a layer id, 'base', or null
  sels: [],                           // every selected layer's id when there are several (it includes sel)
  // the template's own linework already draws every piece's border, so the
  // computed piece outlines start off here; they are Map mode's to show
  show: { layers: true, props: true, colour: true, outlines: false, lines: true, mesh: true },
  custid: '',
  live: false,
  liveBad: false,                     // the last live save failed
  projectId: null,                    // browser project autosave writes through to
  canUndo: false,
  canRedo: false,
  theme: 'system',
  colour: '#111214',                  // what the next new shape is filled with
  clipboard: null,                    // a copied layer
  shapeKind: 'ellipse',               // which ready-made shape the Shape tool draws
  bandWidth: 60,                      // px on the sheet
  stamp: { key: 'star', size: 120 },  // what the Stamp tool places: a shape's key (see motifOf) and its size on the sheet
  picking: false,                     // the next click on the sheet picks a colour
  ways: { Hex: true, RGB: false },    // which colour read-outs the Colour panel shows
  trimming: false,                    // clicks on the sheet choose the selected layer's panels
  piece: null,                        // Map mode: the selected panel's id
  centreFor: null,                    // Map mode: the panel a centreline is being set on, if fixed
  mapShow: { colours: true },         // Map mode: panel colours and names over the sheet
  font: 'Arial Black',                // what the next new text is set in
  // Finish mode: what the next finish applies to —
  // { kind: 'colour', colour, layerId? } | { kind: 'layer', id } | { kind: 'area', id }
  ftarget: null,
  finishKind: 'matte',                // the finish a newly drawn area starts with
};
let ui = null, tools = null, mapTools = null;
const onSheet = () => (app.mode === 'map' ? mapTools : tools); // who the pointer talks to

// ---------- the doc ----------

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// template linework has to read against the base coat it sits on
// how strongly the template's inner linework shows; this screen sets it, not
// the doc (the original screen's per-project opacity suited its dark canvas)
// The template's lines for the screen, as two pictures in a tone that reads
// against the base coat: the panel lines (strong ink in the template picture,
// thickened a little) and the mesh (faint ink; see js/template.js). Rebuilt
// only when the template or the tone changes.
let lineCache = { img: null, dark: null, borders: null, mesh: null };
function templateLines(doc) {
  const img = doc.template.img, dark = luminance(doc.baseColor) > 0.5;
  if (lineCache.img === img && lineCache.dark === dark) return lineCache;
  const w = img.width, h = img.height;
  const read = document.createElement('canvas');
  read.width = w; read.height = h;
  const rctx = read.getContext('2d', { willReadFrequently: true });
  rctx.drawImage(img, 0, 0);
  const src = rctx.getImageData(0, 0, w, h).data;
  const B = new ImageData(w, h), M = new ImageData(w, h), tone = dark ? [16, 17, 20] : [255, 255, 255];
  for (let i = 0; i < src.length; i += 4) {
    const ink = (255 - Math.min(src[i], src[i + 1], src[i + 2])) * (src[i + 3] / 255); // how far from white
    const to = ink >= 200 ? B.data : ink >= 40 ? M.data : null;
    if (to) { to[i] = tone[0]; to[i + 1] = tone[1]; to[i + 2] = tone[2]; to[i + 3] = 255; }
  }
  const canvas = (data, bold) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.putImageData(data, 0, 0);
    if (!bold) return c;
    const out = document.createElement('canvas'); // a hairline is too faint at fit-to-screen zoom
    out.width = w; out.height = h;
    const og = out.getContext('2d');
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) og.drawImage(c, dx, dy);
    return out;
  };
  lineCache = { img, dark, borders: canvas(B, true), mesh: canvas(M, false) };
  return lineCache;
}
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

// the paint as it goes to the car: soft edges mixed the accurate way
const paint = () => renderPaint(shown(), { linearEdges: true });
// the livery with the other side of every Mirrored layer added: what is painted
// and with every layer carrying the finish it ends up with
// A picture given a colour is painted as its own outline filled with that
// colour. The picture itself is kept, so the colour can be taken off again.
const tinted = new WeakMap(); // picture → { colour, canvas }: the last one made
function tintedImage(img, colour) {
  const had = tinted.get(img);
  if (had && had.colour === colour) return had.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  tinted.set(img, { colour, canvas });
  return canvas;
}
const withTints = (doc) => (doc.layers.some(l => l.type === 'image' && l.color && l.img)
  ? { ...doc, layers: doc.layers.map(l => (l.type === 'image' && l.color && l.img ? { ...l, img: tintedImage(l.img, l.color) } : l)) }
  : doc);
const shown = () => withMirrors(withTints(withFinishes(app.doc)));
let quick = false, quickTimer = null; // an edit is in full flow: draw fast, tidy up when it pauses
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
  // soft edges are mixed the accurate way except while something is being
  // dragged: that mix is too slow to redo on every frame of a drag
  if (dirty || !composite) { composite = renderPaint(shown(), { linearEdges: !quick }); dirty = false; }

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
  if (doc.template && (app.show.lines || app.show.mesh)) {
    const L = templateLines(doc);
    if (app.show.mesh) { ctx.globalAlpha = 0.3; ctx.drawImage(L.mesh, 0, 0, SIZE, SIZE); }
    if (app.show.lines) { ctx.globalAlpha = 0.85; ctx.drawImage(L.borders, 0, 0, SIZE, SIZE); }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // screen space from here: lines stay hairline at any zoom
  const trace = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const q = docToScreen(p.x, p.y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
    ctx.closePath();
  };
  if (app.mode === 'map') {
    if (mapTools) mapTools.drawOverlay(ctx, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f5fe0');
    $('zoom-readout').textContent = Math.round(app.view.zoom * 100) + '%';
    $('empty').hidden = !!(doc.template || doc.layers.length);
    return;
  }
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
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1f5fe0';
  const sel = doc.layers.find(l => l.id === app.sel);
  if (sel && sel.visible && !(isShape(sel) && app.tool === 'select')) { // a shape shows its own outline and points
    try {
      trace(layerCorners(sel));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5; ctx.stroke();
    } catch { /* a layer with no picture yet has no box */ }
  }
  if (tools) tools.drawOverlay(ctx, accent);
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
// now: true for a finished, one-off action (paste, delete, a drag let go), so
// it is its own undo step instead of merging with whatever comes next.
function change({ panels = true, now = false } = {}) {
  skipCapture = false; // a real edit after an undo is recorded
  clearTimeout(quickTimer);
  quick = !panels && !now; // a drag, a slider, a nudge: more of the same is coming
  if (quick) quickTimer = setTimeout(() => { quick = false; dirty = true; requestDraw(); }, 160);
  dirty = true;
  requestDraw();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(runSave, now ? 0 : 450);
  if (ui) panels ? ui.refresh() : ui.refreshChrome();
}

let saveTimer = null, lastJson = null;
function projectThumb() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(paint(), 0, 0, 128, 128);
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

// A live save can fail for a moment and then be fine: the sim holds the paint
// file open while it reads it. So a failed one is tried again a few times
// before Live is shown as paused; otherwise that change would never reach the
// car until the next edit.
const LIVE_RETRIES = 5;
let liveBusy = false, liveAgain = false, liveRetry = null;
async function liveTick(attempt = 0) {
  clearTimeout(liveRetry);
  if (!app.live) return;
  if (liveBusy) { liveAgain = true; return; }
  liveBusy = true;
  const res = await saveToIracing(shown(), app.custid, { quiet: true });
  liveBusy = false;
  if (liveAgain) { liveAgain = false; liveTick(); return; } // a newer change is waiting: send that
  if (!res.ok && attempt < LIVE_RETRIES) { liveRetry = setTimeout(() => liveTick(attempt + 1), 400); return; }
  if (app.liveBad !== !res.ok) {
    app.liveBad = !res.ok;
    if (!res.ok) ui.say('Live paused. Click Live to reconnect.', true);
    ui.refreshChrome();
  }
}

// ---------- fonts ----------
// text layers are pictures of text; a Google font has to be on the page
// before they can be re-drawn in it
const fontLoads = new Map(), fontReady = new Set();
const isWebFont = (f) => GOOGLE_FONTS.includes(f) || (app.doc.googleFonts || []).includes(f);
// Puts a Google font on the page. → true once it can be drawn with, false if
// Google has no such font (its names are case-sensitive) or it is unreachable.
function loadWebFont(family) {
  if (fontLoads.has(family)) return fontLoads.get(family);
  const p = (async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + '&display=swap';
    const found = await new Promise(r => { link.onload = () => r(true); link.onerror = () => r(false); document.head.appendChild(link); });
    if (!found) { link.remove(); return false; }
    try { await document.fonts.load(`160px "${family}"`); } catch { return false; }
    return document.fonts.check(`160px "${family}"`);
  })();
  fontLoads.set(family, p);
  p.then((ok) => { if (ok) fontReady.add(family); else fontLoads.delete(family); }); // a miss may be retried later
  return p;
}
function ensureDocFonts() {
  const families = new Set(app.doc.layers.filter(l => l.type === 'text').map(l => l.font));
  for (const family of families) {
    if (!isWebFont(family) || fontReady.has(family)) continue;
    loadWebFont(family).then((ok) => {
      if (!ok) return;
      let touched = false;
      for (const l of app.doc.layers) if (l.type === 'text' && l.font === family) { regenerateText(l); touched = true; }
      if (touched) { dirty = true; requestDraw(); }
    });
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
  if (tools) tools.cancel();
  if (mapTools) mapTools.cancel();
  app.piece = app.centreFor = null;
  app.trimming = false;
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

// Every selected layer, back to front. `sels` only counts while it holds the
// primary selection, so code that just sets app.sel never leaves a stale set.
function selectedLayers() {
  const ids = app.sels.length > 1 && app.sels.includes(app.sel) ? app.sels : app.sel && app.sel !== 'base' ? [app.sel] : [];
  return app.doc.layers.filter(l => ids.includes(l.id));
}
// the ids picked up with this one: its group, or just itself
function groupOf(id) {
  const l = app.doc.layers.find(x => x.id === id);
  return l && l.groupId ? app.doc.layers.filter(x => x.groupId === l.groupId).map(x => x.id) : [id];
}
// a group needs two members to mean anything
function pruneGroups() {
  const d = app.doc, n = new Map();
  for (const l of d.layers) if (l.groupId) n.set(l.groupId, (n.get(l.groupId) || 0) + 1);
  for (const l of d.layers) if (l.groupId && n.get(l.groupId) < 2) l.groupId = null;
  d.groups = (d.groups || []).filter(g => n.get(g.id) >= 2);
}
// a fill that fades to nothing ends in its own colour, see-through: keep that true when the colour changes
function keepFadeOut(l) {
  if (typeof l.color2 === 'string' && l.color2.length === 9 && l.color2.endsWith('00')) l.color2 = l.color + '00';
}
// in Finish mode the paint is not to be disturbed: only an area may be changed
const canChange = () => app.mode !== 'finish' || isArea(actions.selected());
const toolChanged = () => cv.classList.toggle('draw', (app.tool !== 'select' && app.tool !== 'mpick') || app.picking || app.trimming);
// the exact paint colour at a point on the sheet
function sampleColour(p) {
  const x = Math.round(p.x), y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
  const d = paint().getContext('2d').getImageData(x, y, 1, 1).data;
  return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
}

let library = { logos: [], shapes: [] };
const saveLibrary = () => persist.saveBlob('next-library', library).catch(() => { /* quota: it still works this session */ });

// settings of a text layer that change what its picture looks like
const TEXT_KEYS = new Set(['text', 'font', 'fontSize', 'textColor', 'outlineColor', 'outlineWidth', 'italic', 'letterSpacing', 'curve']);

// a copy that shares nothing editable with the original (pictures are shared:
// they are never changed in place)
function cloneLayer(l) {
  const c = { ...l, id: newId(), groupId: null }; // a copy does not join the original's group
  for (const k of ['pts', 'lassoPts', 'corners', 'clipAt']) if (Array.isArray(l[k])) c[k] = l[k].map(q => (q.c ? { ...q, c: { ...q.c } } : { ...q }));
  if (Array.isArray(l.clip)) c.clip = l.clip.map(poly => (Array.isArray(poly) ? poly.map(q => ({ ...q })) : { ...poly }));
  for (const k of ['matParams', 'lumSpec', 'fx', 'cornerPan', 'fadeFrom', 'fadeTo']) if (l[k]) c[k] = { ...l[k] };
  return c;
}

// the selected shapes a pattern can go on
const patterned = () => selectedLayers().filter(l => l.type === 'fill' && !isArea(l));
// a first colour for a pattern: one that shows on the shape's own
const standsOut = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(String(hex || '#ffffff').slice(i, i + 2), 16) || 0);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#101114' : '#ffffff';
};
// What a pattern repeats or a stamp places, from its key: a ready-made
// shape's name, or 'own:<id>' for one saved in the library. A library shape
// is copied in, so the livery does not depend on this browser's library.
function motifOf(key) {
  if (SHAPES[key]) return { kind: key };
  const it = library.shapes.find(x => 'own:' + x.id === key);
  if (!it) return null;
  return { kind: 'own', id: it.id, name: it.name, w: it.w, h: it.h, pts: (it.pts || boxOutline(it.shape, 0, 0, it.w, it.h)).map(q => (q.c ? { ...q, c: { ...q.c } } : { ...q })) };
}

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
    const res = await saveToIracing(shown(), app.custid);
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
    download(canvasToTGA(paint()), paintName);
    if (specName) download(canvasToTGA(renderSpec(shown()), { alpha: true }), specName);
    ui.say(specName ? `${paintName} is the paint; ${specName} is the finish map` : `Exported ${paintName}`);
  },
  exportPng() {
    paint().toBlob((b) => { if (b) download(b, safeName() + '.png'); }, 'image/png');
  },

  // Trading Paints takes the paint as a PNG, and a finish map only as the
  // .mip the sim itself makes from the last Save to iRacing.
  async sendTp() {
    // the tab first: an await before window.open spends the click and the browser blocks it
    // (no 'noopener' in the call: with it the answer is always null, blocked or not)
    const tab = window.open('https://www.tradingpaints.com/upload', '_blank'), blocked = !tab;
    if (tab) tab.opener = null;
    const car = app.doc.target === 'car' && validCustid(app.custid);
    const name = (car ? `car_${app.doc.customNumber ? 'num_' : ''}${app.custid}` : safeName()) + '.png';
    const blob = await new Promise(done => exportPaintCanvas(app.doc, paint()).toBlob(done, 'image/png'));
    if (!blob) { ui.say('The paint could not be exported', true); return; }
    download(blob, name);
    let mip = null, old = false;
    try {
      const dir = car && await paintsDir();
      mip = dir && await persist.readFileFromFolder(dir, `car_spec_${app.custid}.mip`);
      const tga = mip && await persist.readFileFromFolder(dir, `car_spec_${app.custid}.tga`);
      old = !!tga && mip.lastModified < tga.lastModified; // made before the finishes last changed
      if (mip && !old) download(mip, mip.name);
    } catch { /* no folder linked: the paint alone still uploads */ }
    if (blocked) ui.say('Allow pop-ups for this site, then send again', true);
    else if (old) ui.say(`${name} downloaded. Finish file is out of date: open the car in iRacing once, then send again.`, true);
    else ui.say(mip ? `Downloaded ${name} (paint) and ${mip.name} (finish)` : `Downloaded ${name}. Upload it as the paint.`);
  },

  setMode(mode) {
    if (mode === app.mode) return;
    tools.cancel(); mapTools.cancel();
    app.mode = mode;
    app.tool = mode === 'map' ? 'mpick' : 'select';
    app.ftarget = null;
    if (mode !== 'finish' && isArea(actions.selected())) app.sel = null; // an area is Finish mode's to select
    app.picking = app.trimming = false;
    app.centreFor = null;
    toolChanged();
    requestDraw();
    ui.refresh();
  },

  // ---- finishes ----
  // the layer a finish target is about, if it is about one
  finishLayer() {
    const t = app.ftarget;
    return t && (t.kind === 'layer' || t.kind === 'area') ? app.doc.layers.find(l => l.id === t.id) || null : null;
  },
  // the finish the target has now, as the engine stamps it: { material, params }
  finishNow() {
    const t = app.ftarget, l = actions.finishLayer();
    if (!t) return null;
    if (t.kind === 'colour') { const r = ruleFor(app.doc, t.colour); return { material: r ? r.material : 'gloss', params: (r && r.params) || null }; }
    return l ? { material: l.material || 'gloss', params: l.matParams || null } : null;
  },
  applyFinish({ material, params }) {
    const t = app.ftarget, l = actions.finishLayer();
    if (!t) return false;
    if (t.kind === 'colour') setRule(app.doc, t.colour, material, params);
    else if (l) { l.material = material; l.matParams = params; l.finishOwn = true; }
    else return false;
    return true;
  },
  // one of the six: its three numbers, keeping whatever sparkle is on
  setFinish(key) {
    const now = actions.finishNow();
    if (!now || !MATERIALS[key]) return;
    const m = MATERIALS[key], cur = readFinish(now.material, now.params);
    if (!actions.applyFinish(writeFinish({ met: m.met, rough: m.rough, clear: m.clear, sparkle: cur.sparkle }, key))) return;
    app.finishKind = key;
    change({ now: true });
  },
  // a slider or the Sparkle switch. part: met | rough | clear | sparkle | amount | size | strength
  tweakFinish(part, value) {
    const now = actions.finishNow();
    if (!now) return;
    const f = readFinish(now.material, now.params);
    if (part === 'sparkle') f.sparkle = value ? { ...SPARKLE } : null;
    else if (part === 'amount' || part === 'size' || part === 'strength') { if (!f.sparkle) return; f.sparkle[part] = value; }
    else f[part] = value;
    // it keeps the name of the finish it started from while its numbers are moved
    if (!actions.applyFinish(writeFinish(f, presetOf(readFinish(now.material, now.params)) || now.material))) return;
    change(part === 'sparkle' ? { now: true } : { panels: false });
  },
  // the three sliders back to where the named finish has them; sparkle stays
  resetFinish() {
    const now = actions.finishNow();
    if (!now) return;
    const key = FINISHES.includes(now.material) ? now.material : 'gloss', m = MATERIALS[key];
    if (actions.applyFinish(writeFinish({ met: m.met, rough: m.rough, clear: m.clear, sparkle: readFinish(now.material, now.params).sparkle }, key))) change({ now: true });
  },
  // "all of this colour" or "just this layer", for a target that came from a shape or text
  finishScope(scope) {
    const t = app.ftarget;
    if (!t) return;
    if (scope === 'layer' && t.kind === 'colour' && t.layerId) app.ftarget = { kind: 'layer', id: t.layerId };
    else if (scope === 'colour' && t.kind === 'layer') {
      const l = actions.finishLayer(), c = l && layerColour(l);
      if (!c) return;
      if (l.finishOwn || hasOwnFinish(l)) { l.finishOwn = false; l.material = 'gloss'; l.matParams = null; change({ now: true }); } // it follows its colour again
      app.ftarget = { kind: 'colour', colour: c, layerId: l.id };
    }
    requestDraw();
    ui.refresh();
  },
  // from the Finishes list
  finishSelect(kind, key) {
    if (kind === 'colour') { app.ftarget = { kind, colour: key }; app.sel = null; }
    else { app.ftarget = { kind, id: key }; app.sel = key; }
    requestDraw();
    ui.refresh();
  },
  // Back to the default finish, plain gloss. A finish cannot be taken away:
  // everything has one, so the row stays. (An area is a shape: Delete removes it.)
  finishDefault(kind, key) {
    const d = app.doc, l = d.layers.find(x => x.id === key);
    if (kind === 'colour') clearRule(d, key);
    else if (l) { l.material = 'gloss'; l.matParams = null; }
    change({ now: true });
  },

  // ---- the map ----
  pickPiece(id) { app.piece = id; requestDraw(); ui.refresh(); },
  // every edit to the map ends here
  async mapChanged(msg) {
    if (guideLayer(app.doc)) await syncGuide(app.doc, true); // the guide on the car follows the map
    change({ now: true });
    if (msg) ui.say(msg);
  },
  mapRename(name) {
    const r = regionById(app.doc.regionMap, app.piece);
    if (!r || !name || name === r.name) return;
    renameRegion(app.doc.regionMap, r, name);
    app.piece = r.id; // the id follows the name
    actions.mapChanged();
  },
  mapPair(id) {
    const m = app.doc.regionMap, r = regionById(m, app.piece);
    if (!r) return;
    setMirror(m, r, id || null);
    actions.mapChanged(id ? `${r.name} paired with ${regionById(m, id).name}` : `${r.name} unpaired`);
  },
  centreStart() { app.centreFor = app.piece; actions.setTool('mcentre'); },
  centreRemove() {
    const r = regionById(app.doc.regionMap, app.piece);
    if (!r || !r.center) return;
    delete r.center;
    actions.mapChanged(`Centreline removed from ${r.name}`);
  },
  toggleMapColours() { app.mapShow.colours = !app.mapShow.colours; requestDraw(); ui.refresh(); },
  async toggleGuide() {
    await syncGuide(app.doc, !guideLayer(app.doc));
    change({ now: true });
    ui.say(guideLayer(app.doc) ? 'Panel colours are on the car. Switch this off before your real save.' : 'Panel colours are off the car');
  },
  guideOn: () => !!guideLayer(app.doc),
  pickMapFile: () => $('file-map').click(),
  async loadMapFile(file) {
    try {
      app.doc.regionMap = parseRegionMap(JSON.parse(await file.text()));
      app.piece = null;
      actions.mapChanged(`Map loaded: ${app.doc.regionMap.regions.length} regions`);
    } catch (err) {
      ui.say('Could not read that map: ' + (err.message || 'not a map file'), true);
    }
  },
  saveMap() {
    const m = app.doc.regionMap;
    if (!m) return;
    const name = (m.car || 'car').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'car';
    download(new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' }), name + '.regions.json');
  },

  // ---- painting from the map ----
  // Mirrored: the layer is painted on its twin panel (or across its
  // centreline) as well, and both sides follow every edit
  mirror() {
    const l = actions.selected(), ls = selectedLayers();
    if (!l || !canChange()) return;
    if (l.mirrored) { for (const x of ls) x.mirrored = false; change({ now: true }); return; }
    // every selected layer that has somewhere to mirror onto
    let done = 0, first = null;
    for (const x of ls) {
      const res = mirrorLayer(app.doc.regionMap, x); // only to find out whether it can be
      if (res.error) { first = first || res.error; continue; }
      x.mirrored = true; done++;
      if (x === l) ui.say(res.dst.mirror ? `Mirrored onto ${res.dst.name}` : `Mirrored across ${res.dst.name}'s centreline`);
    }
    if (!done) { ui.say(first, true); ui.refresh(); return; }
    change({ now: true });
  },
  // ---- fades ----
  // A shape's fill fades from its colour to a second one, or to nothing.
  // part: on | style ('linear' | 'radial') | to (a hex) | out (to nothing)
  setFade(part, value) {
    const l = actions.selected();
    if (!l || l.type !== 'fill') return;
    // switched on, it starts as the usual want: a smooth fade to nothing
    // (the engine's own default second colour means none has been chosen yet)
    // Where it runs is set by two dots on the sheet (fadeFrom, fadeTo); they
    // start out laid across the shape, and again whenever the style changes.
    const lay = (style) => { const e = fadeEnds(l, style); l.fadeFrom = { ...e.a }; l.fadeTo = { ...e.b }; };
    if (part === 'on') {
      l.fillType = value ? 'linear' : 'solid';
      if (value && (!l.color2 || l.color2 === '#101114')) l.color2 = l.color + '00';
      if (value && !(l.fadeFrom && l.fadeTo)) lay('linear');
    } else if (part === 'style') { l.fillType = value === 'radial' ? 'radial' : 'linear'; lay(l.fillType); }
    else if (part === 'to') l.color2 = value;
    else if (part === 'out') l.color2 = value ? l.color + '00' : '#ffffff'; // the same colour, see-through
    change(part === 'to' ? { panels: false } : { now: true });
  },
  // the mirrored side becomes a layer of its own, to be changed separately
  separate() {
    const l = actions.selected();
    if (!l || !l.mirrored) return;
    const res = mirrorLayer(app.doc.regionMap, l);
    if (res.error) { ui.say(res.error, true); return; }
    l.mirrored = false;
    res.copy.mirrored = false;
    app.doc.layers.splice(app.doc.layers.indexOf(l) + 1, 0, res.copy);
    app.sel = res.copy.id;
    change({ now: true });
  },
  trim() {
    if (!actions.selected() || app.mode !== 'paint') return;
    if (!app.doc.regionMap) { ui.say('Load a template first', true); return; }
    app.trimming = !app.trimming;
    toolChanged();
    requestDraw();
    ui.refresh();
  },
  endTrim() { if (!app.trimming) return; app.trimming = false; toolChanged(); requestDraw(); ui.refresh(); },
  trimClear() {
    const l = actions.selected();
    if (!l) return;
    l.clip = null; l.clipAt = null;
    app.trimming = false;
    toolChanged();
    change({ now: true });
  },

  setTool(id) {
    if (tools) tools.cancel();
    if (mapTools) mapTools.cancel();
    app.tool = id;
    app.picking = app.trimming = false;
    if (id !== 'mcentre') app.centreFor = null;
    toolChanged();
    requestDraw();
    ui.refresh();
  },
  setShapeKind(kind) { app.shapeKind = kind; requestDraw(); ui.refreshChrome(); },
  setStamp(part) { Object.assign(app.stamp, part); requestDraw(); },

  // ---- patterns: a shape repeated inside a fill ----
  ownShapes: () => library.shapes,
  // '' takes the pattern off; a shape's key puts one on, or swaps what repeats
  // Every selected shape takes it, with the same settings: the grid is the
  // sheet's, so together they carry one pattern.
  setMotif(key) {
    const ls = patterned();
    if (!ls.length || !canChange()) return;
    if (!key) { for (const l of ls) { delete l.motif; delete l.motifFrame; } return change(); }
    const shape = motifOf(key);
    if (!shape) return ui.refresh(); // its own shape, no longer in the library: nothing to swap to
    const had = (ls.find(l => l.motif) || {}).motif || { size: 80, gap: 40, stagger: 0, turn: 0, only: false };
    for (const l of ls) l.motif = { ...shape, size: had.size, gap: had.gap, stagger: had.stagger, turn: had.turn, only: !!had.only, color: had.color || standsOut(l.color) };
    change();
  },
  tweakMotif(key, v) {
    const ls = patterned().filter(l => l.motif);
    if (!ls.length || !canChange()) return;
    for (const l of ls) l.motif = { ...l.motif, [key]: v }; // a new object each time: the engine keeps patterns by their settings
    change({ panels: false });
  },
  setBandWidth(n) { app.bandWidth = Math.max(2, Math.min(800, Math.round(n) || 60)); requestDraw(); },
  redraw() { requestDraw(); ui.refresh(); },
  hint: () => (app.mode === 'map' ? (mapTools ? mapTools.hint() : '') : tools ? tools.hint() : ''),

  // ---- layers ----
  selected: () => app.doc.layers.find(l => l.id === app.sel) || null,
  selectedLayers,
  // several at once: the last one is the one Properties shows
  selectMany(ids) {
    const all = new Set();
    for (const id of ids) for (const m of groupOf(id)) all.add(m);
    app.sels = app.doc.layers.filter(l => all.has(l.id)).map(l => l.id);
    app.sel = app.sels[app.sels.length - 1] || null;
    if (app.sels.length < 2) app.sels = [];
    requestDraw();
    ui.refresh();
  },
  selectAll() { if (app.mode === 'paint') actions.selectMany(app.doc.layers.filter(l => l.visible && !l.locked && !isArea(l)).map(l => l.id)); },
  copy() {
    const ls = selectedLayers();
    if (ls.length) { app.clipboard = ls.map(cloneLayer); ui.refreshChrome(); }
  },
  paste(from = app.clipboard) {
    if (!from || !from.length || app.mode !== 'paint') return;
    const made = from.map((src) => {
      const l = cloneLayer(src);
      if (!/ copy$/.test(l.name)) l.name += ' copy';
      moveLayer(l, 40, 40);
      return l;
    });
    // a second paste lands beside the first, not on top of it
    if (from === app.clipboard) for (const src of from) moveLayer(src, 40, 40);
    app.doc.layers.push(...made);
    app.sel = made[made.length - 1].id;
    app.sels = made.length > 1 ? made.map(l => l.id) : [];
    change({ now: true });
  },
  duplicate() { const ls = selectedLayers(); if (ls.length) actions.paste(ls.map(cloneLayer)); },
  remove() {
    const gone = new Set(selectedLayers().map(l => l.id));
    if (!gone.size || !canChange()) return;
    if (app.mode === 'finish') app.ftarget = null;
    app.doc.layers = app.doc.layers.filter(l => !gone.has(l.id));
    app.sel = null; app.sels = [];
    pruneGroups();
    change({ now: true });
  },
  // Group: the layers are picked up together from then on
  group() {
    const ls = selectedLayers();
    if (ls.length < 2 || app.mode !== 'paint') return;
    const id = 'g' + newId();
    app.doc.groups = [...(app.doc.groups || []), { id, name: 'Group', collapsed: false }];
    for (const l of ls) l.groupId = id;
    pruneGroups();
    change({ now: true });
  },
  ungroup() {
    const ls = selectedLayers().filter(l => l.groupId);
    if (!ls.length) return;
    for (const l of ls) l.groupId = null;
    pruneGroups();
    change({ now: true });
  },
  // Merge: the selected layers become one, in the top one's place. Shapes of
  // one colour become a single shape with several pieces, which can still be
  // recoloured, faded, mirrored, trimmed and reshaped. Anything else (text,
  // pictures, shapes of different colours) can only become one picture.
  async merge() {
    if (app.mode !== 'paint') return;
    const ids = new Set(selectedLayers().map(l => l.id));
    const targets = app.doc.layers.filter(l => ids.has(l.id) && l.visible && !isArea(l)); // back to front
    if (targets.length < 2) { ui.say('Select two or more layers to merge. Ctrl+click them, or drag a box round them.'); return; }
    const top = targets[targets.length - 1], spec = finishSpec(app.doc, top);
    const same = (f) => targets.every(l => f(l) === f(top));
    const shapes = targets.every(l => isShape(l) || (isBox(l) && ['rect', 'ellipse', 'triangle'].includes(l.shape) && !l.flipH && !l.flipV));
    const sameColour = same(l => (l.color || '').toLowerCase());
    const sameRest = same(l => l.fillType || 'solid') && same(l => l.color2 || '') && same(l => l.opacity ?? 1)
      && same(l => !!l.mirrored) && same(l => JSON.stringify(finishSpec(app.doc, l))) && same(l => JSON.stringify(l.clip || null))
      && same(l => JSON.stringify(l.motif || null)); // a pattern and a plain shape are not the same thing
    // They cannot simply become one shape as they are: ask what is wanted.
    // → 'shape' (like the top one) | a colour for them all | 'group' | 'picture'
    let how = 'shape';
    if (!(shapes && sameColour && sameRest)) {
      const colours = [...new Set(targets.filter(l => l.type === 'fill').map(l => (l.color || '').toLowerCase()).filter(Boolean))];
      how = await ui.mergeChoice({ shapes, sameColour, colours, top: top.name });
      if (!how) return;
    }
    if (how === 'group') return actions.group();
    if (how !== 'picture') {
      if (how !== 'shape') { top.color = how; top.colorRef = null; keepFadeOut(top); } // the colour chosen for them all
      setShape(top, joined(targets.map(l => (isShape(l) ? l.pts : boxOutline(l.shape, l.rx, l.ry, l.rw, l.rh)))));
      top.shape = 'path';
      app.doc.layers = app.doc.layers.filter(l => l === top || !targets.includes(l));
      pruneGroups();
      app.sel = top.id; app.sels = [];
      change({ now: true });
      ui.say(`Merged ${targets.length} shapes into one. Split takes it apart again.`);
      return;
    }
    // their mirrored sides are part of what is painted, so they are part of the picture
    const sheet = paintLayers(withMirrors(withTints(withPatterns({ ...app.doc, layers: targets }))).layers, { linearEdges: true });
    const px = sheet.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
    let x0 = SIZE, y0 = SIZE, x1 = -1, y1 = -1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (px[(y * SIZE + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) { ui.say('Those layers paint nothing, so there is nothing to merge'); return; }
    const crop = document.createElement('canvas'); // just what was painted, so the layer's box is its artwork
    crop.width = x1 - x0 + 1;
    crop.height = y1 - y0 + 1;
    crop.getContext('2d').drawImage(sheet, -x0, -y0);
    const src = crop.toDataURL('image/png');
    const merged = createImageLayer(await loadImage(src), src, `${top.name} (merged)`);
    merged.x = x0 + crop.width / 2;
    merged.y = y0 + crop.height / 2;
    merged.scale = 1;
    merged.linearMix = true; // its soft edges and fades go on mixing the way its parts' did
    // one finish for the lot: the top layer's
    merged.material = spec.material; merged.matParams = spec.params ? { ...spec.params } : null; merged.finishOwn = spec.material !== 'gloss' || !!spec.params;
    const at = app.doc.layers.indexOf(top);
    app.doc.layers.splice(at, 1, merged);
    app.doc.layers = app.doc.layers.filter(l => !targets.includes(l));
    pruneGroups();
    app.sel = merged.id; app.sels = [];
    change({ now: true });
    const finishes = new Set(targets.map(l => JSON.stringify(finishSpec(app.doc, l))));
    ui.say(finishes.size > 1 ? `Merged ${targets.length} layers into a picture. They had different finishes, so it took the top one's.` : `Merged ${targets.length} layers into a picture. Ctrl+Z brings them back.`);
  },
  // Split: a shape of several pieces becomes one shape per piece again
  split() {
    const l = actions.selected();
    if (!l || !isShape(l) || app.mode !== 'paint') return;
    const parts = pieces(l.pts);
    if (parts.length < 2) return;
    const made = parts.map(([a, b], i) => {
      const c = cloneLayer(l);
      c.name = `${l.name} ${i + 1}`;
      setShape(c, l.pts.slice(a, b).map((p, k) => { const q = { x: p.x, y: p.y }; if (p.c) q.c = { ...p.c }; return q; }));
      return c;
    });
    app.doc.layers.splice(app.doc.layers.indexOf(l), 1, ...made);
    app.sel = made[made.length - 1].id;
    app.sels = made.map(x => x.id);
    change({ now: true });
  },
  order(dir) { // +1 forward, -1 back
    const L = app.doc.layers, i = L.findIndex(l => l.id === app.sel), j = i + dir;
    if (i === -1 || j < 0 || j >= L.length || !canChange()) return;
    [L[i], L[j]] = [L[j], L[i]];
    change({ now: true });
  },
  // to the very front (+1) or the very back (-1)
  orderEnd(dir) {
    const L = app.doc.layers, i = L.findIndex(l => l.id === app.sel);
    if (i === -1 || !canChange()) return;
    const [l] = L.splice(i, 1);
    dir > 0 ? L.push(l) : L.unshift(l);
    change({ now: true });
  },
  front: () => actions.orderEnd(+1),
  back: () => actions.orderEnd(-1),
  // dragged in the Layers list: put layer `id` just in front of `targetId`
  // (above it in the list), or just behind it; 'base' means the very back
  reorder(id, targetId, inFront) {
    const L = app.doc.layers, from = L.findIndex(l => l.id === id);
    if (from === -1 || id === targetId) return;
    const [l] = L.splice(from, 1);
    const at = targetId === 'base' ? -1 : L.findIndex(x => x.id === targetId);
    L.splice(targetId === 'base' ? 0 : at === -1 ? L.length : at + (inFront ? 1 : 0), 0, l);
    app.sel = id;
    change({ now: true });
  },
  forward: () => actions.order(+1),
  backward: () => actions.order(-1),
  nudge(dx, dy) {
    const ls = selectedLayers().filter(l => !l.locked);
    if (!ls.length || !canChange()) return;
    for (const l of ls) moveLayer(l, dx, dy);
    change({ panels: false });
  },
  // ---- text and pictures ----
  addText(p) {
    const l = createTextLayer();
    l.text = 'Text';
    l.name = 'Text';
    l.font = app.font;
    l.textColor = app.colour;
    l.x = Math.round(p.x); l.y = Math.round(p.y);
    regenerateText(l);
    app.doc.layers.push(l);
    app.tool = 'select';
    app.sel = l.id;
    toolChanged();
    ensureDocFonts();
    change({ now: true });
    // type straight away — once this press is over, or the sheet takes the focus back
    setTimeout(() => ui.focusField('f-text'), 0);
  },
  // one setting of the selected layer; text settings redraw the text
  setProp(key, value) {
    const l = actions.selected();
    if (!l) return;
    if (key.startsWith('fx.')) l.fx = { ...(l.fx || {}), [key.slice(3)]: value };
    else l[key] = value;
    if (l.type === 'text' && TEXT_KEYS.has(key)) {
      if (key === 'text') l.name = String(value).split('\n')[0].trim().slice(0, 24) || 'Text';
      regenerateText(l);
    }
    change({ panels: false });
  },
  setFont(name) {
    if (name === '__upload') { $('file-font').click(); ui.refresh(); return; }
    if (name === '__google') { ui.refresh(); return actions.addGoogleFont(); }
    const l = actions.selected();
    app.font = name;
    if (!l || l.type !== 'text') return;
    l.font = name;
    regenerateText(l);
    ensureDocFonts(); // a Google font arrives a moment later and the text is redrawn in it
    change({ now: true });
  },
  // any font on Google Fonts, by its name
  async addGoogleFont() {
    const typed = await ui.askText({ title: 'Add a Google font', label: 'Font name', value: '', ok: 'Add' });
    if (!typed) return;
    const clean = typed.trim().replace(/\s+/g, ' ');
    ui.say(`Looking for ${clean}…`);
    // Google's names are case-sensitive: try it as typed, then with each word capitalised
    let name = null;
    for (const cand of new Set([clean, clean.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())])) {
      if (await loadWebFont(cand)) { name = cand; break; }
    }
    if (!name) { ui.say(`No Google font called "${clean}" was found. Check the spelling and capitals.`, true); return; }
    const d = app.doc;
    d.googleFonts = [...new Set([...(d.googleFonts || []), name])];
    actions.setFont(name);
    if (!actions.selected()) change();
    ui.refresh();
    ui.say(`${name} added`);
  },
  async uploadFont(file) {
    if (file.size > 4 * 1024 * 1024) { ui.say('That font file is over 4 MB', true); return; }
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]+/g, ' ').trim() || 'custom font';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = btoa(bin);
      await registerCustomFont(name, data);
      const d = app.doc;
      d.customFonts = (d.customFonts || []).filter(f => f.name !== name); // a re-upload replaces
      d.customFonts.push({ name, data });
      actions.setFont(name);
      if (!actions.selected()) change();
      ui.say(`${name} added. It is saved with this livery.`);
    } catch {
      ui.say('That file is not a usable font', true);
    }
  },
  pickImage: () => $('file-image').click(),
  // at: where on the sheet its centre goes (the middle of the view if not given)
  async addImageFile(file, at) {
    try {
      const src = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      await actions.addImage(src, file.name.replace(/\.[^.]+$/, ''), at);
    } catch {
      ui.say('Could not read that picture', true);
    }
  },
  // keep: remember it in the library (not for the built-in graphics, which are there already)
  async addImage(src, name, at, keep = true) {
    const l = createImageLayer(await loadImage(src), src, name || 'Picture');
    if (keep && !library.logos.some(x => x.src === src)) {
      library.logos.unshift({ id: 'g' + newId(), name: name || 'Picture', src });
      library.logos.length = Math.min(library.logos.length, 80); // ponytail: the oldest fall off; add folders if 80 is ever tight
      saveLibrary();
    }
    const mid = at || screenToDoc(cv.clientWidth / 2, cv.clientHeight / 2);
    l.x = Math.round(Math.max(0, Math.min(SIZE, mid.x)));
    l.y = Math.round(Math.max(0, Math.min(SIZE, mid.y)));
    app.doc.layers.push(l);
    actions.setTool('select');
    app.sel = l.id;
    change({ now: true });
  },

  // ---- the library ----
  // Kept in this browser, across liveries: pictures you have brought in, and
  // shapes you have saved. The built-in graphics come with the app.
  async openLibrary() {
    const pick = await ui.library(library, LIBRARY, {
      remove(kind, id) { library[kind] = library[kind].filter(x => x.id !== id); saveLibrary(); },
    });
    if (!pick) return;
    if (pick.kind === 'file') return actions.pickImage();
    if (pick.kind === 'logos') return actions.addImage(pick.item.src, pick.item.name);
    if (pick.kind === 'graphics') return actions.addImage(await libraryItemToLayerSource(pick.item), pick.item.name, null, false);
    if (pick.kind === 'shapes') return actions.addShape(pick.item);
  },
  saveShape() {
    const l = actions.selected();
    if (!l || l.type !== 'fill') return;
    const item = { id: 's' + newId(), name: l.name, shape: l.shape, w: l.rw, h: l.rh };
    if (isShape(l)) item.pts = moved(l.pts, -l.rx, -l.ry); // from its own corner, so it can be put anywhere
    library.shapes.unshift(item);
    saveLibrary();
    ui.say(`${l.name} saved to the library`);
  },
  addShape(item) {
    const l = createFillLayer(app.colour), mid = screenToDoc(cv.clientWidth / 2, cv.clientHeight / 2);
    const x = Math.round(mid.x - item.w / 2), y = Math.round(mid.y - item.h / 2);
    l.name = item.name;
    l.shape = item.shape;
    if (item.pts) setShape(l, moved(item.pts, x, y));
    else { l.rx = x; l.ry = y; l.rw = item.w; l.rh = item.h; }
    app.doc.layers.push(l);
    actions.setTool('select');
    app.sel = l.id;
    change({ now: true });
  },

  // ---- colour ----
  // what the colour controls are showing: the selection's colour, else the
  // colour the next shape will get
  currentColour() {
    const l = actions.selected();
    if (app.sel === 'base') return app.doc.baseColor;
    if (l && l.type === 'text') return l.textColor || app.colour;
    return l && (l.type === 'fill' || l.type === 'image') && l.color ? l.color : app.colour;
  },
  // Sets the selection's colour (base coat or a fill) and the colour for new
  // shapes. ref: the saved colour it now follows, or null for a one-off.
  // typed: it came from a control the user is still holding, so panels stay.
  applyColour(hex, { ref = null, typed = false } = {}) {
    app.colour = hex;
    let painted = 0;
    if (app.sel === 'base') { app.doc.baseColor = hex; app.doc.baseRef = ref; syncLineColour(app.doc); painted = 1; }
    else for (const l of selectedLayers()) { // every selected shape and text takes it
      if (l.type === 'fill') { l.color = hex; l.colorRef = ref; keepFadeOut(l); painted++; }
      else if (l.type === 'text') { l.textColor = hex; l.colorRef = ref; regenerateText(l); painted++; }
      else if (l.type === 'image') { l.color = hex; l.colorRef = ref; painted++; } // the whole picture, one colour
    }
    if (!painted) { if (!typed) ui.refresh(); return; } // nothing to paint: just the next shape's colour
    change({ panels: !typed });
  },
  setColour: (hex) => actions.applyColour(hex, { typed: true }),
  // a coloured picture back to its own colours
  ownColours() {
    for (const l of selectedLayers()) if (l.type === 'image') { l.color = undefined; l.colorRef = null; }
    change();
  },
  usePalette(id) {
    const c = app.doc.palette.find(x => x.id === id);
    if (c) actions.applyColour(c.color, { ref: id });
  },
  async saveColour() {
    const d = app.doc, color = actions.currentColour();
    const name = await ui.askText({ title: 'Save this colour', label: 'Name', value: ['Main', 'Accent', 'Trim', 'Detail'][d.palette.length] || 'Colour ' + (d.palette.length + 1), ok: 'Save' });
    if (!name) return;
    const entry = { id: 'c' + newId(), name, color };
    d.palette.push(entry);
    actions.applyColour(color, { ref: entry.id }); // what is selected now follows it
    if (!actions.selected() && app.sel !== 'base') change();
  },
  async editColour(id) {
    const d = app.doc, c = d.palette.find(x => x.id === id);
    if (!c) return;
    const res = await ui.editColour(c);
    if (!res) return;
    if (res === 'delete') {
      d.palette = d.palette.filter(x => x.id !== id);
      for (const l of d.layers) if (l.colorRef === id) l.colorRef = null; // they keep the colour, just stop following
      if (d.baseRef === id) d.baseRef = null;
    } else {
      c.name = res.name || c.name;
      c.color = res.color;
      for (const l of d.layers) { // everything following it changes with it
        if (l.colorRef !== id) continue;
        if (l.type === 'text') { l.textColor = c.color; regenerateText(l); } else { l.color = c.color; keepFadeOut(l); }
      }
      if (d.baseRef === id) { d.baseColor = c.color; syncLineColour(d); }
    }
    change({ now: true });
  },
  // picking: true = for the selection (or the next shape), 'pattern' = for the selected pattern
  pickColour() { app.picking = !app.picking; toolChanged(); ui.refresh(); },
  pickPatternColour() { app.picking = app.picking === 'pattern' ? false : 'pattern'; toolChanged(); ui.refresh(); },
  setWay(w) {
    app.ways[w] = !app.ways[w];
    try { localStorage.setItem('next-ways', JSON.stringify(app.ways)); } catch { /* fine */ }
    ui.refresh();
  },

  setTheme(theme) {
    app.theme = theme;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('next-theme', theme); } catch { /* fine */ }
    requestDraw(); // the selection outline takes the accent colour
    ui.refreshChrome();
  },

  // add: Ctrl- or Shift-click — it joins the selection, or leaves it
  select(id, add = false) {
    const real = id !== 'base' && app.doc.layers.some(l => l.id === id);
    if (id !== 'base' && !real) { app.sel = null; app.sels = []; }
    else if (add && real && app.sel && app.sel !== 'base') {
      const cur = new Set(selectedLayers().map(l => l.id)), had = cur.has(id);
      for (const m of groupOf(id)) had ? cur.delete(m) : cur.add(m);
      app.sels = app.doc.layers.filter(l => cur.has(l.id)).map(l => l.id);
      app.sel = had ? app.sels[app.sels.length - 1] || null : id;
      if (app.sels.length < 2) app.sels = [];
    } else {
      const g = real ? groupOf(id) : [];
      app.sel = id;
      app.sels = g.length > 1 ? g : []; // one of a group brings the rest
    }
    requestDraw();
    ui.refresh();
  },
  setBase: (hex) => actions.applyColour(hex, { typed: true }),
};

// ---------- pointer and keys ----------

let spaceHeld = false, pan = null;
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  setZoom(app.view.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener('pointerdown', (e) => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // keys go to the sheet now
  if (e.button === 1 || (e.button === 0 && spaceHeld)) {
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('panning');
  } else if (e.button === 0) {
    cv.setPointerCapture(e.pointerId);
    onSheet().down(e, local(e));
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!pan) { onSheet().move(e, local(e)); return; }
  app.view.x += (e.clientX - pan.x) / app.view.zoom;
  app.view.y += (e.clientY - pan.y) / app.view.zoom;
  pan = { x: e.clientX, y: e.clientY };
  requestDraw();
});
const endPan = (e) => { if (!pan && app.mode !== 'map') tools.up(e, local(e)); pan = null; cv.classList.remove('panning'); };
cv.addEventListener('pointerup', endPan);
cv.addEventListener('pointercancel', endPan);
// right-click on a shape's point removes it; anywhere else the stage's menu opens
cv.addEventListener('contextmenu', (e) => {
  if (app.mode !== 'map' && tools.context(local(e))) { e.preventDefault(); e.stopPropagation(); }
});

// Shortcuts stay alive after a slider or colour box is used; only a box you
// type in swallows keys.
const typing = () => {
  const el = document.activeElement;
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'button', 'file'].includes(el.type);
};
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
  // in a box you type in, only the keys that have nothing to do with typing work
  if ($('dlg').open || (typing() && !(mod && (k === 's' || k === 'm')))) return;
  if (e.code === 'Space') { spaceHeld = true; cv.classList.add('pan'); e.preventDefault(); return; }
  if (!mod && onSheet().key(e)) { e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); actions.save(); return; }
  if (app.mode === 'map') { // the layer keys below belong to Paint
    if (mod) return;
    if (k === 'f') fit();
    else if (k === '+' || k === '=') actions.zoomBy(1.25);
    else if (k === '-') actions.zoomBy(0.8);
    else if (k === '?') ui.shortcuts();
    return;
  }
  if (app.mode === 'finish' && mod) return; // copy, paste, order and mirror belong to Paint
  if (mod && k === 'm') { e.preventDefault(); actions.mirror(); return; }
  if (mod && k === 'c') { actions.copy(); return; }
  if (mod && k === 'v') { e.preventDefault(); actions.paste(); return; }
  if (mod && k === 'd') { e.preventDefault(); actions.duplicate(); return; }
  if (mod && k === 'a') { e.preventDefault(); actions.selectAll(); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? actions.ungroup() : actions.group(); return; }
  if (mod && k === 'e') { e.preventDefault(); actions.merge(); return; }
  // e.key is } and { with Shift held on most keyboards, so go by the physical key
  if (mod && e.code === 'BracketRight') { e.preventDefault(); e.shiftKey ? actions.front() : actions.forward(); return; }
  if (mod && e.code === 'BracketLeft') { e.preventDefault(); e.shiftKey ? actions.back() : actions.backward(); return; }
  if (mod) return;
  if (k.startsWith('arrow')) {
    const step = e.shiftKey ? 10 : 1;
    e.preventDefault();
    actions.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
    return;
  }
  if (k === 'delete' || k === 'backspace') { actions.remove(); return; }
  if (k === 'escape') { actions.select(null); return; }
  if (k === 'v') actions.setTool('select');
  else if (k === 'p') actions.setTool('pen');
  else if (k === 's') actions.setTool('shape');
  else if (k === 'b' && app.mode === 'paint') actions.setTool('band');
  else if (k === 'g') actions.setTool('piece');
  else if (k === 't' && app.mode === 'paint') actions.setTool('text');
  else if (k === 'i' && app.mode === 'paint') actions.pickColour();
  else if (k === 'f') fit();
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
  if (!f) return;
  // a kit's PSD is a template; any other picture dropped on the sheet is a logo
  if (/\.psd$/i.test(f.name)) actions.loadTemplateFile(f);
  else if (app.mode === 'paint') actions.addImageFile(f, screenToDoc(...Object.values(local(e))));
});
for (const [id, fn] of [['file-image', (f) => actions.addImageFile(f)], ['file-font', (f) => actions.uploadFont(f)]]) {
  $(id).addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) fn(f);
  });
}
$('file-template').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) actions.loadTemplateFile(f);
});
$('file-map').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) actions.loadMapFile(f);
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
  try { Object.assign(app.ways, JSON.parse(localStorage.getItem('next-ways') || '{}')); } catch { /* defaults */ }
  app.doc = newDoc();
  app.custid = (await persist.loadSetting('custid').catch(() => '')) || '';
  app.live = !!(await persist.loadSetting('liveSync').catch(() => false)) && persist.fsSupported();
  if (app.live) {
    // After a reload the browser wants a click before it lets the page write
    // to the folder again. Say so on the button, instead of looking live and
    // sending nothing.
    let granted = false;
    try {
      const h = await persist.getPaintsFolder();
      granted = !!h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch { /* treated as not granted */ }
    app.liveBad = !granted;
  }
  try {
    const json = await persist.loadBlob('next-autosave');
    if (json) {
      app.doc = await deserializeDoc(JSON.parse(json));
      app.projectId = (await persist.loadSetting('next-project').catch(() => null)) || null;
      lastJson = json;
    }
  } catch { /* a bad autosave must not stop the app opening */ }
  // the sheet may already have been drawn once, from the blank livery this
  // started with, while the saved one was still loading: draw it again
  dirty = true;
  syncLineColour(app.doc);
  try {
    const lib = await persist.loadBlob('next-library');
    if (lib) library = { logos: Array.isArray(lib.logos) ? lib.logos : [], shapes: Array.isArray(lib.shapes) ? lib.shapes : [] };
  } catch { /* an empty library */ }
  ui = initUI(app, actions, VERSION);
  tools = initTools(app, {
    screenToDoc, docToScreen, change, requestDraw,
    select: actions.select, setTool: actions.setTool, toolChanged,
    say: ui.say, refreshChrome: ui.refreshChrome,
    endTrim: actions.endTrim, addText: actions.addText,
    selectedLayers, selectMany: actions.selectMany,
    // a shape made in Finish mode is an area: it paints nothing and carries a finish
    motif: (key) => motifOf(key) || { kind: 'star' },
    created(layer) {
      if (app.mode !== 'finish') return;
      layer.specOnly = true;
      layer.finishOwn = true;
      layer.material = app.finishKind;
      layer.name = 'Area ' + (app.doc.layers.filter(isArea).length + 1);
      app.ftarget = { kind: 'area', id: layer.id };
    },
    // Finish mode: a click on the sheet says what the finish applies to
    finishPick(hit, p) {
      if (!hit) {
        const inSheet = p.x >= 0 && p.y >= 0 && p.x <= SIZE && p.y <= SIZE;
        app.ftarget = inSheet ? { kind: 'colour', colour: app.doc.baseColor.toLowerCase() } : null;
        app.sel = null;
      } else {
        const c = layerColour(hit);
        app.sel = hit.id;
        app.ftarget = isArea(hit) ? { kind: 'area', id: hit.id }
          : c && !hasOwnFinish(hit) ? { kind: 'colour', colour: c, layerId: hit.id } // by colour is the quick way in
          : { kind: 'layer', id: hit.id };
      }
      requestDraw();
      ui.refresh();
    },
    // which layers the target covers, for the outline on the sheet
    finishTargets() {
      const t = app.ftarget;
      if (!t) return () => false;
      if (t.kind === 'colour') return (l) => !isArea(l) && !hasOwnFinish(l) && layerColour(l) === t.colour;
      return (l) => l.id === t.id;
    },
    mirrorImage: (l) => (l.mirrored && app.doc.regionMap ? mirrorImage(app.doc.regionMap, l) : null),
    picked(p) { // the eyedropper's click, or null when cancelled
      const forPattern = app.picking === 'pattern';
      app.picking = false;
      toolChanged();
      const hex = p && sampleColour(p);
      if (hex && forPattern) { actions.tweakMotif('color', hex); ui.refresh(); }
      else if (hex) actions.applyColour(hex); else ui.refresh();
    },
  });
  mapTools = initMap(app, {
    screenToDoc, docToScreen, requestDraw,
    say: ui.say, refreshChrome: ui.refreshChrome,
    setTool: actions.setTool, pickPiece: actions.pickPiece, mapChanged: actions.mapChanged,
  });
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
