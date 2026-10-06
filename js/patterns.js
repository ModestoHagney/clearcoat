// Car pattern catalogue — iRacing's own designs for a car, lifted from the
// hidden "Car Patterns" group of the official template PSD.
//
// Every pattern layer is a full-sheet colour-KEYED image: pure red = colour
// slot 1 (the base), pure green = slot 2, pure blue = slot 3, with gradient
// mixes where the design fades between slots. Recolouring one with three
// chosen colours gives a panel-correct base livery with zero tracing.
//
// The catalogue lives in IndexedDB (blobs, never data URLs) keyed by the
// car slug; the only thing a project JSON carries is `doc.patternCar`.
// Everything that touches pixels is written over a Uint8ClampedArray so it
// runs in node tests without a canvas.

import { saveBlob, loadBlob, deleteBlob, saveSetting, loadSetting } from './persist.js';

export const PATTERN_FORMAT = 'clearcoat-patterns/1';
export const DEFAULT_COLORS = ['#e8e6e1', '#1a6cff', '#ffffff'];
export const PATTERN_STYLES = ['minimal', 'clean', 'bold', 'aggressive', 'classic', 'gradient'];

// ---------- naming ----------

// same slug rule as region ids: lower-case, runs of non-alphanumerics → "_"
export function carSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'car';
}

// ---------- colours ----------

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function normalizeColors(colors) {
  const out = DEFAULT_COLORS.slice();
  if (!Array.isArray(colors)) return out;
  for (let i = 0; i < 3; i++) {
    const c = colors[i];
    if (typeof c === 'string' && HEX_RE.test(c)) out[i] = c.toLowerCase();
  }
  return out;
}

function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

// ---------- recolour (pure) ----------

// Rewrites `data` (RGBA, Uint8ClampedArray) in place: each pixel's channels
// weight the three colours, wr = R/255, wg = G/255, wb = B/255, s = wr+wg+wb
// (s == 0 → slot 1), out = (wr·c1 + wg·c2 + wb·c3) / s; alpha is kept.
export function recolorPixels(data, colors) {
  const [c1, c2, c3] = normalizeColors(colors).map(hexToRgb);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const wr = data[i], wg = data[i + 1], wb = data[i + 2]; // scale cancels in the ratio
    const s = wr + wg + wb;
    if (s === 0) {
      data[i] = c1[0]; data[i + 1] = c1[1]; data[i + 2] = c1[2];
      continue;
    }
    data[i] = (wr * c1[0] + wg * c2[0] + wb * c3[0]) / s;
    data[i + 1] = (wr * c1[1] + wg * c2[1] + wb * c3[1]) / s;
    data[i + 2] = (wr * c1[2] + wg * c2[2] + wb * c3[2]) / s;
  }
  return data;
}

// keyed pattern image/canvas → recoloured canvas (a fresh one unless `out`
// is supplied; `out` is resized to the pattern)
export function recolorPattern(patternImg, colors, out) {
  const w = patternImg.naturalWidth || patternImg.width;
  const h = patternImg.naturalHeight || patternImg.height;
  const c = out || document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(patternImg, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  recolorPixels(img.data, colors);
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- stats (pure) ----------

// Per-pattern descriptors from a small (≈256 px) RGBA downsample:
//   coverage — fraction of paintable (alpha > 0) pixels that are not pure slot-1 red
//   slot2 / slot3 — weight-share of the green / blue slots over the paintable area
//   mix — fraction of paintable pixels that are gradient mixes (no channel ≥ 240)
//   edges — fraction of pixels whose colour changes sharply to a neighbour
//   symmetry — correlation of the left half with the mirrored right half (-1…1)
export function patternStats(data, w, h) {
  let n = 0, covered = 0, s2 = 0, s3 = 0, mix = 0, edges = 0;
  // scalar key for the edge / symmetry passes: where the pixel sits on the
  // red → green → blue axis, -1 for empty
  const key = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a === 0) { key[y * w + x] = -1; continue; }
      const r = data[i], g = data[i + 1], b = data[i + 2];
      n++;
      const s = r + g + b;
      if (s) { s2 += g / s; s3 += b / s; }
      const pureRed = r >= 240 && g < 16 && b < 16;
      if (!pureRed) covered++;
      if (r < 240 && g < 240 && b < 240) mix++;
      key[y * w + x] = s ? (g + 2 * b) / s : 0;
    }
  }
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const k = key[y * w + x];
      if (k < 0) continue;
      const kx = key[y * w + x + 1], ky = key[(y + 1) * w + x];
      const gx = kx < 0 ? 0 : Math.abs(kx - k);
      const gy = ky < 0 ? 0 : Math.abs(ky - k);
      if (gx + gy > 0.5) edges++;
    }
  }
  // Pearson correlation of key(x) vs key(w-1-x) over pixels painted on both sides
  let m = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const half = w >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < half; x++) {
      const a = key[y * w + x], b = key[y * w + (w - 1 - x)];
      if (a < 0 || b < 0) continue;
      m++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
  }
  let symmetry = 0;
  if (m > 1) {
    const cov = sab / m - (sa / m) * (sb / m);
    const va = saa / m - (sa / m) ** 2, vb = sbb / m - (sb / m) ** 2;
    symmetry = va > 1e-9 && vb > 1e-9 ? cov / Math.sqrt(va * vb) : (Math.abs(sa - sb) < 1e-6 ? 1 : 0);
  }
  const N = Math.max(1, n);
  return {
    coverage: covered / N,
    slot2: s2 / N,
    slot3: s3 / N,
    mix: mix / N,
    edges: edges / N,
    // colour-edge length per NON-BASE pixel: a panel-block scheme (each panel
    // one flat colour) scores ~0.05-0.1, stripes and swooshes 0.15-0.8. This is
    // what tells "design" from "two-tone panels" - coverage and edges alone
    // cannot, because both are mid-range for blocks.
    detail: edges / Math.max(covered, N * 0.01),
    symmetry: Math.max(-1, Math.min(1, symmetry)),
  };
}

export const STATS_VERSION = 2; // bump when patternStats gains a field

// ---------- style ranking (pure) ----------

const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));
const hi = (v) => clamp01(v);
const lo = (v) => 1 - clamp01(v);
const mid = (v) => 1 - Math.abs(clamp01(v) - 0.5) * 2;
const near = (v, t, w) => 1 - Math.min(1, Math.abs(clamp01(v) - t) / w); // 1 at the target, 0 beyond w

// score 0…1 for how well a pattern's stats fit a named style; unknown style
// (or 'all') ranks every pattern equally
export function patternRank(stats, style) {
  if (!stats) return 0;
  const cov = clamp01(stats.coverage);
  if (cov < 0.02 && style && style !== 'all') return 0; // an all-base pattern is no design at all
  const edg = clamp01((stats.edges || 0) * 6);   // ~0.15 edge density is "busy"
  const mx = clamp01((stats.mix || 0) * 3);      // ~0.33 gradient share is "all gradient"
  const sym = clamp01(((stats.symmetry || 0) + 1) / 2);
  // detail: 0.15 is where a scheme stops being flat panel blocks; 0.3+ is
  // real linework. Missing (old catalogue) -> neutral 0.5.
  const det = stats.detail == null ? 0.5 : clamp01(stats.detail / 0.3);
  switch (style) {
    case 'minimal': return lo(cov) * 0.5 + hi(det) * 0.5;
    case 'clean': return near(cov, 0.3, 0.25) * 0.4 + lo(mx) * 0.1 + hi(det) * 0.3 + lo(edg) * 0.2;
    case 'bold': return hi(cov) * 0.6 + hi(det) * 0.2 + lo(mx) * 0.2;
    case 'aggressive': return hi(edg) * 0.4 + hi(det) * 0.3 + hi(cov) * 0.3;
    case 'classic': return mid(cov) * 0.3 + hi(sym) * 0.3 + hi(det) * 0.2 + lo(mx) * 0.2;
    case 'gradient': return hi(mx) * 0.8 + hi(cov) * 0.2;
    default: return 1;
  }
}

// ---------- catalogue ----------

// entries: [{ id?, name, index?, blob, thumb, stats, width?, height? }]
export function buildCatalog(car, entries) {
  const seen = new Set();
  const patterns = [];
  for (const e of entries || []) {
    if (!e || !e.blob) continue;
    const name = String(e.name || '');
    const index = Number.isFinite(e.index) ? e.index
      : (() => { const m = name.match(/(\d+)/); return m ? parseInt(m[1], 10) : patterns.length; })();
    let id = e.id || name.replace(/\.[^.]+$/, '').toLowerCase() || ('pattern_' + index);
    while (seen.has(id)) id += '_';
    seen.add(id);
    patterns.push({
      id, name, index,
      width: e.width || 0, height: e.height || 0,
      blob: e.blob,            // PNG Blob of the keyed full-size pattern
      thumb: e.thumb || null,  // small data URL (≈256 px) for pickers
      stats: e.stats || null,
    });
  }
  patterns.sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  return {
    format: PATTERN_FORMAT,
    car: car || 'unknown car',
    slug: carSlug(car),
    createdAt: Date.now(),
    patterns,
  };
}

export function getPattern(catalog, id) {
  if (!catalog || !Array.isArray(catalog.patterns)) return null;
  return catalog.patterns.find(p => p.id === id) || null;
}

const INDEX_KEY = 'patternCatalogs';
const key = (slug) => 'patterns:' + slug;

// index of saved catalogues: [{ slug, car, count, savedAt }]
export async function listCatalogs() {
  const list = await loadSetting(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

export async function saveCatalog(catalog) {
  if (!catalog || catalog.format !== PATTERN_FORMAT) throw new Error('not a pattern catalogue');
  const slug = catalog.slug || carSlug(catalog.car);
  await saveBlob(key(slug), { ...catalog, slug });
  const index = (await listCatalogs()).filter(c => c.slug !== slug);
  index.push({ slug, car: catalog.car, count: catalog.patterns.length, savedAt: Date.now() });
  index.sort((a, b) => a.car.localeCompare(b.car));
  await saveSetting(INDEX_KEY, index);
  return slug;
}

// null when nothing is stored for the slug
export async function loadCatalog(carSlugOrName) {
  if (!carSlugOrName) return null;
  const cat = await loadBlob(key(carSlug(carSlugOrName)));
  if (!(cat && cat.format === PATTERN_FORMAT && Array.isArray(cat.patterns))) return null;
  if (await upgradeStats(cat)) await saveCatalog(cat).catch(() => {});
  return cat;
}

// Catalogues saved before a stats field existed get it recomputed from their
// thumbnails (browser only). Returns true when anything changed.
export async function upgradeStats(cat) {
  if (typeof document === 'undefined') return false;
  let changed = false;
  for (const p of cat.patterns) {
    if (p.stats && p.stats.detail != null) continue;
    if (!p.thumb) continue;
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = p.thumb; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
      p.stats = patternStats(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      changed = true;
    } catch { /* leave stats as they were */ }
  }
  if (changed) cat.statsVersion = STATS_VERSION;
  return changed;
}

export async function deleteCatalog(slug) {
  await deleteBlob(key(slug));
  await saveSetting(INDEX_KEY, (await listCatalogs()).filter(c => c.slug !== slug));
}

// ---------- browser helpers ----------

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// a pattern entry's full-size keyed image, loaded from its blob through a
// data URL (so the resulting img.src can travel inside the project JSON);
// cached on the entry
export async function patternImage(entry) {
  if (entry._img) return entry._img;
  const src = await blobToDataURL(entry.blob);
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Could not decode the pattern'));
    im.src = src;
  });
  entry._img = img;
  return img;
}
