import test from 'node:test';
import assert from 'node:assert/strict';

// template.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { templateRegions } = await import('../js/template.js');

const square = (x, y, s = 100) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const zone = (kind, x, y) => ({ kind, x, y, w: 120, h: 60 });

test('templateRegions: pieces make a map when there is none', () => {
  const { map, pieces, zones } = templateRegions(null, { pieces: [square(0, 0), square(300, 0)] }, 'Veloster');
  assert.equal(pieces, 2);
  assert.equal(zones, 0);
  assert.equal(map.car, 'Veloster');
  assert.deepEqual(map.regions.map(r => r.id), ['piece_1', 'piece_2']);
  assert.ok(map.regions.every(r => r.points.length === 4));
});

test('templateRegions: reloading keeps pieces that are already there', () => {
  const first = templateRegions(null, { pieces: [square(0, 0), square(300, 0)] }, 'Veloster').map;
  first.regions[0].name = 'Roof'; // the user has named one since
  const again = templateRegions(first, { pieces: [square(0, 0), square(300, 0), square(600, 0)] }, 'Veloster');
  assert.equal(again.pieces, 0);
  assert.equal(again.map.regions.length, 2);
  assert.equal(again.map.regions[0].name, 'Roof');
});

test('templateRegions: zones sit after the pieces and are replaced on reload', () => {
  const pieces = [square(0, 0), square(300, 0)];
  const a = templateRegions(null, { pieces, zones: [zone('number', 100, 400), zone('sponsor', 900, 400)] }, 'Veloster');
  assert.equal(a.zones, 2);
  assert.deepEqual(a.map.regions.map(r => !!r.kind), [false, false, true, true]);
  const b = templateRegions(a.map, { pieces, zones: [zone('number', 100, 400)] }, 'Veloster');
  assert.equal(b.map.regions.filter(r => r.kind).length, 1);
  assert.equal(b.map.regions.filter(r => !r.kind).length, 2);
});

test('templateRegions: nothing to add leaves the map as it was', () => {
  assert.equal(templateRegions(null, {}, 'x').map, null);
});
