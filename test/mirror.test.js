import test from 'node:test';
import assert from 'node:assert/strict';

// mirror.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { mirrorLayer, pieceAt } = await import('../js/mirror.js');
const { createFillLayer } = await import('../js/engine.js');
const { parseRegionMap, setMirror } = await import('../js/regions.js');

const box = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function map() {
  const m = parseRegionMap({
    format: 'clearcoat-regions/1', car: 'test',
    regions: [
      // lopsided on purpose: a plain rectangle fits every kind of mirror equally
      { id: 'left', name: 'Left', x: 0, y: 0, w: 400, h: 200, points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 100, y: 200 }, { x: 0, y: 100 }] },
      { id: 'right', name: 'Right', x: 0, y: 600, w: 400, h: 200, points: [{ x: 0, y: 800 }, { x: 400, y: 800 }, { x: 400, y: 600 }, { x: 100, y: 600 }, { x: 0, y: 700 }] },
      { id: 'roof', name: 'Roof', x: 1000, y: 0, w: 400, h: 400, points: box(1000, 0, 400, 400), center: { a: { x: 1000, y: 0 }, b: { x: 1400, y: 0 } } },
      { id: 'lone', name: 'Lone', x: 1600, y: 0, w: 100, h: 100, points: box(1600, 0, 100, 100) },
      { id: 'num', name: 'Number', kind: 'number', x: 50, y: 50, w: 60, h: 60 },
    ],
  });
  setMirror(m, m.regions[0], 'right'); // one above the other on the sheet: a top/bottom reflection
  return m;
}
const shape = (pts) => { const l = createFillLayer('#111214'); l.shape = 'path'; l.name = 'Wedge'; l.pts = pts; const xs = pts.map(p => p.x), ys = pts.map(p => p.y); l.rx = Math.min(...xs); l.ry = Math.min(...ys); l.rw = Math.max(...xs) - l.rx; l.rh = Math.max(...ys) - l.ry; return l; };

test('pieceAt looks past the kit\'s zones', () => {
  assert.equal(pieceAt(map(), 60, 60).id, 'left');
  assert.equal(pieceAt(null, 1, 1), null);
});

test('a free shape mirrors onto the twin panel point by point', () => {
  const m = map();
  assert.equal(m.regions[0].mirrorKind, 'flipV');
  const l = shape([{ x: 0, y: 0 }, { x: 200, y: 0, c: { x: 300, y: 50 } }, { x: 100, y: 100 }]);
  const { copy, dst, error } = mirrorLayer(m, l);
  assert.equal(error, undefined);
  assert.equal(dst.id, 'right');
  assert.deepEqual(copy.pts, [{ x: 0, y: 800 }, { x: 200, y: 800, c: { x: 300, y: 750 } }, { x: 100, y: 700 }]);
  assert.deepEqual([copy.rx, copy.ry, copy.rw, copy.rh], [0, 700, 300, 100]);
  assert.equal(copy.flipV, false, 'the points already are the mirror image');
  assert.notEqual(copy.id, l.id);
  assert.equal(copy.name, 'Wedge (mirrored)');
  assert.deepEqual(l.pts[0], { x: 0, y: 0 }, 'the original is untouched');
});

test('across a centreline: the shape lands on the other half of the same panel', () => {
  const l = shape([{ x: 1050, y: 100 }, { x: 1150, y: 100 }, { x: 1050, y: 300 }]);
  const { copy, dst } = mirrorLayer(map(), l);
  assert.equal(dst.id, 'roof');
  assert.deepEqual(copy.pts, [{ x: 1350, y: 100 }, { x: 1250, y: 100 }, { x: 1350, y: 300 }]);
});

test('a ready-made box flips onto the twin; a trim follows it', () => {
  const m = map();
  const l = createFillLayer('#ff0000'); l.shape = 'triangle'; l.name = 'Tri';
  l.rx = 100; l.ry = 20; l.rw = 100; l.rh = 60;
  l.clip = [box(0, 0, 400, 200)]; l.clipAt = [{ x: 150, y: 50 }];
  const { copy } = mirrorLayer(m, l);
  assert.deepEqual([copy.rx, copy.ry, copy.rw, copy.rh], [100, 720, 100, 60]);
  assert.equal(copy.flipV, true);
  assert.equal(copy.clip.length, 1);
  assert.ok(copy.clip[0].every(q => q.y >= 596 && q.y <= 804), 'trimmed to the twin panel (with its bleed)');
  assert.deepEqual(copy.clipAt, [{ x: 150, y: 750 }]);
});

test('errors say what is missing', () => {
  const m = map();
  const off = shape([{ x: 1900, y: 1900 }, { x: 1950, y: 1900 }, { x: 1900, y: 1950 }]);
  assert.match(mirrorLayer(m, off).error, /not on a panel/);
  const lone = shape([{ x: 1610, y: 10 }, { x: 1650, y: 10 }, { x: 1610, y: 50 }]);
  assert.match(mirrorLayer(m, lone).error, /no twin or centreline/);
  assert.match(mirrorLayer(null, lone).error, /template/);
});
