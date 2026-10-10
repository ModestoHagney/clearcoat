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

// the ready-made shapes, by the name each goes by on screen
export const SHAPES = {
  ellipse: 'Circle', rect: 'Box', triangle: 'Triangle', star: 'Star', diamond: 'Diamond',
  hexagon: 'Hexagon', chevron: 'Chevron', cross: 'Cross', round: 'Rounded box',
};
// corners of the straight-sided ones in a box 1 by 1
const ring = (n, r = () => 1, from = -Math.PI / 2) => Array.from({ length: n }, (_, i) => {
  const a = from + i * 2 * Math.PI / n;
  return [Math.cos(a) * r(i), Math.sin(a) * r(i)];
});
const boxed = (pts) => { // stretched to fill the box exactly
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  return pts.map(p => [(p[0] - x) / (Math.max(...xs) - x), (p[1] - y) / (Math.max(...ys) - y)]);
};
const UNIT = {
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  chevron: [[0, 0], [0.5, 0], [1, 0.5], [0.5, 1], [0, 1], [0.5, 0.5]],
  cross: [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]].map(([a, b]) => [a / 3, b / 3]),
  hexagon: boxed(ring(6, () => 1, 0)),
  star: boxed(ring(10, i => (i % 2 ? 0.382 : 1))),
};
// height over width of the ones that are not as tall as wide when regular
const ASPECT = { hexagon: Math.sqrt(3) / 2, star: 0.951 };
export const aspect = (shape) => ASPECT[shape] || 1;

// a ready-made shape drawn in a box, as an outline: so it can join another,
// repeat as a pattern, or simply be a shape of its own
export function boxOutline(shape, x, y, w, h) {
  if (UNIT[shape]) return UNIT[shape].map(([u, v]) => ({ x: x + u * w, y: y + v * h }));
  if (shape === 'round') {
    const r = Math.min(w, h) / 4, X = x + w, Y = y + h;
    return [{ x: x + r, y }, { x: X - r, y, c: { x: X, y } }, { x: X, y: y + r }, { x: X, y: Y - r, c: { x: X, y: Y } },
      { x: X - r, y: Y }, { x: x + r, y: Y, c: { x, y: Y } }, { x, y: Y - r }, { x, y: y + r, c: { x, y } }];
  }
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

// ---------- a shape repeated: patterns and stamps ----------

// A motif is the shape that repeats: { kind } names a ready-made one, and
// { kind: 'own', pts, w, h } carries an outline of its own (a library shape).
// → its outline in its own box: { pts, w, h }
export function motifOutline(m) {
  if (m.kind === 'own') return { pts: m.pts, w: m.w, h: m.h };
  const h = aspect(m.kind);
  return { pts: boxOutline(m.kind, 0, 0, 1, h), w: 1, h };
}
// One copy as numbers [a, b, c, d, e, f] (a canvas matrix): its longer side
// `size`, turned `turn` degrees about its middle, its middle on (x, y).
export function placing(o, x, y, size, turn = 0) {
  const k = size / Math.max(o.w, o.h), t = turn * Math.PI / 180, a = k * Math.cos(t), b = k * Math.sin(t);
  return [a, b, -b, a, x - (a * o.w - b * o.h) / 2, y - (b * o.w + a * o.h) / 2];
}
const through = (f) => (p) => ({ x: f[0] * p.x + f[2] * p.y + f[4], y: f[1] * p.x + f[3] * p.y + f[5] });
// that copy as an outline on the sheet: what Stamp places
export function placed(m, x, y, size, turn = 0) {
  const o = motifOutline(m);
  return mapped(o.pts, through(placing(o, x, y, size, turn)));
}

// The middles of every copy that could show inside `box`. The grid is fixed
// to the sheet, not to the shape it fills, so two shapes with the same
// settings carry on the same pattern. stagger: how far every second row is
// shifted, as a percentage of the step.
//
// → [{ x, y, size, turn, pick, shape, i, j }]: where each copy goes and how.
// `shape` says which of the pattern's shapes it is (0 = the main one, then
// m.more in order): they take turns across the grid, or with Random on each
// copy takes one by its roll. A plain
// pattern gives every copy the motif's own size and turn. A random one
// (m.random) varies each by its own roll: rSize, rPos and rTurn say how much,
// 0 to 100. `pick` says which of the pattern's colours it takes (0 = the
// main one, then m.colors in order): in turn, or by the roll when random. A roll comes from the seed and the
// copy's place in the grid, so it is the same every time it is painted, on
// every shape that shares the grid, until the seed is changed.
export const CELL_LIMIT = 15000; // about a tenth of a second to paint
export const SIZE_SWING = 0.75;  // rSize 100: from a quarter of the size to one and three quarters
function roll(seed, i, j, k) { // 0 ≤ … < 1, steady for the same four numbers
  let h = (seed | 0) ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
export function cells(m, box) {
  const { size, gap = 0, stagger = 0 } = m, turn = m.turn || 0;
  const rnd = !!m.random, rSize = rnd ? (m.rSize || 0) / 100 : 0, rPos = rnd ? (m.rPos || 0) / 100 : 0, rTurn = rnd ? (m.rTurn || 0) / 100 : 0;
  const colours = 1 + (m.colors || []).length, seed = m.seed || 0, shapes = 1 + (m.more || []).length;
  // colours take turns as shapes do; stepped differently when there are both, so a shape does not always get the same colour
  const turnOf = (n, v) => ((v % n) + n) % n, cstep = shapes > 1 ? 2 : 1;
  const step = Math.max(2, size + gap);
  // a turned copy reaches this far from its middle: more if it may grow or drift
  const pad = size * 0.75 * (1 + SIZE_SWING * rSize) + step / 2 * rPos;
  const x0 = box.x - pad, y0 = box.y - pad, x1 = box.x + box.w + pad, y1 = box.y + box.h + pad;
  // ponytail: past CELL_LIMIT copies the grid is opened up instead of drawn;
  // raise the limit if a finer pattern is ever wanted and the screen keeps up.
  const pitch = Math.max(step, Math.sqrt((x1 - x0) * (y1 - y0) / CELL_LIMIT));
  const out = [];
  for (let j = Math.ceil(y0 / pitch); j * pitch <= y1; j++) {
    const off = j % 2 ? stagger / 100 * pitch : 0;
    for (let i = Math.ceil((x0 - off) / pitch); i * pitch + off <= x1; i++) {
      const c = { x: i * pitch + off, y: j * pitch, size, turn, pick: turnOf(colours, i + cstep * j), shape: turnOf(shapes, i + j), i, j };
      if (rnd) {
        const u = (k) => roll(seed, i, j, k) * 2 - 1; // −1 … 1
        c.x += u(1) * rPos * pitch / 2;
        c.y += u(2) * rPos * pitch / 2;
        c.size = size * (1 + u(3) * SIZE_SWING * rSize);
        c.turn = turn + u(4) * 180 * rTurn;
        c.pick = Math.floor(roll(seed, i, j, 5) * colours);
        c.shape = Math.floor(roll(seed, i, j, 6) * shapes);
      }
      out.push(c);
    }
  }
  return out;
}

// A mirror as numbers: found from where it sends three points. A pattern on a
// mirrored shape is drawn through it, so the other side is a true mirror image.
export function frameFrom(carry) {
  const o = carry(0, 0), u = carry(1, 0), v = carry(0, 1);
  return [u.x - o.x, u.y - o.y, v.x - o.x, v.y - o.y, o.x, o.y];
}
// g, then f
export const framed = (f, g) => [
  f[0] * g[0] + f[2] * g[1], f[1] * g[0] + f[3] * g[1],
  f[0] * g[2] + f[2] * g[3], f[1] * g[2] + f[3] * g[3],
  f[0] * g[4] + f[2] * g[5] + f[4], f[1] * g[4] + f[3] * g[5] + f[5],
];
// the box round `box` as it lies before the frame is applied
export function unframed(f, box) {
  const det = f[0] * f[3] - f[1] * f[2];
  if (!det) return box;
  const back = (x, y) => ({ x: (f[3] * (x - f[4]) - f[2] * (y - f[5])) / det, y: (f[0] * (y - f[5]) - f[1] * (x - f[4])) / det });
  const cs = [back(box.x, box.y), back(box.x + box.w, box.y), back(box.x, box.y + box.h), back(box.x + box.w, box.y + box.h)];
  const xs = cs.map(p => p.x), ys = cs.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
