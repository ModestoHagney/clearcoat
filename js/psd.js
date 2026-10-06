// PSD template import — extracts the wireframe from official iRacing template PSDs
// so users never need Photoshop. Uses ag-psd, vendored locally (js/vendor/ag-psd.min.js)
// and lazy-loaded only when a .psd is actually opened (keeps the core app load lean,
// with zero runtime CDN dependencies).

import { alphaComponents } from './zones.js';

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

// Returns { src (PNG dataURL), usedWireframe (bool), zones, paintMask, decals }
//   zones     — [{ kind: 'sponsor'|'number', x, y, w, h }] ([] when the kit has no block layers)
//   paintMask — greyscale canvas, paintable = 255 (null without a Mask layer)
//   decals    — RGBA canvas of the stock decals, for orientation probing (null if none)
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
  let intel = { zones: [], paintMask: null, decals: null };
  try {
    intel = {
      zones: extractZones(all, psd.width, psd.height),
      paintMask: extractPaintMask(all, psd.width, psd.height),
      decals: extractDecals(all, psd.width, psd.height),
    };
  } catch { /* intelligence is a bonus — the wireframe still loads */ }

  if (wires.length) {
    drawLayers(ctx, wires);
    return { src: out.toDataURL('image/png'), usedWireframe: true, ...intel };
  }
  // no wireframe-named layers — fall back to the flattened composite
  if (psd.canvas) {
    ctx.drawImage(psd.canvas, 0, 0);
  } else {
    drawLayers(ctx, entries.filter(e => !e.hidden));
  }
  return { src: out.toDataURL('image/png'), usedWireframe: false, ...intel };
}
