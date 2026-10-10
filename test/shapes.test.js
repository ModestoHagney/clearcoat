import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, bounds, contains, moved, segmentAt, midOf, bendTo, insertAt, removeAt, snapAngle, pointOn, pieces, nextIndex, joined, boxOutline, outlines } from '../js/shapes.js';

const sq = () => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('flatten: straight lines keep just their points; a bend adds steps', () => {
  assert.equal(flatten(sq()).length, 4);
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  assert.equal(flatten(bent, 12).length, 4 + 11);
});

test('bendTo: the half-way dot lands where it was dragged, and bounds follow the bulge', () => {
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  const m = midOf(bent, 0);
  assert.ok(near(m.x, 50) && near(m.y, -40));
  const b = bounds(bent);
  assert.ok(b.y < -39 && b.y > -41, 'box reaches the bulge');
  assert.equal(b.h, 100 - b.y);
});

test('bendTo: dropped back on the middle of the line, the bend is gone', () => {
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  assert.equal(bendTo(bent, 0, { x: 51, y: 1 }, 3)[0].c, undefined);
  assert.ok(bendTo(bent, 0, { x: 51, y: 9 }, 3)[0].c);
});

test('contains: inside, outside, and inside a bulge', () => {
  assert.equal(contains(sq(), 50, 50), true);
  assert.equal(contains(sq(), 150, 50), false);
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  assert.equal(contains(bent, 50, -20), true);
  assert.equal(contains(sq(), 50, -20), false);
});

test('moved: every point and bend handle shifts, the original is untouched', () => {
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  const m = moved(bent, 10, 5);
  assert.deepEqual(m[1], { x: 110, y: 5 });
  assert.deepEqual(m[0].c, { x: bent[0].c.x + 10, y: bent[0].c.y + 5 });
  assert.deepEqual(bent[1], { x: 100, y: 0 });
});

test('segmentAt: finds the line and how far along; nothing out of reach', () => {
  const hit = segmentAt(sq(), 102, 30, 5);
  assert.equal(hit.i, 1);
  assert.ok(near(hit.t, 0.3) && near(hit.x, 100) && near(hit.y, 30));
  assert.equal(segmentAt(sq(), 150, 30, 5), null);
});

test('insertAt: a point on a straight line; a bent line keeps its curve', () => {
  const s = insertAt(sq(), 1, 0.3);
  assert.equal(s.length, 5);
  assert.deepEqual(s[2], { x: 100, y: 30 });
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  const split = insertAt(bent, 0, 0.5);
  assert.equal(split.length, 5);
  // the old curve's quarter and three-quarter points still lie on the new outline
  for (const t of [0.25, 0.75]) {
    const want = pointOn(bent, 0, t);
    assert.ok(segmentAt(split, want.x, want.y, 0.5, 64), `curve kept at ${t}`);
  }
});

test('removeAt: neighbours join with a straight line; never below a triangle', () => {
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  const r = removeAt(bent, 1);
  assert.equal(r.length, 3);
  assert.equal(r[0].c, undefined);
  assert.equal(removeAt(r, 0).length, 3);
});

test('snapAngle: locks to 45° steps and keeps the length', () => {
  const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 8 });
  assert.ok(near(p.y, 0, 1e-9) && near(p.x, Math.hypot(100, 8)));
  const d = snapAngle({ x: 10, y: 10 }, { x: 60, y: 70 });
  assert.ok(near(d.x - 10, d.y - 10, 1e-9), 'on the 45° diagonal');
  assert.deepEqual(snapAngle({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5 });
});

// ---- several pieces in one shape

const two = () => joined([sq(), moved(sq(), 300, 0)]);

test('joined: two shapes become one list, the second starting a new piece', () => {
  const pts = two();
  assert.equal(pts.length, 8);
  assert.deepEqual(pieces(pts), [[0, 4], [4, 8]]);
  assert.equal(pts[4].m, true);
  assert.equal(nextIndex(pts, 3), 0, 'a piece closes on its own first point');
  assert.equal(nextIndex(pts, 7), 4);
});

test('pieces: inside either, not in the gap between; bounds span both', () => {
  const pts = two();
  assert.equal(contains(pts, 50, 50), true);
  assert.equal(contains(pts, 350, 50), true);
  assert.equal(contains(pts, 200, 50), false);
  assert.deepEqual(bounds(pts), { x: 0, y: 0, w: 400, h: 100 });
  assert.equal(outlines(pts).length, 2);
});

test('joined: pieces drawn opposite ways round are turned to match, so an overlap is not a hole', () => {
  const back = [...sq()].reverse(); // the same square, run the other way
  const pts = joined([sq(), moved(back, 50, 0)]);
  const dir = (o) => Math.sign(o.reduce((s, p, i) => { const q = o[(i + 1) % o.length]; return s + p.x * q.y - q.x * p.y; }, 0));
  const [a, b] = outlines(pts);
  assert.equal(dir(a), dir(b));
  assert.equal(contains(pts, 75, 50), true);
});

test('joined: a bent piece keeps its curve when it has to be turned round', () => {
  const bent = bendTo(sq(), 0, { x: 50, y: -40 });
  const pts = joined([[...bent].reverse().map((p, i, all) => { const q = { x: p.x, y: p.y }; const before = all[(i + 1) % all.length]; if (before.c) q.c = before.c; return q; })]);
  const want = pointOn(bent, 0, 0.5);
  assert.ok(segmentAt(pts, want.x, want.y, 0.5, 64), 'the bulge is still on the outline');
});

test('editing a piece leaves the other alone', () => {
  const pts = two();
  const added = insertAt(pts, 3, 0.5); // on the first piece's closing line
  assert.deepEqual(pieces(added), [[0, 5], [5, 9]]);
  assert.deepEqual(added[4], { x: 0, y: 50 });
  const tri = removeAt(added, 5); // the second piece's first point: the next becomes its start
  assert.deepEqual(pieces(tri), [[0, 5], [5, 8]]);
  assert.equal(tri[5].m, true);
  assert.equal(removeAt(tri, 5), tri, 'a piece keeps at least three points');
  assert.equal(moved(pts, 10, 10)[4].m, true);
});

test('boxOutline: a box, a triangle, and an ellipse that stays within a hair of round', () => {
  assert.equal(boxOutline('rect', 0, 0, 10, 20).length, 4);
  assert.deepEqual(boxOutline('triangle', 0, 0, 10, 20)[0], { x: 5, y: 0 });
  const o = flatten(boxOutline('ellipse', 0, 0, 200, 200), 16);
  for (const p of o) assert.ok(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 100) < 0.6, 'on the circle');
});

// ---------- ready-made shapes, patterns and stamps ----------
const { SHAPES, motifOutline, placed, cells, frameFrom, framed, unframed } = await import('../js/shapes.js');

test('every ready-made shape fills the box it is drawn in', () => {
  for (const kind of Object.keys(SHAPES)) {
    const b = bounds(boxOutline(kind, 10, 20, 200, 100));
    for (const [got, want] of [[b.x, 10], [b.y, 20], [b.w, 200], [b.h, 100]]) assert.ok(Math.abs(got - want) < 1.5, `${kind}: ${got} vs ${want}`);
  }
});

test('a stamp is the motif at the size asked, about the spot clicked', () => {
  const b = bounds(placed({ kind: 'rect' }, 500, 400, 100));
  assert.deepEqual([b.x, b.y, b.w, b.h].map(Math.round), [450, 350, 100, 100]);
  const own = { kind: 'own', w: 40, h: 20, pts: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] };
  const t = bounds(placed(own, 0, 0, 200, 90)); // the longer side is the size; a quarter turn stands it up
  assert.deepEqual([t.w, t.h].map(Math.round), [100, 200]);
});

test('a pattern sits on a grid fixed to the sheet, every second row shifted by the stagger', () => {
  const m = { size: 40, gap: 10, stagger: 50 };
  const a = cells(m, { x: 0, y: 0, w: 200, h: 200 }), b = cells(m, { x: 130, y: 70, w: 200, h: 200 });
  const key = (c) => c.x + ',' + c.y, inA = new Set(a.map(key));
  assert.ok(a.some(c => c.x === 50 && c.y === 100));  // an even row: multiples of the 50 px step
  assert.ok(a.some(c => c.x === 75 && c.y === 50));   // an odd row: half a step across
  assert.ok(!a.some(c => c.x === 50 && c.y === 50));
  const shared = b.filter(c => inA.has(key(c)));
  assert.ok(shared.length > 0 && b.every(c => c.x < 130 || c.y < 70 || c.x > 200 || c.y > 200 || inA.has(key(c)))); // where the two boxes overlap, the same middles
  // every copy that can reach the box is there
  assert.ok(a.some(c => c.x === -25 && c.y === 50) && a.some(c => c.x === 225 && c.y === 150));
  assert.ok(!a.some(c => c.y < -30 || c.y > 230)); // and none that cannot
});

test('a mirror read off three points sends every point where the mirror does', () => {
  const carry = (x, y) => ({ x: 900 - x, y: y + 30 }); // a flip with a shift
  const f = frameFrom(carry), at = (g, x, y) => ({ x: g[0] * x + g[2] * y + g[4], y: g[1] * x + g[3] * y + g[5] });
  assert.deepEqual(at(f, 120, 40), carry(120, 40));
  assert.deepEqual(at(framed(f, f), 120, 40), { x: 120, y: 100 }); // twice: back across, shifted twice
  assert.deepEqual(unframed(f, { x: 700, y: 130, w: 100, h: 50 }), { x: 100, y: 100, w: 100, h: 50 });
});
