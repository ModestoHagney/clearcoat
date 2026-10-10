import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js makes scratch canvases at module scope; stub the DOM (see engine.test.js)
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { createDoc, createFillLayer, serializeDoc, deserializeDoc, cleanPalette } = await import('../js/engine.js');

test('a free shape keeps its points and bends through save and load', async () => {
  const doc = createDoc();
  const l = createFillLayer('#111214');
  l.shape = 'path';
  l.pts = [{ x: 0, y: 0, c: { x: 50, y: -80 } }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  l.colorRef = 'c1';
  doc.layers.push(l);
  doc.palette = [{ id: 'c1', name: 'Main', color: '#111214' }];
  doc.baseRef = 'c1';
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))));
  assert.equal(back.layers[0].shape, 'path');
  assert.deepEqual(back.layers[0].pts, l.pts);
  assert.equal(back.layers[0].colorRef, 'c1');
  assert.deepEqual(back.palette, doc.palette);
  assert.equal(back.baseRef, 'c1');
});

test('a ready-made fill has no points; junk points and a dangling base link are dropped', async () => {
  const doc = createDoc();
  doc.layers.push(createFillLayer('#ffffff'));
  const data = JSON.parse(JSON.stringify(serializeDoc(doc)));
  data.layers.push({ ...data.layers[0], id: 'x', shape: 'path', pts: [{ x: 1, y: 1 }, { x: 'a', y: 2 }] });
  data.baseRef = 'gone';
  const back = await deserializeDoc(data);
  assert.equal(back.layers[0].pts, null);
  assert.equal(back.layers[1].pts, null); // fewer than three good points
  assert.equal(back.baseRef, null);
});

test('cleanPalette keeps only well-formed colours', () => {
  assert.deepEqual(cleanPalette([{ id: 'a', name: 'A', color: '#ABCDEF' }, { id: 'b', color: 'red' }, null, { name: 'no id', color: '#000000' }]),
    [{ id: 'a', name: 'A', color: '#abcdef' }]);
  assert.deepEqual(cleanPalette(undefined), []);
});
