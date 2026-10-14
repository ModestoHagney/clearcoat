import test from 'node:test';
import assert from 'node:assert/strict';
import { dataOf } from '../next/icons.js';
import { parsePath } from '../js/svgpath.js';
import { bounds, flatten } from '../js/shapes.js';

const rect = (attrs) => ({ tagName: 'rect', getAttribute: (k) => attrs[k] ?? null, hasAttribute: (k) => k in attrs });

test('a rect keeps its rounded corners, with rx and ry clamped to half a side', () => {
  assert.equal(dataOf(rect({ x: 0, y: 0, width: 10, height: 4 })), 'M0 0h10v4h-10z'); // no rx: square, as before
  const round = parsePath(dataOf(rect({ x: 0, y: 0, width: 10, height: 4, rx: 1 })));
  const b = bounds(round[0]);
  assert.deepEqual([b.x, b.y, b.w, b.h].map(Math.round), [0, 0, 10, 4]);
  assert.ok(!flatten(round[0]).some(p => Math.hypot(p.x, p.y) < 0.2)); // the corner itself is cut off
  assert.equal(dataOf(rect({ x: 0, y: 0, width: 10, height: 4, ry: 1 })), dataOf(rect({ x: 0, y: 0, width: 10, height: 4, rx: 1, ry: 1 }))); // ry alone sets rx too
  assert.equal(dataOf(rect({ x: 0, y: 0, width: 10, height: 4, rx: 50 })), dataOf(rect({ x: 0, y: 0, width: 10, height: 4, rx: 5, ry: 2 }))); // clamped
});
