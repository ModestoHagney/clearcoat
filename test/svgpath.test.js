import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, evenOddPieces, asOutline } from '../js/svgpath.js';
import { bounds, contains, pointOn, pieces, flatten } from '../js/shapes.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const turn = (q) => { const f = flatten(q); return f.reduce((s, a, k) => { const b = f[(k + 1) % f.length]; return s + a.x * b.y - b.x * a.y; }, 0); };

test('lines, in every spelling: absolute, relative, H and V, implied after a move', () => {
  assert.deepEqual(parsePath('M10 10 L110 10 L110 60 L10 60 Z'), [[{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 60 }]]);
  assert.deepEqual(parsePath('m10,10h100v50h-100z'), parsePath('M10 10 L110 10 L110 60 L10 60 Z'));
  assert.deepEqual(parsePath('M10 10 110 10 110 60 10 60'), parsePath('M10 10 L110 10 L110 60 L10 60 Z')); // more pairs are lines; left open, it is closed
  assert.deepEqual(parsePath('M10 10L110 10L110 60L10 60L10 10Z'), parsePath('M10 10 L110 10 L110 60 L10 60 Z')); // drawn back to the start: that point is not doubled
  assert.deepEqual(parsePath('M1e1-10L.5.5-3-4'), [[{ x: 10, y: -10 }, { x: 0.5, y: 0.5 }, { x: -3, y: -4 }]]); // numbers run together the way minifiers leave them
});

test('several pieces, and a piece carried on after Z from where the last began', () => {
  const two = parsePath('M0 0h10v10h-10z M20 0h10v10h-10z');
  assert.equal(two.length, 2);
  assert.deepEqual(two[1][0], { x: 20, y: 0 });
  const carried = parsePath('M5 5h10v10h-10z l-2 0 0 -2z'); // no move: starts again at 5,5
  assert.deepEqual(carried[1], [{ x: 5, y: 5 }, { x: 3, y: 5 }, { x: 3, y: 3 }]);
  const out = asOutline(two);
  assert.deepEqual(pieces(out), [[0, 4], [4, 8]]);
  assert.equal(out[0].m, undefined);
  assert.equal(out[4].m, true);
});

test('a quadratic curve is kept as it is; T carries the bend on', () => {
  const [q] = parsePath('M0 0 Q50 100 100 0 L100 -50 L0 -50 Z');
  assert.deepEqual(q[0], { x: 0, y: 0, c: { x: 50, y: 100 } });
  const [t] = parsePath('M0 0 Q25 50 50 0 T100 0 L50 -80 Z');
  assert.deepEqual(t[1], { x: 50, y: 0, c: { x: 75, y: -50 } }); // the mirror of the last handle
});

test('a cubic curve becomes quadratics that stay within the tolerance of it', () => {
  const d = 'M0 0 C0 100 100 100 100 0 L50 -40 Z';
  const cubicAt = (t) => { const u = 1 - t; return { x: 3 * u * t * t * 100 + t * t * t * 100, y: 3 * u * u * t * 100 + 3 * u * t * t * 100 }; };
  for (const tol of [5, 0.5, 0.05]) {
    const [q] = parsePath(d, tol), curved = q.filter(p => p.c).length;
    let worst = 0;
    for (let k = 0; k < curved; k++) for (let s = 0; s <= 10; s++) {
      const p = pointOn(q, k, s / 10), want = cubicAt((k + s / 10) / curved);
      worst = Math.max(worst, Math.hypot(p.x - want.x, p.y - want.y));
    }
    assert.ok(worst <= tol * 1.5, `tolerance ${tol}: off by ${worst.toFixed(3)} with ${curved} pieces`);
  }
  assert.ok(parsePath(d, 0.05)[0].length > parsePath(d, 5)[0].length); // tighter: more pieces
  // S mirrors the last handle
  const [s] = parsePath('M0 0 C0 50 50 50 50 0 S100 -50 100 0 L50 90 Z', 100);
  assert.deepEqual(s[1].c, { x: 75, y: -75 }); // the one quadratic for C(50,-50 100,-50) from 50,0 to 100,0
});

test('an arc: a circle from two half turns is round, whichever way it is written', () => {
  for (const d of ['M0 50 A50 50 0 1 1 100 50 A50 50 0 1 1 0 50 Z', 'M0 50a50 50 0 1 1 100 0a50 50 0 1 1-100 0z', 'M0 50a50 50 0 11100 0a50 50 0 11-100 0']) {
    const [c] = parsePath(d);
    assert.equal(c.length, 8); // an eighth of a turn each
    const b = bounds(c);
    assert.ok(near(b.x, 0, 0.5) && near(b.y, 0, 0.5) && near(b.w, 100, 1) && near(b.h, 100, 1), JSON.stringify(b));
    for (let k = 0; k < 8; k++) for (const t of [0.25, 0.5, 0.75]) { const p = pointOn(c, k, t); assert.ok(near(Math.hypot(p.x - 50, p.y - 50), 50, 0.6)); }
  }
  // an ellipse arc too small to reach is scaled up, as the standard says: a half circle on the gap
  const [h] = parsePath('M0 0 A1 1 0 0 1 100 0 L50 200 Z');
  assert.ok(near(bounds(h).y, -50, 1));
});

test('a lens of two bends still makes an outline of three points or more', () => {
  const [lens] = parsePath('M0 0 Q50 40 100 0 Q50 -40 0 0 Z');
  assert.ok(lens.length >= 3);
  assert.ok(contains(lens, 50, 0) && !contains(lens, 50, 30));
});

test('even-odd: a piece inside another becomes a hole under the rule shapes are drawn by', () => {
  // an outer box, a box inside it, a box inside that: all drawn the same way round
  const ps = evenOddPieces(parsePath('M0 0h100v100h-100z M20 20h60v60h-60z M40 40h20v20h-20z'));
  assert.deepEqual(ps.map(q => Math.sign(turn(q))), [1, -1, 1]);
  // a second outer box beside the first stays solid
  assert.deepEqual(evenOddPieces(parsePath('M0 0h10v10h-10z M50 0v10h10v-10z')).map(q => Math.sign(turn(q))), [1, 1]);
});

test('what cannot be read says so', () => {
  assert.throws(() => parsePath('10 10 L5 5'), /start with a command/);
  assert.throws(() => parsePath('M0 0 L5'), /not a number/);
  assert.deepEqual(parsePath(''), []);
  assert.deepEqual(parsePath('M0 0 L10 10'), []); // a single line encloses nothing
});

test('closed pieces only: what a line drawing can give a shape', () => {
  const d = 'M0 0h10v10h-10z M20 0L30 10 M40 0h10v10h-10v-10 M60 0q5 5 10 0';
  assert.equal(parsePath(d).length, 3);                          // everything, each open one closed (the bare line and the lone bend enclose too little to keep)
  const closed = parsePath(d, 0.25, { closedOnly: true });
  assert.deepEqual(closed.map(q => q[0].x), [0, 40]);            // closed by Z, or drawn back to its start
});
