// Free shapes: a closed outline of points in doc space, [{ x, y, c? }].
// `c` on a point is the bend handle (quadratic control point) of the line that
// leaves it for the next point; without it that line is straight. The engine
// draws these as a fill layer with shape 'path' (see fillShapePath); this file
// is the geometry around them — pure, no canvas, so it runs under node --test.

import { pointInPolygon } from './regions.js';

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// the point at t along the line leaving pts[i]
export function pointOn(pts, i, t) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
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

export const contains = (pts, x, y) => pointInPolygon(flatten(pts), x, y);

export const moved = (pts, dx, dy) => pts.map(p => (p.c
  ? { x: p.x + dx, y: p.y + dy, c: { x: p.c.x + dx, y: p.c.y + dy } }
  : { x: p.x + dx, y: p.y + dy }));

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
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const mid = lerp(a, b, 0.5);
  const out = pts.map(p => ({ ...p }));
  if (Math.hypot(m.x - mid.x, m.y - mid.y) <= slack) delete out[i].c;
  else out[i].c = { x: 2 * m.x - mid.x, y: 2 * m.y - mid.y }; // B(0.5) = m
  return out;
}

// A new point at t along the line leaving pts[i]. A bent line is split into
// two bends that trace the same curve (de Casteljau).
export function insertAt(pts, i, t) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
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
  if (pts.length <= 3) return pts;
  const out = pts.map(p => ({ ...p }));
  delete out[(i - 1 + out.length) % out.length].c;
  out.splice(i, 1);
  return out;
}

// `to`, moved so the line from `from` runs at a multiple of `step` degrees
// (same length)
export function snapAngle(from, to, step = 45) {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
  if (!len) return { x: to.x, y: to.y };
  const s = step * Math.PI / 180, a = Math.round(Math.atan2(dy, dx) / s) * s;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
