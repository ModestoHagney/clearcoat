// Clearcoat template intelligence — pure helpers that turn the hidden
// "Sponsor" / "Numbers" / "Mask" / decal layers of an official iRacing
// template PSD into usable facts: sponsor + number zones (rectangles),
// which zones are twins of each other, how a twin reads (mirrored or turned
// 180°), where paint is allowed, and how much of a layer bleeds off-paint.
//
// Everything here works on ImageData-like objects ({ width, height, data })
// so it runs in Node tests without a canvas. All coordinates are sheet
// pixels (the 2048 UV sheet).

import { uniqueRegionId } from './regions.js';

// ---------- connected components ----------

// 4-connected components of alpha > thresh, as bounding rectangles sorted
// top-to-bottom then left-to-right. Components under minArea pixels are
// dropped (anti-aliasing crumbs, stray marks).
export function alphaComponents(img, minArea = 300, thresh = 0) {
  const W = img.width, H = img.height, d = img.data;
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || d[start * 4 + 3] <= thresh) continue;
    let x1 = W, y1 = H, x2 = -1, y2 = -1, area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i - x) / W;
      area++;
      if (x < x1) x1 = x; if (x > x2) x2 = x;
      if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (x > 0 && !seen[i - 1] && d[(i - 1) * 4 + 3] > thresh) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && !seen[i + 1] && d[(i + 1) * 4 + 3] > thresh) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - W] && d[(i - W) * 4 + 3] > thresh) { seen[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && !seen[i + W] && d[(i + W) * 4 + 3] > thresh) { seen[i + W] = 1; stack.push(i + W); }
    }
    if (area >= minArea) out.push({ x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1, area });
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x);
  return out;
}

// ---------- twins ----------

const cy = (r) => r.y + r.h / 2;

// two rectangles are vertical twins when they share an x-span and size
// (within tol) and their centres mirror about `axis`
function isTwin(a, b, axis, tol) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol
    && Math.abs((cy(a) + cy(b)) / 2 - axis) <= tol;
}

// The sheet's mirror line. Most kits fold about y = 1024, but not all (the
// BMW M4 GT4 folds about y ≈ 766), so the axis is voted from every pair of
// same-size, same-column rectangles; ties fall back to `fallback`.
export function detectMirrorAxis(rects, { tol = 6, fallback = 1024 } = {}) {
  const mids = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (Math.abs(a.x - b.x) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol) {
        mids.push((cy(a) + cy(b)) / 2);
      }
    }
  }
  if (!mids.length) return fallback;
  let best = fallback, bestN = 0;
  for (const m of mids) {
    const n = mids.filter(o => Math.abs(o - m) <= tol).length;
    const closer = Math.abs(m - fallback) < Math.abs(best - fallback);
    if (n > bestN || (n === bestN && closer)) { best = m; bestN = n; }
  }
  // a lone coincidence is not an axis — only trust a cluster of >= 2 pairs
  if (bestN < 2) return fallback;
  // the standard fold wins when the vote lands within tolerance of it
  return Math.abs(best - fallback) <= tol ? fallback : Math.round(best);
}

// index pairs [i, j] of twin rectangles; each rectangle joins one pair at most
export function pairTwins(rects, axis, tol = 6) {
  const used = new Set();
  const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < rects.length; j++) {
      if (used.has(j)) continue;
      if (isTwin(rects[i], rects[j], axis, tol)) { pairs.push([i, j]); used.add(i); used.add(j); break; }
    }
  }
  return pairs;
}

// ---------- zones → regions ----------

const KIND_LABEL = { sponsor: 'Sponsor', number: 'Number' };

// Turn template zones ({ kind, x, y, w, h }) into region-map regions: ids
// like sponsor_1, names like "Sponsor 3 (349×93)", twins paired as mirrors
// with mirrorKind 'flipV' (a vertical twin, before any decal inference
// refines it). `map` is only consulted for id collisions.
export function zonesToRegions(zones, map, { axis, tol = 6 } = {}) {
  const sorted = [...zones].sort((a, b) => a.y - b.y || a.x - b.x);
  const counts = {};
  const scratch = { regions: [...((map && map.regions) || [])] };
  const regions = sorted.map(z => {
    const label = KIND_LABEL[z.kind] || 'Zone';
    const n = (counts[z.kind] = (counts[z.kind] || 0) + 1);
    const id = uniqueRegionId(`${z.kind}_${n}`, scratch);
    const r = {
      id,
      name: `${label} ${n} (${z.w}×${z.h})`,
      x: z.x, y: z.y, w: z.w, h: z.h,
      kind: z.kind, rot: 0,
    };
    scratch.regions.push(r);
    return r;
  });
  const ax = Number.isFinite(axis) ? axis : detectMirrorAxis(regions, { tol });
  for (const [i, j] of pairTwins(regions, ax, tol)) {
    regions[i].mirror = regions[j].id;
    regions[j].mirror = regions[i].id;
    regions[i].mirrorKind = regions[j].mirrorKind = 'flipV';
  }
  return { regions, axis: ax };
}

// ---------- decal orientation probes ----------

// luminance × alpha of a rectangle of an RGBA image → { w, h, data }
export function blobGray(img, r) {
  const out = new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const i = ((r.y + y) * img.width + (r.x + x)) * 4;
      out[y * r.w + x] = (0.3 * img.data[i] + 0.59 * img.data[i + 1] + 0.11 * img.data[i + 2]) * (img.data[i + 3] / 255);
    }
  }
  return { w: r.w, h: r.h, data: out };
}

// Pearson correlation of B against A under a transform; both are centre-
// cropped to their common size so near-identical twins (a pixel or two off)
// still line up.
function correlate(A, B, mapXY) {
  const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
  const ax0 = (A.w - w) >> 1, ay0 = (A.h - h) >> 1, bx0 = (B.w - w) >> 1, by0 = (B.h - h) >> 1;
  const n = w * h;
  let sa = 0, sb = 0;
  const av = new Float32Array(n), bv = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = mapXY(x, y, w, h);
      const a = A.data[(ay0 + sy) * A.w + ax0 + sx];
      const b = B.data[(by0 + y) * B.w + bx0 + x];
      av[y * w + x] = a; bv[y * w + x] = b;
      sa += a; sb += b;
    }
  }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const a = av[i] - ma, b = bv[i] - mb;
    num += a * b; da += a * a; db += b * b;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

// How blob B relates to blob A: 'rot180' (B is A turned 180°), 'flipV'
// (B is A reflected top↔bottom) or 'same' (B is a plain copy). `margin` is
// the lead over the runner-up — below ~0.1 the blob is too symmetric to tell.
export function twinRelation(A, B) {
  const scores = {
    rot180: correlate(A, B, (x, y, w, h) => [w - 1 - x, h - 1 - y]),
    flipV: correlate(A, B, (x, y, w, h) => [x, h - 1 - y]),
    same: correlate(A, B, (x, y) => [x, y]),
  };
  const ranked = Object.entries(scores).sort((p, q) => q[1] - p[1]);
  return { kind: ranked[0][0], margin: ranked[0][1] - ranked[1][1], scores };
}

// Find twin blobs in the kit's stock-decal composite and classify how each
// pair reads. Returns [{ a, b, kind, margin }] with a the upper blob; only
// confident pairs (margin ≥ minMargin) are kept.
export function inferDecalPairs(img, { minArea = 400, axis = 1024, relTol = 0.15, minMargin = 0.1 } = {}) {
  const blobs = alphaComponents(img, minArea);
  const grays = new Map();
  const gray = (r) => { if (!grays.has(r)) grays.set(r, blobGray(img, r)); return grays.get(r); };
  const pairs = [];
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      const tol = relTol * Math.max(a.w, a.h) + 4;
      if (!isTwin(a, b, axis, tol)) continue;
      const rel = twinRelation(gray(a), gray(b));
      if (rel.margin < minMargin) continue;
      pairs.push({ a: cy(a) <= cy(b) ? a : b, b: cy(a) <= cy(b) ? b : a, kind: rel.kind, margin: rel.margin });
    }
  }
  return pairs;
}

// Give each region the reading of the nearest decal pair on its own half of
// the sheet: in a 'rot180' pair the UPPER region gets rot = 180 (the lower
// stays 0) and the mirror pair becomes mirrorKind 'rot180'; 'flipV' / 'same'
// pairs keep rot 0 with the matching mirrorKind. Regions that straddle the
// axis (centre-line panels) are left alone. Returns how many regions changed.
export function applyOrientation(regions, pairs, axis = 1024) {
  if (!pairs.length) return 0;
  const picks = new Map(); // region → { kind, dist }
  for (const r of regions) {
    const rcy = cy(r), rcx = r.x + r.w / 2;
    if (Math.abs(rcy - axis) < r.h / 2) continue; // straddles the fold
    const top = rcy < axis;
    let best = null;
    for (const p of pairs) {
      const blob = top ? p.a : p.b;
      const dist = Math.hypot(blob.x + blob.w / 2 - rcx, cy(blob) - rcy);
      if (!best || dist < best.dist) best = { kind: p.kind, dist, top };
    }
    if (best) picks.set(r, best);
  }
  // mirrored partners must agree — the closer probe wins for both
  const byId = new Map(regions.map(r => [r.id, r]));
  for (const r of regions) {
    const m = r.mirror ? byId.get(r.mirror) : null;
    if (!m || !picks.has(r) || !picks.has(m)) continue;
    const pr = picks.get(r), pm = picks.get(m);
    if (pr.kind !== pm.kind) {
      const win = pr.dist <= pm.dist ? pr : pm;
      picks.set(r, { ...pr, kind: win.kind });
      picks.set(m, { ...pm, kind: win.kind });
    }
  }
  let changed = 0;
  for (const [r, p] of picks) {
    const rot = p.kind === 'rot180' && p.top ? 180 : 0;
    const mk = r.mirror ? (p.kind === 'rot180' ? 'rot180' : p.kind === 'same' ? 'same' : 'flipV') : undefined;
    if ((r.rot || 0) !== rot || (mk && r.mirrorKind !== mk)) changed++;
    r.rot = rot;
    if (mk) r.mirrorKind = mk;
  }
  return changed;
}

// ---------- fit + bleed ----------

// Placement that fits an imgW×imgH raster inside a region with a margin,
// centred, turned by the region's rot (90/270 swap the raster's axes).
export function fitToZone(imgW, imgH, region, margin = 0.08) {
  const rot = ((region.rot || 0) % 360 + 360) % 360;
  const availW = region.w * (1 - 2 * margin), availH = region.h * (1 - 2 * margin);
  const [ew, eh] = rot === 90 || rot === 270 ? [imgH, imgW] : [imgW, imgH];
  const scale = Math.min(availW / Math.max(1, ew), availH / Math.max(1, eh));
  return { x: Math.round(region.x + region.w / 2), y: Math.round(region.y + region.h / 2), scale, rotation: rot };
}

// nearest region to a point: the one containing it, else the smallest
// centre distance (null for an empty map)
export function nearestRegion(map, x, y) {
  if (!map || !map.regions.length) return null;
  let best = null, bd = Infinity;
  for (let i = map.regions.length - 1; i >= 0; i--) {
    const r = map.regions[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    const d = Math.hypot(r.x + r.w / 2 - x, cy(r) - y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

// Fraction of a layer's opaque pixels (alpha > 12) that land where the paint
// mask says "not paintable" (red channel < 128). Both images share a size.
// null when the layer has no opaque pixels at all.
export function offPaintFraction(layerImg, maskImg) {
  const n = Math.min(layerImg.width * layerImg.height, maskImg.width * maskImg.height);
  let opaque = 0, off = 0;
  for (let i = 0; i < n; i++) {
    if (layerImg.data[i * 4 + 3] <= 12) continue;
    opaque++;
    if (maskImg.data[i * 4] < 128) off++;
  }
  return opaque ? off / opaque : null;
}
