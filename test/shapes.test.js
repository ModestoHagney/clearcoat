import test from 'node:test';
import assert from 'node:assert/strict';
import { flatten, bounds, contains, moved, segmentAt, midOf, bendTo, insertAt, removeAt, snapAngle, pointOn } from '../js/shapes.js';

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
