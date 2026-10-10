// Free shapes: a closed outline of points in doc space, [{ x, y, c?, m? }].
// `c` on a point is the bend handle (quadratic control point) of the line that
// leaves it for the next point; without it that line is straight. `m` on a
// point starts a new, separate outline in the same shape (as "move to" does in
// a path), so one shape can be several pieces: what merging shapes makes.
// Each piece closes back on its own first point. The engine
// draws these as a fill layer with shape 'path' (see fillShapePath); this file
// is the geometry around them — pure, no canvas, so it runs under node --test.

import { pointInPolygon } from './regions.js';

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// where each piece starts and stops in the list: [[start, end), …]
export function pieces(pts) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= pts.length; i++) if (i === pts.length || pts[i].m) { out.push([start, i]); start = i; }
  return out;
}
const pieceOf = (pts, i) => pieces(pts).find(([a, b]) => i >= a && i < b);
// the point the line leaving pts[i] runs to: the next one, or its piece's first
export function nextIndex(pts, i) {
  const [a, b] = pieceOf(pts, i);
  return i + 1 < b ? i + 1 : a;
}
const prevIndex = (pts, i) => { const [a, b] = pieceOf(pts, i); return i > a ? i - 1 : b - 1; };

// the point at t along the line leaving pts[i]
export function pointOn(pts, i, t) {
  const a = pts[i], b = pts[nextIndex(pts, i)];
  if (!a.c) return lerp(a, b, t);
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * a.c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * a.c.y + t * t * b.y };
}

// The outline as straight pieces: every point, plus `steps - 1` extra along
// each bent line. What hit-testing and bounds work from.
export function flatten(pts, steps = 12) {
  const out = [];
  pts.forEach((a, i) => {
    out.push({ x: a.x, y: a.y });
    if (a.c) for (let k = 1; k < steps; k++) out.push(pointOn(pts, i, k / steps));
  });
  return out;
}

// bounding box of what is actually drawn (a bend can bulge past its ends)
export function bounds(pts) {
  const f = flatten(pts);
  const xs = f.map(p => p.x), ys = f.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// each piece as its own straight-sided outline
export const outlines = (pts, steps = 12) => pieces(pts).map(([a, b]) => flatten(pts.slice(a, b).map((p, k) => (k ? p : { ...p, m: undefined })), steps));
// inside any of its pieces
export const contains = (pts, x, y) => outlines(pts).some(o => pointInPolygon(o, x, y));

// every point (and bend handle) through f, keeping what else the point carries
export const mapped = (pts, f) => pts.map((p) => {
  const q = f(p);
  if (p.c) q.c = f(p.c);
  if (p.m) q.m = true;
  return q;
});
export const moved = (pts, dx, dy) => mapped(pts, p => ({ x: p.x + dx, y: p.y + dy }));

// Nearest spot on the outline to (x, y), if within `reach`.
// → { i, t, x, y, d }: on the line leaving pts[i], t of the way along it
export function segmentAt(pts, x, y, reach = Infinity, steps = 24) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const n = pts[i].c ? steps : 1; // a straight line is one piece
    let a = pointOn(pts, i, 0);
    for (let k = 1; k <= n; k++) {
      const b = pointOn(pts, i, k / n);
      const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
      const u = len2 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2)) : 0;
      const px = a.x + vx * u, py = a.y + vy * u, d = Math.hypot(x - px, y - py);
      if (d <= reach && (!best || d < best.d)) best = { i, t: (k - 1 + u) / n, x: px, y: py, d };
      a = b;
    }
  }
  return best;
}

// The dot shown half-way along the line leaving pts[i]; drag it to bend.
export const midOf = (pts, i) => pointOn(pts, i, 0.5);

// Bend the line leaving pts[i] so its half-way dot sits at m. Dropped within
// `slack` of the straight line's middle, the bend is removed again.
export function bendTo(pts, i, m, slack = 0) {
  const a = pts[i], b = pts[nextIndex(pts, i)];
  const mid = lerp(a, b, 0.5);
  const out = pts.map(p => ({ ...p }));
  if (Math.hypot(m.x - mid.x, m.y - mid.y) <= slack) delete out[i].c;
  else out[i].c = { x: 2 * m.x - mid.x, y: 2 * m.y - mid.y }; // B(0.5) = m
  return out;
}

// A new point at t along the line leaving pts[i]. A bent line is split into
// two bends that trace the same curve (de Casteljau).
export function insertAt(pts, i, t) {
  const a = pts[i], b = pts[nextIndex(pts, i)];
  const out = pts.map(p => ({ ...p }));
  const p = pointOn(pts, i, t);
  if (a.c) {
    out[i].c = lerp(a, a.c, t);
    p.c = lerp(a.c, b, t);
  }
  out.splice(i + 1, 0, p);
  return out;
}

// Remove pts[i]; the lines either side become one straight line. Never goes
// below a triangle.
export function removeAt(pts, i) {
  const [a, b] = pieceOf(pts, i);
  if (b - a <= 3) return pts; // its piece would stop being a shape
  const out = pts.map(p => ({ ...p }));
  delete out[prevIndex(pts, i)].c;
  if (out[i].m) out[i + 1].m = true; // the piece now starts at the next point
  out.splice(i, 1);
  return out;
}

// ---------- several shapes as one ----------

// twice the signed area of a piece's corners: its sign says which way round it runs
const turn = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0);
// the same outline, run the other way. A bend handle belongs to the line
// leaving its point, so each moves to the point at that line's other end.
function reversed(pts) {
  const n = pts.length;
  return pts.map((_, j) => {
    const p = pts[(n - j) % n], before = pts[(n - j - 1 + n) % n]; // new point j is old point n-j; its line runs to old n-j-1
    const q = { x: p.x, y: p.y };
    if (before.c) q.c = { x: before.c.x, y: before.c.y };
    return q;
  });
}
// Outlines joined into one shape's point list. Every piece is made to run the
// same way round, so where two overlap they add up instead of cutting a hole.
export function joined(list) {
  const out = [];
  for (const pts of list) {
    for (const [a, b] of pieces(pts)) {
      let piece = pts.slice(a, b).map(p => (p.c ? { x: p.x, y: p.y, c: { ...p.c } } : { x: p.x, y: p.y }));
      if (turn(flatten(piece)) < 0) piece = reversed(piece);
      if (out.length) piece[0].m = true;
      out.push(...piece);
    }
  }
  return out;
}

// a ready-made fill's box as an outline, so it can join one
export function boxOutline(shape, x, y, w, h) {
  if (shape === 'triangle') return [{ x: x + w / 2, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (shape === 'ellipse') {
    // eight arcs: close enough to an ellipse that the eye cannot tell
    const cx = x + w / 2, cy = y + h / 2, k = 1 / Math.cos(Math.PI / 8);
    return Array.from({ length: 8 }, (_, i) => {
      const a = i * Math.PI / 4, m = a + Math.PI / 8;
      return { x: cx + Math.cos(a) * w / 2, y: cy + Math.sin(a) * h / 2, c: { x: cx + Math.cos(m) * k * w / 2, y: cy + Math.sin(m) * k * h / 2 } };
    });
  }
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

// `to`, moved so the line from `from` runs at a multiple of `step` degrees
// (same length)
export function snapAngle(from, to, step = 45) {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
  if (!len) return { x: to.x, y: to.y };
  const s = step * Math.PI / 180, a = Math.round(Math.atan2(dy, dx) / s) * s;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
