// PSD template import — extracts the wireframe from official iRacing template PSDs
// so users never need Photoshop. Uses ag-psd, vendored locally (js/vendor/ag-psd.min.js)
// and lazy-loaded only when a .psd is actually opened (keeps the core app load lean,
// with zero runtime CDN dependencies).

import { SIZE } from './engine.js';
import { detectPieces } from './regions.js';
import { alphaComponents } from './zones.js';
import { patternStats } from './patterns.js';

let agPsdPromise = null;

function loadAgPsd() {
  if (window.agPsd) return Promise.resolve(window.agPsd);
  if (!agPsdPromise) {
    agPsdPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/ag-psd.min.js';
      s.onload = () => window.agPsd ? resolve(window.agPsd) : reject(new Error('PSD reader failed to initialize'));
      s.onerror = () => { agPsdPromise = null; reject(new Error('Could not load the PSD reader')); };
      document.head.appendChild(s);
    });
  }
  return agPsdPromise;
}

// Layer/group names that look like wireframe linework in iRacing template PSDs.
const WIRE_RE = /(wire|outline|line\s?art|\blines?\b|contour|panel\s?lines|template\s?lines)/i;
// Names that are clearly not reference linework even if a parent group matched.
const SKIP_RE = /(background|bkg|paint\s?here|fill|color|colour|sample|example)/i;

// NOTE: official iRacing templates ship the wireframe layer ("Wire") hidden,
// so hidden layers are still collected — visibility only matters for the
// non-wireframe fallback composite.
function collectLayers(children, parentMatched, parentHidden, out) {
  for (const layer of children || []) {
    const name = layer.name || '';
    if (SKIP_RE.test(name)) continue;
    const matched = parentMatched || WIRE_RE.test(name);
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) {
      collectLayers(layer.children, matched, hidden, out);
    } else if (layer.canvas) {
      out.push({ layer, matched, hidden });
    }
  }
}

// every raster layer with its effective hidden state — no name filtering
function collectAllLayers(children, parentHidden, out) {
  for (const layer of children || []) {
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) collectAllLayers(layer.children, hidden, out);
    else if (layer.canvas) out.push({ layer, hidden });
  }
}

function drawLayers(ctx, entries) {
  for (const { layer } of entries) {
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  }
  ctx.globalAlpha = 1;
}

// Every wireframe layer at full strength on a clear canvas, colours as drawn.
// `src` above puts the same layers on white, where a kit's white mesh lines
// vanish; a caller that wants those too reads them from here.
function wireCanvas(psd, wires) {
  const c = document.createElement('canvas');
  c.width = psd.width;
  c.height = psd.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const { layer } of wires) ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  return c;
}

// Outlines of the sheet's pieces, read from the wireframe layers and scaled to
// 2048-sheet space (see detectPieces). Empty when the wireframe does not split
// into separate pieces, e.g. linework flattened onto an opaque background.
function wirePieces(psd, wires) {
  const c = document.createElement('canvas');
  c.width = psd.width;
  c.height = psd.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // full strength, whatever the layer's opacity — only the line shapes matter
  for (const { layer } of wires) ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const mask = new Uint8Array(c.width * c.height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  const pieces = detectPieces(mask, c.width, c.height);
  if (pieces.length < 2) return [];
  const kx = SIZE / c.width, ky = SIZE / c.height;
  return pieces.map(pts => pts.map(q => ({ x: q.x * kx, y: q.y * ky })));
}

// ---------- template intelligence (zones / mask / decals) ----------
// Official kits ship hidden helper layers: "Sponsor"/"Sponsor Blocks" and
// "Numbers"/"Number Blocks" are solid rectangles marking the official decal
// zones; "Mask" is INVERTED (alpha > 0 = not paintable); "Car_decal" /
// "Color Change Logos" / "IMSA LOGOS" hold the kit's stock decals, whose
// orientation reveals how each panel reads. Hidden layers still carry a
// canvas in ag-psd; every layer is positioned by its left/top offset.

const SPONSOR_RE = /sponsor/i;
const NUMBER_RE = /number/i;
const NUMBER_SKIP_RE = /leaderboard|official/i; // alt-series variants of the same blocks
const MASK_RE = /^\s*mask\s*$/i;
const DECAL_RE = /(decal|logos?)\b/i;

function zoneKind(name) {
  if (SPONSOR_RE.test(name)) return 'sponsor';
  if (NUMBER_RE.test(name) && !NUMBER_SKIP_RE.test(name)) return 'number';
  return null;
}

// one positioned composite of several layers (full opacity, alpha-over)
function composeLayers(layers, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const layer of layers) ctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
  return c;
}

// zones from the sponsor/number block layers: one rectangle per connected
// component, crumbs under 300 px² dropped
function extractZones(entries, w, h) {
  const byKind = { sponsor: [], number: [] };
  for (const { layer } of entries) {
    const k = zoneKind(layer.name || '');
    if (k) byKind[k].push(layer);
  }
  const zones = [];
  for (const kind of ['sponsor', 'number']) {
    if (!byKind[kind].length) continue;
    const img = composeLayers(byKind[kind], w, h).getContext('2d').getImageData(0, 0, w, h);
    for (const r of alphaComponents(img, 300)) zones.push({ kind, x: r.x, y: r.y, w: r.w, h: r.h });
  }
  return zones;
}

// the inverted Mask layer → a greyscale canvas where paintable = white
function extractPaintMask(entries, w, h) {
  const mask = entries.find(e => MASK_RE.test(e.layer.name || ''));
  if (!mask) return null;
  const c = composeLayers([mask.layer], w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + 3] > 127 ? 0 : 255; // marked = not paintable
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// visible stock-decal layers composed in place (hidden alt-series variants
// would double every blob, so they stay out)
function extractDecals(entries, w, h) {
  const decals = entries.filter(e => !e.hidden && DECAL_RE.test(e.layer.name || '') && !zoneKind(e.layer.name || ''));
  return decals.length ? composeLayers(decals.map(e => e.layer), w, h) : null;
}

// ---------- car patterns ----------
// Official kits hide a "Car Patterns" group: ~24 full-sheet layers named
// car_pattern_000.tga … — iRacing's own designs for this exact car, already
// correct across every panel, COLOUR-KEYED (red = slot 1, green = slot 2,
// blue = slot 3, gradient mixes between). See patterns.js for the catalogue.

const PATTERN_LAYER_RE = /car_pattern_\d+/i;
const PATTERN_GROUP_RE = /pattern/i;
const PATTERN_SKIP_RE = /spec/i; // "_spec" siblings are spec maps, not keyed designs
const THUMB_PX = 256;

function collectPatternLayers(children, inGroup, out) {
  for (const layer of children || []) {
    const name = layer.name || '';
    if (layer.children) {
      collectPatternLayers(layer.children, inGroup || PATTERN_GROUP_RE.test(name), out);
    } else if (layer.canvas && (inGroup || PATTERN_LAYER_RE.test(name)) && !PATTERN_SKIP_RE.test(name)) {
      out.push(layer);
    }
  }
}

function canvasToBlob(c) {
  return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/png'));
}

// One layer at a time: 24 × 2048² RGBA raw is ~400 MB, so each sheet is
// encoded to a PNG blob straight away (3-tone images compress to a few
// hundred KB) and its canvas dropped before the next one is rendered.
// Returns catalogue entries [{ name, index, blob, thumb, stats, width, height }].
async function extractCarPatterns(psd) {
  const layers = [];
  collectPatternLayers(psd.children, false, layers);
  if (!layers.length) return [];
  const w = psd.width, h = psd.height;
  const sheet = document.createElement('canvas');
  sheet.width = w; sheet.height = h;
  const sctx = sheet.getContext('2d');
  const small = document.createElement('canvas');
  const s = Math.min(1, THUMB_PX / Math.max(w, h));
  small.width = Math.max(1, Math.round(w * s)); small.height = Math.max(1, Math.round(h * s));
  const smctx = small.getContext('2d', { willReadFrequently: true });
  const entries = [];
  for (const layer of layers) {
    try {
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(layer.canvas, layer.left || 0, layer.top || 0);
      const blob = await canvasToBlob(sheet);
      smctx.clearRect(0, 0, small.width, small.height);
      smctx.drawImage(sheet, 0, 0, small.width, small.height);
      const img = smctx.getImageData(0, 0, small.width, small.height);
      const stats = patternStats(img.data, small.width, small.height);
      const name = layer.name || '';
      const m = name.match(/(\d+)/);
      entries.push({
        name, index: m ? parseInt(m[1], 10) : entries.length,
        blob, thumb: small.toDataURL('image/png'), stats, width: w, height: h,
      });
    } catch { /* one bad layer never sinks the catalogue */ }
  }
  sheet.width = sheet.height = 1; // release the backing store now, not at GC
  return entries;
}

// Returns { src (PNG dataURL), usedWireframe (bool), pieces, zones, paintMask, decals, patterns }
//   pieces    — outlines of the sheet's pieces from the wireframe ([] when there are none)
//   zones     — [{ kind: 'sponsor'|'number', x, y, w, h }] ([] when the kit has no block layers)
//   paintMask — greyscale canvas, paintable = 255 (null without a Mask layer)
//   decals    — RGBA canvas of the stock decals, for orientation probing (null if none)
//   patterns  — car pattern catalogue entries (see extractCarPatterns; [] without the group)
export async function psdToTemplate(arrayBuffer) {
  const agPsd = await loadAgPsd();
  const psd = agPsd.readPsd(arrayBuffer);

  const out = document.createElement('canvas');
  out.width = psd.width;
  out.height = psd.height;
  const ctx = out.getContext('2d');
  // white base so the multiply overlay shows only the linework
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);

  const entries = [];
  collectLayers(psd.children, false, false, entries);
  const wires = entries.filter(e => e.matched);

  // helper layers are walked without SKIP_RE (it drops "Color Change Logos")
  const all = [];
  collectAllLayers(psd.children, false, all);
  let intel = { zones: [], paintMask: null, decals: null, patterns: [] };
  try {
    intel = {
      zones: extractZones(all, psd.width, psd.height),
      paintMask: extractPaintMask(all, psd.width, psd.height),
      decals: extractDecals(all, psd.width, psd.height),
      patterns: [],
    };
  } catch { /* intelligence is a bonus — the wireframe still loads */ }
  try {
    intel.patterns = await extractCarPatterns(psd);
  } catch { intel.patterns = []; /* a kit without the group yields an empty catalogue */ }

  if (wires.length) {
    drawLayers(ctx, wires);
    return { src: out.toDataURL('image/png'), usedWireframe: true, pieces: wirePieces(psd, wires), wire: wireCanvas(psd, wires), ...intel };
  }
  // no wireframe-named layers — fall back to the flattened composite
  if (psd.canvas) {
    ctx.drawImage(psd.canvas, 0, 0);
  } else {
    drawLayers(ctx, entries.filter(e => !e.hidden));
  }
  return { src: out.toDataURL('image/png'), usedWireframe: false, pieces: [], ...intel };
}
