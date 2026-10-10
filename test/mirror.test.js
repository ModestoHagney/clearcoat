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

test('withMirrors: a Mirrored layer is followed by its other side, made fresh each time', async () => {
  const { withMirrors, mirrorImage } = await import('../js/mirror.js');
  const m = map();
  const l = shape([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 100, y: 100 }]);
  const plain = shape([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 10, y: 50 }]);
  const doc = { regionMap: m, baseColor: '#ffffff', layers: [plain, l] };
  assert.equal(withMirrors(doc), doc, 'nothing mirrored: the doc itself');
  l.mirrored = true;
  const shown = withMirrors(doc);
  assert.deepEqual(shown.layers.map(x => x.id), [plain.id, l.id, l.id + '~m']);
  assert.equal(shown.layers[2].mirrored, false);
  assert.deepEqual(shown.layers[2].pts[1], { x: 200, y: 800 });
  assert.equal(doc.layers.length, 2, 'the doc is not changed');
  l.pts[1].x = 300; // edit the layer: the other side follows
  assert.deepEqual(withMirrors(doc).layers[2].pts[1], { x: 300, y: 800 });
  // a layer that cannot be mirrored just paints one side
  const off = shape([{ x: 1900, y: 1900 }, { x: 1950, y: 1900 }, { x: 1900, y: 1950 }]); off.mirrored = true;
  assert.equal(mirrorImage(m, off), null);
  assert.equal(withMirrors({ ...doc, layers: [off] }).layers.length, 1);
});

test('text and pictures are carried across but stay readable, unless a true mirror is asked for', () => {
  const m = map(); // left ↔ right is a top/bottom reflection; the roof has a level centreline
  const pic = (x, y, extra = {}) => ({ id: 'p', type: 'image', name: 'Logo', img: { width: 100, height: 40 }, x, y, scale: 1, rotation: 10, flipH: false, flipV: false, ...extra });
  const onTwin = mirrorLayer(m, pic(200, 50)).copy;
  assert.deepEqual([onTwin.x, onTwin.y], [200, 750]);
  // a top/bottom reflection with the reversal taken out is a half turn: flipped both ways
  assert.deepEqual([onTwin.flipH, onTwin.flipV, onTwin.rotation], [true, true, -10]);
  const trueMirror = mirrorLayer(m, pic(200, 50, { mirrorFlip: true })).copy;
  assert.deepEqual([trueMirror.flipH, trueMirror.flipV], [false, true]);
  const text = mirrorLayer(m, { ...pic(1100, 100), type: 'text' }).copy; // across the roof's centreline
  assert.equal(text.flipH, false, 'not reversed');
  assert.deepEqual([text.x, text.y], [1300, 100]);
});

test('a filled C-shaped panel mirrors onto its twin, though the middle of its box is not on it', () => {
  // a C: the middle of its box is the gap, which belongs to another panel
  const c = (x, y) => [{ x, y }, { x: x + 300, y }, { x: x + 300, y: y + 60 }, { x: x + 60, y: y + 60 }, { x: x + 60, y: y + 240 }, { x: x + 300, y: y + 240 }, { x: x + 300, y: y + 300 }, { x, y: y + 300 }];
  const m = parseRegionMap({
    format: 'clearcoat-regions/1', car: 'test',
    regions: [
      { id: 'c1', name: 'Arch left', x: 0, y: 0, w: 300, h: 300, points: c(0, 0) },
      { id: 'c2', name: 'Arch right', x: 1000, y: 0, w: 300, h: 300, points: c(1000, 0) },
      { id: 'gap', name: 'Wheel', x: 100, y: 100, w: 150, h: 100, points: box(100, 100, 150, 100) },
    ],
  });
  setMirror(m, m.regions[0], 'c2');
  assert.equal(pieceAt(m, 150, 150).id, 'gap'); // what the middle of the box is on
  const l = shape(c(0, 0));
  const { copy, dst, error } = mirrorLayer(m, l);
  assert.equal(error, undefined);
  assert.equal(dst.id, 'c2');
  assert.ok(copy.pts.every(p => p.x >= 1000 && p.x <= 1300));
  // a shape that sits wholly in the gap still belongs to the gap's panel
  assert.match(mirrorLayer(m, shape(box(120, 120, 60, 40))).error, /Wheel has no twin/);
});
