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
const shapesMod = await import('../js/shapes.js');
const { SHAPES, motifOutline, placed } = shapesMod;

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

test('rounded shapes: only corners between straight lines are rounded, and the shape still fills its box', () => {
  const { rounded, roundedOf } = shapesMod;
  const sq = rounded(boxOutline('rect', 0, 0, 100, 100), 10);
  assert.equal(sq.length, 8); // two points for each corner
  assert.deepEqual(sq[0], { x: 0, y: 10, c: { x: 0, y: 0 } }); // a little way down from the corner, bending through where it was
  assert.deepEqual(sq[1], { x: 10, y: 0 });
  assert.ok(!contains(sq, 1, 1) && contains(sq, 5, 5) && contains(sq, 50, 1)); // the very corner is gone, the rest is there
  // a rounding bigger than a side stops short of its middle
  assert.ok(rounded(boxOutline('rect', 0, 0, 10, 10), 500).every(p => p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 10));
  // the shield: its two top corners are rounded, the bends at the bottom are left alone
  const plain = boxOutline('shield', 0, 0, 100, 115), soft = boxOutline('shield-r', 0, 0, 100, 115);
  assert.equal(soft.length, plain.length + 2);
  assert.deepEqual([roundedOf('rect'), roundedOf('star'), roundedOf('ellipse'), roundedOf('ring'), roundedOf('star-r')], ['round', 'star-r', null, null, null]);
});

test('a ring keeps its hole, also when stamped or merged with other shapes', () => {
  const ring = boxOutline('ring', 0, 0, 100, 100);
  // the hole is the second piece, run the other way round
  const { pieces: ps } = shapesMod, [[a, b], [c, d]] = ps(ring);
  const area = (q) => q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + p.x * n.y - n.x * p.y; }, 0);
  assert.ok(area(flatten(ring.slice(a, b))) * area(flatten(ring.slice(c, d).map(p => ({ ...p, m: undefined })))) < 0);
  const both = joined([moved(ring, 300, 0), ring, boxOutline('rect', 500, 0, 50, 50)]);
  const parts = ps(both).map(([i, j]) => area(flatten(both.slice(i, j).map(p => ({ ...p, m: undefined })))) > 0);
  assert.deepEqual(parts, [true, false, true, false, true]); // ring, hole, ring, hole, box
});

test('filling a shape in: its holes go, and so does anything inside them', () => {
  const { hasInner, outerOnly } = shapesMod;
  const ring = boxOutline('ring', 0, 0, 100, 100);
  assert.ok(hasInner(ring));
  const solid = outerOnly(ring);
  assert.equal(shapesMod.pieces(solid).length, 1);
  assert.equal(solid[0].m, undefined);
  assert.ok(!hasInner(solid));
  // two rings side by side, and a dot inside one ring's hole: both outers stay, the rest goes
  const dot = boxOutline('ellipse', 45, 45, 10, 10); dot[0].m = true;
  const far = moved(ring, 300, 0); far[0].m = true;
  const both = outerOnly([...ring, ...dot, ...far]);
  assert.deepEqual(shapesMod.pieces(both).map(([a, b]) => b - a), [8, 8]);
  // shapes merely side by side have nothing inside each other
  assert.ok(!hasInner(joined([boxOutline('rect', 0, 0, 10, 10), boxOutline('rect', 50, 0, 10, 10)])));
});

test('wrap: one outline pulled tight round the shapes; two circles make a slot with tangent sides', () => {
  const { wrapped } = shapesMod;
  // two boxes: the band is the box round both, with nothing left of the corners between them
  const band = wrapped([boxOutline('rect', 0, 0, 10, 10), boxOutline('rect', 30, 0, 10, 10)]);
  assert.equal(band.length, 4);
  assert.deepEqual(bounds(band), { x: 0, y: 0, w: 40, h: 10 });
  // two circles of radius 50, centres 200 apart: a slot 300 long and 100 high, flat along the top and bottom
  const slot = wrapped([boxOutline('ellipse', 0, 0, 100, 100), boxOutline('ellipse', 200, 0, 100, 100)]);
  const b = bounds(slot);
  assert.ok(Math.abs(b.w - 300) < 0.5 && Math.abs(b.h - 100) < 0.5, JSON.stringify(b));
  assert.ok(contains(slot, 150, 2) && contains(slot, 150, 98));      // the straight sides run between the circles, at their full height
  assert.ok(!contains(slot, 3, 3) && !contains(slot, 297, 97));      // and the ends are still round
  // the longest side is the tangent between them: about 200 long and level
  const sides = slot.map((p, i) => { const q = slot[(i + 1) % slot.length]; return { len: Math.hypot(q.x - p.x, q.y - p.y), dy: Math.abs(q.y - p.y) }; }).sort((a, c) => c.len - a.len);
  assert.ok(Math.abs(sides[0].len - 200) < 14 && sides[0].dy < 0.6 && Math.abs(sides[1].len - 200) < 14, JSON.stringify(sides.slice(0, 2)));
  // a shape that is hollow or dented is wrapped by its outside
  assert.equal(wrapped([boxOutline('star', 0, 0, 100, 95)]).length, 5);
});

test('a hollow shape is its outline with the middle cut out, a band of even thickness', () => {
  const pts = boxOutline('triangle-h', 0, 0, 100, 100);
  const [outer, hole] = pieces(pts);
  assert.equal(hole[0], 3); // the hole is a second piece
  const inner = pts.slice(hole[0], hole[1]);
  // every corner of the hole sits 10 in from both sides it lies between: the base, and each slant
  const dist = (p, a, b) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
  const o = pts.slice(0, outer[1]);
  for (const p of inner) assert.equal([0, 1, 2].filter(i => near(dist(p, o[i], o[(i + 1) % 3]), 10)).length, 2);
  assert.ok(SHAPES['star-h'] && !SHAPES['ring-h']); // a ring is already hollow
});
