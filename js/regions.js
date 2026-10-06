// Clearcoat region maps — labeled areas over the 2048 UV sheet with mirror
// relationships ("Left Door mirrors Right Door"). Pure data helpers; all
// coordinates are in 2048-sheet space. Every region has a rectangle (x, y, w,
// h); one may also carry "points", an outline of its real shape, in which case
// the rectangle is that outline's bounding box. A map may also carry "links":
// pairs of edge stretches that meet on the car (see the seam links section).

export const REGIONS_FORMAT = 'clearcoat-regions/1';

export function createRegionMap(car) {
  return { format: REGIONS_FORMAT, car: car || 'unknown car', regions: [] };
}

// validate + normalize a parsed JSON value into a region map; throws with a
// readable message on anything malformed
export function parseRegionMap(data) {
  if (!data || typeof data !== 'object') throw new Error('not a region map object');
  if (data.format !== REGIONS_FORMAT) throw new Error(`unknown format "${data.format}" (expected ${REGIONS_FORMAT})`);
  if (!Array.isArray(data.regions)) throw new Error('missing "regions" array');
  const seen = new Set();
  const regions = data.regions.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`region ${i} is not an object`);
    if (typeof r.id !== 'string' || !r.id) throw new Error(`region ${i} has no id`);
    if (seen.has(r.id)) throw new Error(`duplicate region id "${r.id}"`);
    seen.add(r.id);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (!Number.isFinite(r[k])) throw new Error(`region "${r.id}" has a bad "${k}"`);
    }
    if (r.w <= 0 || r.h <= 0) throw new Error(`region "${r.id}" has a non-positive size`);
    const out = {
      id: r.id,
      name: typeof r.name === 'string' && r.name ? r.name : r.id,
      x: r.x, y: r.y, w: r.w, h: r.h,
    };
    if (typeof r.mirror === 'string' && r.mirror) out.mirror = r.mirror;
    if (r.center !== undefined) {
      const { a, b } = r.center || {};
      const ok = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
      if (!ok(a) || !ok(b) || (a.x === b.x && a.y === b.y)) throw new Error(`region "${r.id}" has a bad "center"`);
      out.center = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    }
    if (r.points !== undefined) {
      if (!Array.isArray(r.points) || r.points.length < 3
          || !r.points.every(q => q && Number.isFinite(q.x) && Number.isFinite(q.y))) {
        throw new Error(`region "${r.id}" has a bad "points" outline`);
      }
      out.points = r.points.map(q => ({ x: q.x, y: q.y }));
    }
    return out;
  });
  for (const r of regions) {
    if (r.mirror && !seen.has(r.mirror)) throw new Error(`region "${r.id}" mirrors unknown id "${r.mirror}"`);
  }
  const map = {
    format: REGIONS_FORMAT,
    car: typeof data.car === 'string' && data.car ? data.car : 'unknown car',
    regions,
  };
  if (data.links !== undefined) {
    if (!Array.isArray(data.links)) throw new Error('"links" is not an array');
    const pt = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.y);
    map.links = data.links.map((l, i) => {
      const out = {};
      for (const side of ['a', 'b']) {
        const e = l && l[side];
        if (!e || !pt(e.from) || !pt(e.to)) throw new Error(`link ${i} has a bad "${side}" end`);
        if (!seen.has(e.region)) throw new Error(`link ${i} joins unknown region "${e.region}"`);
        out[side] = { region: e.region, from: { x: e.from.x, y: e.from.y }, to: { x: e.to.x, y: e.to.y } };
        if (e.dir === 1 || e.dir === -1) out[side].dir = e.dir;
      }
      return out;
    });
  }
  return map;
}

export function regionById(map, id) {
  return map.regions.find(r => r.id === id) || null;
}

// even-odd test: is (x, y) inside the closed outline?
export function pointInPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// topmost-last: later entries win where regions overlap
export function regionAt(map, x, y) {
  const rs = map.regions;
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
        && (!r.points || pointInPolygon(r.points, x, y))) return r;
  }
  return null;
}

// The ways a region can be a mirror image of its partner on the sheet, each
// with the angle (degrees) of the line the mirroring happens across:
//   h  side by side      (u, v) → (1 - u, v)
//   v  one above another (u, v) → (u, 1 - v)
//   d  turned a quarter  (u, v) → (v, u)
//   a  turned the other  (u, v) → (1 - v, 1 - u)
export const MIRROR_AXIS = { h: 90, v: 0, d: 45, a: 135 };
const MIRROR_UV = {
  h: (u, v) => [1 - u, v],
  v: (u, v) => [u, 1 - v],
  d: (u, v) => [v, u],
  a: (u, v) => [1 - v, 1 - u],
};

// map a point through a mirror pair by relative position within the two
// regions' boxes; `kind` says which way round the partner lies (see
// mirrorKind) and defaults to side by side
export function mirrorPoint(src, dst, x, y, kind = 'h') {
  const u = src.w ? (x - src.x) / src.w : 0;
  const v = src.h ? (y - src.y) / src.h : 0;
  const [mu, mv] = MIRROR_UV[kind](u, v);
  return { x: dst.x + mu * dst.w, y: dst.y + mv * dst.h };
}

// Which of the four mirrorings lays src's outline most closely over dst's.
// Plain boxes fit every way equally, and then it is side by side, as before.
export function mirrorKind(src, dst) {
  const from = regionOutline(src), to = regionOutline(dst);
  const probes = [];
  for (let i = 0; i < from.length; i++) {
    const p = from[i], q = from[(i + 1) % from.length];
    probes.push(p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  }
  let best = 'h', bestD = Infinity;
  for (const kind of ['h', 'v', 'd', 'a']) {
    let d = 0;
    for (const p of probes) {
      const m = mirrorPoint(src, dst, p.x, p.y, kind);
      d += snapToOutline(to, m.x, m.y).d;
    }
    if (d < bestD - 1e-6) { best = kind; bestD = d; }
  }
  return best;
}

// the { src, dst } mirror pair containing a point, or null
export function mirrorPairAt(map, x, y) {
  const src = regionAt(map, x, y);
  if (!src || !src.mirror) return null;
  const dst = regionById(map, src.mirror);
  return dst ? { src, dst } : null;
}

// given a layer whose center (x, y) lies in a region with a mirror partner,
// the mirrored placement — the mirrored copy also gets flipH toggled
export function mirrorLayerPlacement(map, layer) {
  const pair = mirrorPairAt(map, layer.x, layer.y);
  if (!pair) return null;
  const p = mirrorPoint(pair.src, pair.dst, layer.x, layer.y);
  return { x: Math.round(p.x), y: Math.round(p.y), flip: true };
}

// ---------- centerline ----------
// A region that spans the middle of the car (bonnet, roof, bumpers) can carry
// "center": two twin corners, one each side — { a, b }. Its centerline runs
// through the point halfway between them, square to the line joining them, so
// it comes out right however the region is turned on the sheet.

// { mid, dir (unit vector along the line), angle (degrees, as layers rotate),
//   p0, p1 (the line's ends, spanning the region) } — or null without a center
export function centerLine(r) {
  if (!r.center) return null;
  const { a, b } = r.center;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (!len) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dir = { x: -dy / len, y: dx / len };
  let t0 = Infinity, t1 = -Infinity;
  for (const q of regionOutline(r)) {
    const t = (q.x - mid.x) * dir.x + (q.y - mid.y) * dir.y;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
  }
  return {
    mid, dir, angle: Math.atan2(dir.y, dir.x) * 180 / Math.PI,
    p0: { x: mid.x + dir.x * t0, y: mid.y + dir.y * t0 },
    p1: { x: mid.x + dir.x * t1, y: mid.y + dir.y * t1 },
  };
}

// (x, y) mirrored across the region's centerline
export function mirrorAcross(r, x, y) {
  const c = centerLine(r);
  if (!c) return { x, y };
  const vx = x - c.mid.x, vy = y - c.mid.y;
  const along = vx * c.dir.x + vy * c.dir.y;
  return { x: c.mid.x + 2 * along * c.dir.x - vx, y: c.mid.y + 2 * along * c.dir.y - vy };
}

// ---------- trimming ----------

// Push an outline outwards by d px (each corner along the average of its two
// edges' outward directions). Good for the few px of bleed a trim needs; not a
// general polygon offset.
export function growOutline(pts, d) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  const sign = area > 0 ? 1 : -1; // which side of an edge is outside
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const e1 = norm(p.x - a.x, p.y - a.y), e2 = norm(b.x - p.x, b.y - p.y);
    // outward normals of the two edges meeting here, averaged
    const m = norm(sign * (e1.y + e2.y), -sign * (e1.x + e2.x));
    return { x: p.x + m.x * d, y: p.y + m.y * d };
  });
}
function norm(x, y) {
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

// The window a layer is trimmed to when the user picks the spot (x, y) in a
// region: the region's outline — or, when it has a centerline, the half of it
// on that spot's side — grown by `bleed` px. The bleed keeps paint under the
// very edge of the piece (the sim blends a little across piece edges) and lets
// the two halves of a centre piece overlap by a hair instead of leaving a seam.
export function trimShape(r, x, y, bleed = 3) {
  let pts = regionOutline(r);
  const c = centerLine(r);
  if (c) {
    // keep the side of the centerline that (x, y) is on
    const nx = -c.dir.y, ny = c.dir.x;
    const side = (q) => (q.x - c.mid.x) * nx + (q.y - c.mid.y) * ny;
    const keep = side({ x, y }) >= 0 ? 1 : -1;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const sp = side(p) * keep, sq = side(q) * keep;
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    if (out.length >= 3) pts = out;
  }
  return growOutline(pts, bleed).map(q => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }));
}

// slug a display name into an id that doesn't collide with the map's regions
export function uniqueRegionId(name, map) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'region';
  let id = base, n = 2;
  while (map.regions.some(r => r.id === id)) id = base + '_' + (n++);
  return id;
}

// Rename a region. Its id follows the new name (see uniqueRegionId), and a
// mirror partner pointing at the old id is repointed.
export function renameRegion(map, region, name) {
  const others = map.regions.filter(r => r !== region);
  const id = uniqueRegionId(name, { regions: others });
  for (const r of others) if (r.mirror === region.id) r.mirror = id;
  for (const l of map.links || []) for (const side of ['a', 'b']) if (l[side].region === region.id) l[side].region = id;
  region.id = id;
  region.name = name;
  return region;
}

// Pair a region with its mirror partner on the other side of the car (or,
// with no partner id, unpair it). Pairs always point both ways, so whatever
// either region was paired with before is released.
export function setMirror(map, region, partnerId) {
  const partner = partnerId ? regionById(map, partnerId) : null;
  for (const r of [region, partner]) {
    if (!r || !r.mirror) continue;
    const old = regionById(map, r.mirror);
    if (old && old.mirror === r.id) delete old.mirror;
    delete r.mirror;
  }
  if (partner && partner !== region) { region.mirror = partner.id; partner.mirror = region.id; }
}

// the region's shape as corners: its outline, or the four corners of its box
export function regionOutline(r) {
  return r.points || [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ];
}

// distance from (x, y) to the segment a-b
function segDist(a, b, x, y) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

// A point well inside the region to hang a label on, and how much room it has
// there (px to the nearest edge). Points inside any `avoid` region are skipped,
// so a label keeps clear of smaller regions sitting on top of this one.
// ponytail: best of a 24x24 grid over the box, not the true widest point —
// swap in a proper pole-of-inaccessibility search if labels land badly.
export function labelPoint(r, avoid = []) {
  const pts = regionOutline(r);
  const N = 24;
  let best = { x: r.x + r.w / 2, y: r.y + r.h / 2, room: 0 };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = r.x + (i + 0.5) * r.w / N, y = r.y + (j + 0.5) * r.h / N;
      if (!pointInPolygon(pts, x, y) || regionAt({ regions: avoid }, x, y)) continue;
      let room = Infinity;
      for (let k = 0, m = pts.length - 1; k < pts.length; m = k++) room = Math.min(room, segDist(pts[m], pts[k], x, y));
      if (room > best.room) best = { x, y, room };
    }
  }
  return best;
}

// ---------- piece detection ----------
// A template's wireframe draws every piece of the sheet as its own connected
// network of lines, with clear space between pieces. So each connected network
// is one piece, and the outer edge of the network is the piece's outline.

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(a) / 2;
}

// Walk the outer edge of the 8-connected blob whose first pixel in scan order
// is (x0, y0), along pixel edges with the blob on the right. Returns the
// corners, clockwise on screen.
function traceOutline(mask, w, h, x0, y0) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 0;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // E S W N
  const RX = [0, -1, -1, 0], RY = [0, 0, -1, -1]; // pixel ahead-right of a corner, per heading
  const pts = [];
  let x = x0, y = y0, d = 0;
  do {
    x += DX[d]; y += DY[d];
    const l = (d + 3) % 4; // ahead-left is ahead-right of the heading one turn left
    const nd = at(x + RX[l], y + RY[l]) ? l : at(x + RX[d], y + RY[d]) ? d : (d + 1) % 4;
    if (nd !== d) pts.push({ x, y });
    d = nd;
  } while (x !== x0 || y !== y0 || d !== 0);
  return pts;
}

// Douglas-Peucker on a closed ring: drop corners that sit within `tol` pixels
// of the line between the corners kept either side.
export function simplifyOutline(pts, tol) {
  const n = pts.length;
  if (n < 4 || tol <= 0) return pts;
  let far = 1, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]]; // index n is pts[0] again, closing the ring
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b % n];
    let idx = -1, max = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(A, B, pts[i].x, pts[i].y);
      if (d > max) { max = d; idx = i; }
    }
    if (idx !== -1) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// mask: w*h bytes, non-zero where the wireframe has a line. Returns one
// outline (array of { x, y }) per piece, largest first.
// minArea drops specks; tolerance is how far (px) a simplified outline may
// stray from the traced one — raise it for fewer points, lower for a closer fit.
export function detectPieces(mask, w, h, { minArea = 600, tolerance = 2 } = {}) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const found = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!mask[p0] || seen[p0]) continue;
    // flood the whole network so it is traced once, from its first pixel
    let n = 0;
    stack[n++] = p0; seen[p0] = 1;
    while (n) {
      const p = stack[--n], x = p % w, y = (p - x) / w;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[n++] = q; }
        }
      }
    }
    const x0 = p0 % w;
    const pts = simplifyOutline(traceOutline(mask, w, h, x0, (p0 - x0) / w), tolerance);
    const area = polygonArea(pts);
    if (pts.length >= 3 && area >= minArea) found.push({ pts, area });
  }
  return found.sort((a, b) => b.area - a.area).map(f => f.pts);
}

// a region map with one outlined region per detected piece, "Piece 1" being
// the largest — small pieces come last so they win the hover inside big ones
export function piecesRegionMap(car, outlines) {
  const map = createRegionMap(car);
  outlines.forEach((outline, i) => {
    const points = outline.map(q => ({ x: Math.round(q.x), y: Math.round(q.y) }));
    const xs = points.map(q => q.x), ys = points.map(q => q.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    map.regions.push({
      id: `piece_${i + 1}`, name: `Piece ${i + 1}`,
      x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, points,
    });
  });
  return map;
}

// ---------- seam links ----------
// A link says "this stretch of one region's edge meets that stretch of
// another's on the car": { a: { region, from, to }, b: { region, from, to } }.
// a.from meets b.from and a.to meets b.to; in between, equal fractions of the
// two stretches are taken to meet. Where the regions sit on the sheet, and how
// they are turned, does not matter. A long edge that meets two regions simply
// carries two links. A side may also say which way round the outline it runs
// from `from` to `to` (dir: 1 = the order the corners are listed, -1 = the
// other way); without it, the shorter way is meant.

// distance along the outline to each corner, plus the full way round
function arcs(pts) {
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

function atArc(pts, cum, s) {
  const L = cum[pts.length];
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < pts.length - 1 && cum[i + 1] < s) i++;
  const a = pts[i], b = pts[(i + 1) % pts.length], seg = cum[i + 1] - cum[i];
  const t = seg ? (s - cum[i]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// The spot on the outline nearest (x, y): { x, y, s (distance along the
// outline), d (distance from the given point) }. A corner within `corner` px
// wins over the bare edge, so a click near a corner lands exactly on it.
export function snapToOutline(pts, x, y, corner = 0) {
  const cum = arcs(pts);
  let best = { d: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const px = a.x + t * dx, py = a.y + t * dy, d = Math.hypot(x - px, y - py);
    if (d < best.d) best = { x: px, y: py, s: cum[i] + t * Math.sqrt(len2), d };
  }
  let near = corner;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(x - pts[i].x, y - pts[i].y);
    if (d <= near) { near = d; best = { x: pts[i].x, y: pts[i].y, s: cum[i], d }; }
  }
  return best;
}

// One side of a link as a run along its region's outline: where it starts,
// how long it is and which way round it goes. Null if the region is gone.
function linkStretch(map, link, side) {
  const region = regionById(map, link[side].region);
  if (!region) return null;
  const pts = regionOutline(region), cum = arcs(pts), L = cum[pts.length];
  const s0 = snapToOutline(pts, link[side].from.x, link[side].from.y).s;
  const s1 = snapToOutline(pts, link[side].to.x, link[side].to.y).s;
  const fwd = (s1 - s0 + L) % L;
  const dir = link[side].dir || (fwd <= L / 2 ? 1 : -1);
  return { pts, cum, L, start: s0, len: dir === 1 ? fwd : (L - fwd) % L, dir };
}

// Which way round its outline a link side currently runs (1 or -1). Storing
// this on the side as `dir` keeps it running that way while an end is moved,
// even once the stretch grows past half the outline.
export function linkDir(map, link, side) {
  const st = linkStretch(map, link, side);
  return st ? st.dir : 1;
}

// points along one side of a link from fraction t0 to t1 of its stretch,
// about every `step` px — for drawing it
export function linkPoints(map, link, side, t0 = 0, t1 = 1, step = 6) {
  const st = linkStretch(map, link, side);
  if (!st) return [];
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) * st.len / step));
  const out = [];
  for (let k = 0; k <= n; k++) out.push(atArc(st.pts, st.cum, st.start + st.dir * st.len * (t0 + (t1 - t0) * k / n)));
  return out;
}

// length in px of the longer side of a link
export function linkLength(map, link) {
  const a = linkStretch(map, link, 'a'), b = linkStretch(map, link, 'b');
  return Math.max(a ? a.len : 0, b ? b.len : 0);
}

// Where does the spot at (x, y) meet the other piece? If (x, y) is within
// maxDist of a linked stretch, returns { index, side, t, at, partner } — `at`
// is the spot on that stretch, `partner` the spot it meets on the other side.
export function matchPoint(map, x, y, maxDist) {
  let best = null;
  (map.links || []).forEach((link, index) => {
    for (const side of ['a', 'b']) {
      const st = linkStretch(map, link, side);
      if (!st) continue;
      const p = snapToOutline(st.pts, x, y);
      if (p.d > maxDist || (best && p.d >= best.d)) continue;
      const along = st.dir === 1 ? (p.s - st.start + st.L) % st.L : (st.start - p.s + st.L) % st.L;
      if (along > st.len + 1e-6) continue;
      const other = linkStretch(map, link, side === 'a' ? 'b' : 'a');
      if (!other) continue;
      const t = st.len ? along / st.len : 0;
      best = {
        index, side, t, d: p.d, at: { x: p.x, y: p.y },
        partner: atArc(other.pts, other.cum, other.start + other.dir * other.len * t),
      };
    }
  });
  return best;
}
