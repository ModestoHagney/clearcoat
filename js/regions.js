// Clearcoat region maps — labeled areas over the 2048 UV sheet with mirror
// relationships ("Left Door mirrors Right Door"). Pure data helpers; all
// coordinates are in 2048-sheet space. Every region has a rectangle (x, y, w,
// h); one may also carry "points", an outline of its real shape, in which case
// the rectangle is that outline's bounding box.

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
  return {
    format: REGIONS_FORMAT,
    car: typeof data.car === 'string' && data.car ? data.car : 'unknown car',
    regions,
  };
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

// map a point through a mirror pair by relative position:
// (u, v) within src → (1 - u, v) within dst
export function mirrorPoint(src, dst, x, y) {
  const u = src.w ? (x - src.x) / src.w : 0;
  const v = src.h ? (y - src.y) / src.h : 0;
  return { x: dst.x + (1 - u) * dst.w, y: dst.y + v * dst.h };
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
  region.id = id;
  region.name = name;
  return region;
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
