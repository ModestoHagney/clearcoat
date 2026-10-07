// Brief → livery. A driver fills in a short brief (clearcoat-brief/1) and
// Clearcoat turns it into a few clean, panel-correct livery candidates with
// no AI: the base coat is one of the car template's own hidden "Car
// Patterns" recoloured with the brief's palette, logos drop into the kit's
// sponsor zones (main sponsor on both sides), numbers into the number zones,
// and the brief's finish becomes the materials.
//
// Everything in here is pure and deterministic for the same inputs; the
// browser-only bits (loading images, the pattern catalogue, the carpattern
// layer type) sit behind `adapter` so node tests can mock them.

import {
  SIZE, MATERIALS, createDoc, createImageLayer, createTextLayer, regenerateText,
} from './engine.js';
import * as engine from './engine.js';
import { fitToZone } from './zones.js';
import { regionById } from './regions.js';
import { newDriver } from './variants.js';

export const BRIEF_FORMAT = 'clearcoat-brief/1';

export const STYLES = ['minimal', 'clean', 'bold', 'aggressive', 'classic', 'gradient'];
export const FINISHES = ['gloss', 'matte', 'satin', 'metallic', 'pearl', 'candy', 'chrome'];

// fixed three-colour palettes for the one-word moods: slot 1 (body) and
// slot 2 (pattern) contrast hard, the accent is light or dark as the body
// needs it
import { MOODS as MOOD_TABLE } from './brief-shared.js';
// Mood palettes come from the driver-facing form's table (brief-shared.js) so
// the swatches a driver picks are exactly the colours the generator uses.
export const MOOD_PALETTES = Object.fromEntries(
  MOOD_TABLE.map(m => [m.id, { primary: m.colors[0], secondary: m.colors[1], accent: m.colors[2] }]));
export const MOODS = Object.keys(MOOD_PALETTES);

// ---------------------------------------------------------------- adapter

// Seam to the pattern catalogue (js/patterns.js) and the carpattern layer
// type (js/engine.js). The defaults work without either: no catalogue, no
// pattern layer, a local ranking heuristic. `wireAdapter` is called by
// main.js once those modules exist; tests pass their own mocks.
export const adapter = {
  // (carSlug) → Promise<catalog|null>
  loadCatalog: async () => null,
  // (catalog, id) → pattern | null
  getPattern: (catalog, id) => (catalog && catalog.patterns || []).find(p => p.id === id) || null,
  // (stats, style) → number, higher = better fit
  patternRank: null,
  // (patternId, img, colors) → carpattern layer, or null when unsupported
  createCarPatternLayer: null,
  // (layer, colors)
  setCarPatternColors: null,
};

export function wireAdapter(parts) {
  for (const k of Object.keys(adapter)) {
    if (parts && typeof parts[k] === 'function') adapter[k] = parts[k];
  }
  return adapter;
}

// self-wire anything engine.js already exports (the carpattern layer type
// lands there); patterns.js is loaded by main.js, which cannot statically
// import a module that may not exist yet
if (typeof engine.createCarPatternLayer === 'function') adapter.createCarPatternLayer = engine.createCarPatternLayer;
if (typeof engine.setCarPatternColors === 'function') adapter.setCarPatternColors = engine.setCarPatternColors;

// ---------------------------------------------------------------- helpers

// car names → catalogue / region-map slugs: lower-case, alphanumerics only
// ("Dallara P217" and "dallarap217" agree)
export function slugCar(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

export function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  const m = HEX3.exec(s);
  if (m) return '#' + m[1].split('').map(c => c + c).join('').toLowerCase();
  return null;
}

function hexRgb(hex) {
  const h = normalizeHex(hex) || '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// WCAG relative luminance 0..1
export function luminance(hex) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// the palette candidate that reads best against `bg` (first one that clears
// WCAG AA 4.5:1 wins, in order, so the palette keeps its say); white/black
// when none does
export function contrastColor(bg, candidates = []) {
  const pick = (pool, min) => {
    let best = null, bc = -1;
    for (const c of pool) {
      const r = contrastRatio(bg, c);
      if (r >= min && r > bc + 1e-9) { bc = r; best = c; }
    }
    return best;
  };
  return pick(candidates.filter(Boolean), 4.5) || pick(['#ffffff', '#111111'], 0);
}

function fail(path, msg) {
  throw new Error(`brief${path ? '.' + path : ''}: ${msg}`);
}

function optString(v, path, max = 200) {
  if (v == null) return '';
  if (typeof v !== 'string') fail(path, 'must be text');
  return v.trim().slice(0, max);
}

// ---------------------------------------------------------------- parseBrief

// Validate + normalise a brief (object or JSON string). Throws a readable
// error naming the field; never returns a partially-valid brief.
export function parseBrief(input) {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { fail('', 'not valid JSON'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('', 'not a brief object');
  if (data.format !== BRIEF_FORMAT) fail('format', `expected "${BRIEF_FORMAT}", got ${JSON.stringify(data.format)}`);

  const out = { format: BRIEF_FORMAT };
  out.car = optString(data.car, 'car', 80);
  out.team = optString(data.team, 'team', 80);
  out.notes = optString(data.notes, 'notes', 2000);

  // driver
  const d = data.driver;
  if (d != null && (typeof d !== 'object' || Array.isArray(d))) fail('driver', 'must be an object');
  const num = d && d.number != null ? String(d.number).trim() : '';
  if (num && !/^[0-9A-Za-z]{1,4}$/.test(num)) fail('driver.number', `"${num}" should be 1–4 letters or digits`);
  const custid = d && d.custid != null ? String(d.custid).trim() : '';
  if (custid && !/^\d+$/.test(custid)) fail('driver.custid', `"${custid}" should be digits only (iRacing customer ID)`);
  out.driver = { name: optString(d && d.name, 'driver.name', 60), number: num, custid };

  // palette: three hex colours, or a mood
  const p = data.palette;
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('palette', 'must be { primary, secondary, accent } or { mood }');
  if (p.mood != null) {
    const mood = String(p.mood).trim().toLowerCase();
    if (!MOOD_PALETTES[mood]) fail('palette.mood', `"${p.mood}" is not one of ${MOODS.join(', ')}`);
    out.palette = { mood };
  } else {
    const pal = {};
    for (const k of ['primary', 'secondary', 'accent']) {
      const hex = normalizeHex(p[k]);
      if (!hex) fail('palette.' + k, `${JSON.stringify(p[k] ?? null)} is not a hex colour (#rrggbb)`);
      pal[k] = hex;
    }
    out.palette = pal;
  }

  // style + finish
  const style = data.style == null ? 'clean' : String(data.style).trim().toLowerCase();
  if (!STYLES.includes(style)) fail('style', `"${data.style}" is not one of ${STYLES.join(', ')}`);
  out.style = style;
  const finish = data.finish == null ? 'gloss' : String(data.finish).trim().toLowerCase();
  if (!FINISHES.includes(finish)) fail('finish', `"${data.finish}" is not one of ${FINISHES.join(', ')}`);
  out.finish = finish;

  // logos
  const logos = data.logos == null ? [] : data.logos;
  if (!Array.isArray(logos)) fail('logos', 'must be an array');
  out.logos = logos.map((l, i) => {
    if (!l || typeof l !== 'object') fail(`logos[${i}]`, 'must be an object');
    const src = typeof l.src === 'string' ? l.src.trim() : '';
    if (!/^(data:image\/[a-z0-9.+-]+[;,]|https?:\/\/|blob:)/i.test(src)) {
      fail(`logos[${i}].src`, 'must be a data:image/… URL (or http(s) image URL)');
    }
    let priority = l.priority == null ? i + 1 : Number(l.priority);
    if (!Number.isFinite(priority) || priority < 1) fail(`logos[${i}].priority`, 'must be a number ≥ 1 (1 = main sponsor)');
    return { name: optString(l.name, `logos[${i}].name`, 60) || `logo ${i + 1}`, src, priority: Math.round(priority) };
  });
  return out;
}

// ---------------------------------------------------------------- palette

// the three slot colours a brief resolves to
export function resolvePalette(brief) {
  const p = brief.palette || {};
  if (p.mood) return { ...MOOD_PALETTES[p.mood] };
  return { primary: normalizeHex(p.primary), secondary: normalizeHex(p.secondary), accent: normalizeHex(p.accent) };
}

// ---------------------------------------------------------------- ranking

// Local stand-in for patterns.js `patternRank`: how well a pattern's stats
// suit a style. coverage/slot2/slot3/mix/edges/symmetry are 0..1.
export function defaultRank(stats, style) {
  const s = stats || {};
  const cov = s.coverage ?? 0.5, edges = s.edges ?? 0.5, sym = s.symmetry ?? 0.5, mix = s.mix ?? 0.5;
  const det = s.detail == null ? 0.5 : Math.min(1, s.detail / 0.3); // linework vs flat panel blocks
  const near = (v, t, w = 0.35) => 1 - Math.min(1, Math.abs(v - t) / w);
  if (cov < 0.02) return 0;
  switch (style) {
    case 'minimal':    return 2 * near(cov, 0.12, 0.3) + det + 0.5 * sym;
    case 'clean':      return 2 * near(cov, 0.3) + det + 0.5 * sym;
    case 'bold':       return 2 * near(cov, 0.55) + det + 0.5 * (s.slot2 ?? 0.3);
    case 'aggressive': return 1.5 * cov + 1.5 * edges + det + 0.5 * (1 - sym);
    case 'classic':    return 1.5 * sym + near(cov, 0.35) + det;
    case 'gradient':   return 2 * mix + near(cov, 0.5) * 0.5 + (1 - edges) * 0.5;
    default:           return near(cov, 0.35) + det * 0.5;
  }
}

function rankOf(stats, style) {
  const fn = typeof adapter.patternRank === 'function' ? adapter.patternRank : defaultRank;
  const r = Number(fn(stats, style));
  return Number.isFinite(r) ? r : 0;
}

// two stat blocks that would read as the same design on the car
function nearIdentical(a, b) {
  const d = (k, tol) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < tol;
  return d('coverage', 0.06) && d('slot2', 0.08) && d('edges', 0.12);
}

// Top-n patterns for a style, spread so the three aren't near-identical.
// `seed` pages through the ranked list so Regenerate shows a fresh set.
export function pickPatterns(catalog, style, n = 3, seed = 0) {
  const pats = (catalog && Array.isArray(catalog.patterns) ? catalog.patterns : []).slice();
  if (!pats.length) return [];
  const ranked = pats
    .map(p => ({ p, r: rankOf(p.stats, style) }))
    .sort((a, b) => b.r - a.r || String(a.p.id).localeCompare(String(b.p.id)));
  // rotate by seed so each Regenerate starts further down the ranking
  const off = Math.abs(Math.round(seed)) % ranked.length;
  const order = ranked.slice(off).concat(ranked.slice(0, off));
  const chosen = [], skipped = [];
  for (const e of order) {
    if (chosen.length >= n) break;
    if (chosen.some(c => nearIdentical(c.p.stats || {}, e.p.stats || {}))) { skipped.push(e); continue; }
    chosen.push(e);
  }
  for (const e of skipped) { if (chosen.length >= n) break; chosen.push(e); }
  return chosen.map(e => e.p);
}

// ---------------------------------------------------------------- zones

const area = (r) => r.w * r.h;

// sponsor zones grouped into mirror pairs (a zone and its twin), biggest
// first by combined area — a twinned zone shows a logo on both sides of the
// car, which is where the main sponsor belongs; a zone without a twin is a
// pair of one
export function sponsorPairs(regionMap) {
  const regions = (regionMap && regionMap.regions || []).filter(r => r.kind === 'sponsor');
  const used = new Set();
  const pairs = [];
  for (const r of regions) {
    if (used.has(r.id)) continue;
    used.add(r.id);
    const twin = r.mirror ? regions.find(o => o.id === r.mirror && !used.has(o.id)) : null;
    if (twin) used.add(twin.id);
    pairs.push({ regions: twin ? [r, twin] : [r], area: area(r) + (twin ? area(twin) : 0) });
  }
  pairs.sort((a, b) => b.area - a.area || a.regions[0].id.localeCompare(b.regions[0].id));
  return pairs;
}

export function numberZones(regionMap) {
  return (regionMap && regionMap.regions || []).filter(r => r.kind === 'number');
}

// ---------------------------------------------------------------- plans

// rotate [c1,c2,c3] so index k leads (fallback variety when patterns run out)
function rotateColors(colors, k) {
  const n = colors.length;
  return colors.map((_, i) => colors[(i + k) % n]);
}

// A plan is everything buildDoc needs, as plain data:
// { patternId, colors:[body, pattern, accent], finish,
//   placements:[{logoIndex, regionId, rot, mirrorOf?}], unplaced:[logoIndex],
//   number:{regionIds}, name:{regionId|null} }
export function planCandidates(brief, catalog, regionMap, n = 3, { seed = 0 } = {}) {
  const pal = resolvePalette(brief);
  const colors = [pal.primary, pal.secondary, pal.accent];
  const pats = pickPatterns(catalog, brief.style, n, seed);

  // logos by priority (1 = main), then by their order in the brief
  const logoOrder = brief.logos.map((l, i) => ({ l, i }))
    .sort((a, b) => a.l.priority - b.l.priority || a.i - b.i);
  const pairs = sponsorPairs(regionMap);
  const placements = [], unplaced = [];
  let pi = 0;
  for (const { i } of logoOrder) {
    const pair = pairs[pi++];
    if (!pair) { unplaced.push(i); continue; }
    pair.regions.forEach((r, j) => {
      const pl = { logoIndex: i, regionId: r.id, rot: r.rot || 0 };
      if (j > 0) pl.mirrorOf = pair.regions[0].id;
      placements.push(pl);
    });
  }
  const number = { regionIds: numberZones(regionMap).map(r => r.id) };
  // the name takes the largest sponsor zone the logos left free
  const nameRegion = brief.driver.name && pairs[pi] ? pairs[pi].regions[0].id : null;

  const plans = [];
  for (let k = 0; k < n; k++) {
    const pat = pats[k] || null;
    // past the last distinct pattern (or with no catalogue at all) the
    // candidates vary the colourway instead, so three cards never match
    const rot = pat ? 0 : (pats.length ? k - pats.length + 1 : k + Math.abs(Math.round(seed))) % colors.length;
    plans.push({
      patternId: pat ? pat.id : (pats.length ? pats[pats.length - 1].id : null),
      colors: rotateColors(colors, rot),
      finish: brief.finish,
      placements: placements.map(p => ({ ...p })),
      unplaced: unplaced.slice(),
      number: { regionIds: number.regionIds.slice() },
      name: { regionId: nameRegion },
    });
  }
  return plans;
}

// ---------------------------------------------------------------- buildDoc

// assets = { regionMap, logoImages: img[] (indexed like brief.logos),
//            patternImages: { [patternId]: img }, patternCar }
// Images only need width/height for placement, so tests pass plain objects.
export function buildDoc(plan, brief, assets = {}) {
  const regionMap = assets.regionMap || null;
  const [body, patColor, accent] = plan.colors;
  const finish = MATERIALS[plan.finish] ? plan.finish : 'gloss';
  const doc = createDoc();
  const who = brief.team || brief.driver.name || 'brief';
  doc.name = `${who} — ${brief.style}` + (plan.patternId ? ` ${plan.patternId}` : '');
  doc.baseColor = body;
  doc.baseMaterial = finish;
  doc.regionMap = regionMap;
  if (assets.patternCar) doc.patternCar = assets.patternCar;
  doc.brief = {
    team: brief.team, driver: { ...brief.driver }, car: brief.car, notes: brief.notes,
    patternId: plan.patternId, style: brief.style, finish,
  };

  // base coat: the car pattern recoloured with the palette
  const patImg = plan.patternId && assets.patternImages ? assets.patternImages[plan.patternId] : null;
  if (plan.patternId && patImg && typeof adapter.createCarPatternLayer === 'function') {
    const layer = adapter.createCarPatternLayer(plan.patternId, patImg, plan.colors.slice());
    if (layer) {
      layer.name = layer.name || `pattern ${plan.patternId}`;
      layer.material = finish;
      doc.layers.push(layer);
    }
  }

  // logos into their zones, turned the way the panel reads; logos stay gloss
  for (const pl of plan.placements) {
    const logo = brief.logos[pl.logoIndex];
    const img = assets.logoImages && assets.logoImages[pl.logoIndex];
    const region = regionMap && regionById(regionMap, pl.regionId);
    if (!logo || !img || !region) continue;
    const layer = createImageLayer(img, logo.src, logo.name);
    placeInZone(layer, img, region);
    layer.name = `${logo.name} · ${region.name}`;
    layer.material = 'gloss';
    doc.layers.push(layer);
  }

  // numbers in every number zone, bound to the driver variable
  const textColor = contrastColor(body, [accent, patColor]);
  const outline = contrastColor(textColor, [body]);
  for (const id of plan.number.regionIds) {
    const region = regionMap && regionById(regionMap, id);
    if (!region) continue;
    const layer = textLayer(brief.driver.number || '00', 'number', textColor, outline);
    placeInZone(layer, layer.img, region);
    layer.name = `number · ${region.name}`;
    doc.layers.push(layer);
  }

  // the driver's name, if a sponsor zone was left over
  if (plan.name.regionId && brief.driver.name) {
    const region = regionMap && regionById(regionMap, plan.name.regionId);
    if (region) {
      const layer = textLayer(brief.driver.name, 'name', textColor, outline);
      layer.font = 'Verdana';
      regenerateText(layer);
      placeInZone(layer, layer.img, region);
      layer.name = `name · ${region.name}`;
      doc.layers.push(layer);
    }
  }

  // a custid pre-fills the Drivers table so Export all drivers works at once
  if (brief.driver.custid) {
    doc.drivers = [newDriver({ name: brief.driver.name, number: brief.driver.number, custid: brief.driver.custid })];
  }
  return doc;
}

function textLayer(text, variable, color, outline) {
  const layer = createTextLayer();
  layer.text = text;
  layer.variable = variable;
  layer.font = 'Arial Black';
  layer.fontSize = 400; // rasterise big, fitToZone scales down
  layer.textColor = color;
  layer.outlineColor = outline;
  layer.outlineWidth = 0;
  regenerateText(layer);
  return layer;
}

function placeInZone(layer, img, region) {
  const w = (img && img.width) || 1, h = (img && img.height) || 1;
  const f = fitToZone(w, h, region, 0.08);
  layer.x = f.x; layer.y = f.y;
  layer.scale = f.scale; layer.scaleY = null;
  layer.rotation = f.rotation; layer.skewX = 0; layer.skewY = 0;
}

// a layer's centre, for "did it land in its zone" checks
export function insideRegion(layer, region) {
  return layer.x >= region.x && layer.x <= region.x + region.w
    && layer.y >= region.y && layer.y <= region.y + region.h;
}

// ---------------------------------------------------------------- readiness

// why a brief can't be fully honoured against the current doc, as short
// user-facing strings ([] = all good)
export function briefWarnings(brief, { regionMap, catalog, patternCar } = {}) {
  const out = [];
  const zones = regionMap && regionMap.regions ? regionMap.regions.filter(r => r.kind) : [];
  if (!zones.length) out.push('No template zones — load the car\'s template PSD first so Clearcoat can read its sponsor and number zones.');
  if (!catalog) out.push('No pattern catalogue is loaded for this car — load the car\'s template PSD first so Clearcoat can read its patterns and zones. Candidates below use a plain base coat.');
  const docCar = slugCar(patternCar || (regionMap && regionMap.car));
  if (brief.car && docCar && slugCar(brief.car) !== docCar) {
    out.push(`The brief is for "${brief.car}" but the loaded template is "${patternCar || regionMap.car}".`);
  }
  if (!brief.logos.length) out.push('The brief has no logos — sponsor zones stay empty.');
  return out;
}

export { SIZE as SHEET_SIZE };
