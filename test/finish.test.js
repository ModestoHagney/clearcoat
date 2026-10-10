import test from 'node:test';
import assert from 'node:assert/strict';

// finish.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { finishOf, layerColour, withPatterns, baseFinish, withFinishes, setRule, clearRule, finishList, ruleFor, readFinish, writeFinish, finishLabel, presetOf, SPARKLE } = await import('../js/finish.js');
const { createDoc, createFillLayer, serializeDoc, deserializeDoc, cleanFinishRules } = await import('../js/engine.js');

function doc() {
  const d = createDoc();
  d.baseColor = '#ffffff';
  const black = createFillLayer('#111214'); black.name = 'Black one';
  const black2 = createFillLayer('#111214'); black2.name = 'Black two';
  const red = createFillLayer('#D7263D'); red.name = 'Red';
  const logo = { id: 'pic', type: 'image', name: 'Logo', material: 'gloss', visible: true };
  d.layers.push(black, black2, red, logo);
  return d;
}

test('a colour rule gives every layer of that colour the finish, and nothing else', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  assert.deepEqual(d.layers.map(l => finishOf(d, l)), ['matte', 'matte', 'gloss', 'gloss']);
  assert.equal(baseFinish(d), 'gloss');
  setRule(d, '#FFFFFF', 'pearl'); // case does not matter; the base coat follows too
  assert.equal(baseFinish(d), 'pearl');
});

test('a layer\'s own finish beats its colour\'s rule, plain gloss included', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  d.layers[1].material = 'chrome'; d.layers[1].finishOwn = true;
  assert.equal(finishOf(d, d.layers[1]), 'chrome');
  d.layers[0].material = 'gloss'; d.layers[0].finishOwn = true;
  assert.equal(finishOf(d, d.layers[0]), 'gloss');
});

test('the finish follows the colour when a shape is recoloured', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  d.layers[2].color = '#111214';
  assert.equal(finishOf(d, d.layers[2]), 'matte');
  d.layers[0].color = '#00a651';
  assert.equal(finishOf(d, d.layers[0]), 'gloss');
});

test('withFinishes hands the engine layers carrying their finish, without touching the doc', () => {
  const d = doc();
  assert.equal(withFinishes(d), d, 'no rules: the doc itself');
  setRule(d, '#111214', 'matte');
  const shown = withFinishes(d);
  assert.deepEqual(shown.layers.map(l => l.material), ['matte', 'matte', 'gloss', 'gloss']);
  assert.equal(d.layers[0].material, 'gloss');
  assert.equal(shown.layers[2], d.layers[2], 'unchanged layers are the same objects');
});

test('setRule replaces a colour\'s rule in place; gloss is kept as a choice; clearRule removes it', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  setRule(d, '#d7263d', 'pearl');
  setRule(d, '#111214', 'satin');
  assert.deepEqual(d.finishRules, [{ color: '#111214', material: 'satin' }, { color: '#d7263d', material: 'pearl' }]);
  setRule(d, '#111214', 'gloss');
  assert.deepEqual(d.finishRules[0], { color: '#111214', material: 'gloss' });
  assert.equal(finishList(d).find(f => f.colour === '#111214').material, 'gloss');
  assert.deepEqual(d.layers.map(l => finishOf(d, l)), ['gloss', 'gloss', 'pearl', 'gloss']);
  clearRule(d, '#111214');
  assert.equal(ruleFor(d, '#111214'), null);
  assert.equal(d.finishRules.length, 1);
});

test('finishList: every colour in the livery with its finish, then layers and areas with their own', () => {
  const d = doc();
  // nothing set yet: each colour is there already, as gloss
  assert.deepEqual(finishList(d).map(f => [f.kind, f.colour, f.material, f.used]),
    [['colour', '#ffffff', 'gloss', 1], ['colour', '#111214', 'gloss', 2], ['colour', '#d7263d', 'gloss', 1]]);
  setRule(d, '#111214', 'matte');
  setRule(d, '#00a651', 'chrome'); // a colour not in the livery: kept, not listed
  d.layers[2].material = 'candy'; d.layers[2].finishOwn = true; // Red is finished by itself now, so red is no longer a listed colour
  const area = createFillLayer('#000000'); area.name = 'Area 1'; area.specOnly = true; area.material = 'pearl';
  d.layers.push(area);
  assert.deepEqual(finishList(d), [
    { kind: 'colour', colour: '#ffffff', material: 'gloss', params: null, used: 1 },
    { kind: 'colour', colour: '#111214', material: 'matte', params: null, used: 2 },
    { kind: 'layer', id: d.layers[2].id, name: 'Red', material: 'candy', params: null },
    { kind: 'area', id: area.id, name: 'Area 1', material: 'pearl', params: null },
  ]);
  assert.equal(ruleFor(d, '#00a651').material, 'chrome');
});

test('rules and own-finish marks survive save and load; junk rules are dropped', async () => {
  const d = doc();
  d.layers.pop(); // the stub picture has no src to reload
  setRule(d, '#111214', 'matte');
  d.layers[0].finishOwn = true;
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
  assert.deepEqual(back.finishRules, [{ color: '#111214', material: 'matte' }]);
  assert.equal(back.layers[0].finishOwn, true);
  assert.equal(back.layers[1].finishOwn, undefined);
  assert.deepEqual(cleanFinishRules([{ color: 'red', material: 'matte' }, { color: '#000000', material: 'nope' }, { color: '#ABCDEF', material: 'satin' }, { color: '#abcdef', material: 'matte' }]),
    [{ color: '#abcdef', material: 'satin' }]);
});

test('a finish reads as three numbers and optional sparkle, and writes back to what the engine stamps', () => {
  assert.deepEqual(readFinish('matte', null), { met: 0, rough: 230, clear: 60, sparkle: null });
  assert.equal(presetOf(readFinish('matte', null)), 'matte');
  // untouched preset: its name, no params
  assert.deepEqual(writeFinish(readFinish('matte', null)), { material: 'matte', params: null });
  // a slider moved: still called by the finish it came from, with its own numbers
  assert.deepEqual(writeFinish({ met: 0, rough: 200, clear: 60, sparkle: null }, 'matte'), { material: 'matte', params: { met: 0, rough: 200, clear: 60 } });
  // moved onto another preset's numbers, it is that preset
  assert.deepEqual(writeFinish({ met: 0, rough: 120, clear: 150, sparkle: null }, 'matte'), { material: 'satin', params: null });
});

test('sparkle sits on top of any finish: specks at size 1, chips above', () => {
  const matte = readFinish('matte', null);
  const fine = writeFinish({ ...matte, sparkle: { ...SPARKLE } });
  assert.deepEqual(fine, { material: 'flake', params: { met: 0, rough: 230, clear: 60, density: 18, contrast: 100 } });
  const coarse = writeFinish({ ...matte, sparkle: { amount: 30, size: 5, strength: 60 } });
  assert.deepEqual(coarse, { material: 'glitter', params: { met: 0, rough: 230, clear: 60, density: 30, scale: 5, contrast: 60 } });
  // and reads back as the same finish with the same sparkle
  assert.deepEqual(readFinish(coarse.material, coarse.params), { ...matte, sparkle: { amount: 30, size: 5, strength: 60 } });
  assert.deepEqual(readFinish(fine.material, fine.params).sparkle, { amount: 18, size: 1, strength: 100 });
});

test('labels: a preset, a preset with sparkle, tweaked numbers, an old finish', () => {
  assert.equal(finishLabel('matte', null), 'Matte');
  const s = writeFinish({ ...readFinish('pearl', null), sparkle: { ...SPARKLE } });
  assert.equal(finishLabel(s.material, s.params), 'Pearl + sparkle');
  assert.equal(finishLabel('matte', { met: 10, rough: 200, clear: 60 }), 'Custom');
  assert.equal(finishLabel('carbon', null), 'Carbon');
});

test('a colour rule carries tweaked numbers and sparkle to its layers and the base coat', async () => {
  const d = doc();
  const f = writeFinish({ ...readFinish('matte', null), sparkle: { ...SPARKLE } });
  setRule(d, '#111214', f.material, f.params);
  setRule(d, '#ffffff', 'gloss', { met: 0, rough: 20, clear: 255 }); // gloss, made a little smoother
  const shown = withFinishes(d);
  assert.equal(shown.layers[0].material, 'flake');
  assert.deepEqual(shown.layers[0].matParams, f.params);
  assert.deepEqual([shown.baseMaterial, shown.baseMatParams], ['gloss', { met: 0, rough: 20, clear: 255 }]);
  d.layers.pop();
  const back = await deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(d))));
  assert.deepEqual(back.finishRules, d.finishRules);
  clearRule(d, '#ffffff');
  assert.equal(ruleFor(d, '#ffffff'), null);
});

test('a picture has a colour only once it is given one, and then follows that colour\'s finish', () => {
  const doc = { finishRules: [{ color: '#ff0000', material: 'matte' }], layers: [] };
  assert.equal(layerColour({ type: 'image' }), null);
  assert.equal(finishOf(doc, { type: 'image' }), 'gloss');
  assert.equal(finishOf(doc, { type: 'image', color: '#FF0000' }), 'matte');
});

test('a pattern over a shape is painted and finished as two: the shape, then the pattern in its own colour', () => {
  const shape = { id: 'a', type: 'fill', visible: true, color: '#ff0000', motif: { kind: 'star', size: 80, gap: 40, color: '#000000' } };
  const doc = { baseColor: '#ffffff', finishRules: [{ color: '#000000', material: 'matte' }], layers: [shape] };
  const [under, over] = withFinishes(doc).layers;
  assert.deepEqual([under.id, under.color, under.motif, under.material || 'gloss'], ['a', '#ff0000', undefined, 'gloss']);
  assert.deepEqual([over.id, over.color, over.motif.kind, over.material], ['a~p', '#000000', 'star', 'matte']); // black is matte, wherever it is
  assert.deepEqual(finishList(doc).map(f => f.colour + ':' + f.material), ['#ffffff:gloss', '#ff0000:gloss', '#000000:matte']);
  // pattern only: the shape's own paint is left out
  const only = withPatterns({ layers: [{ ...shape, motif: { ...shape.motif, only: true } }] }).layers;
  assert.deepEqual(only.map(l => l.id + l.color), ['a~p#000000']);
  const plain = { layers: [{ id: 'b', type: 'fill', color: '#ff0000' }] };
  assert.equal(withPatterns(plain), plain);
});

test('a random pattern mixed from several colours is one part per colour, each with that colour\'s finish', () => {
  const shape = { id: 'a', type: 'fill', visible: true, color: '#ff0000', motif: { kind: 'star', size: 80, gap: 40, color: '#000000', random: true, seed: 3, colors: ['#ffffff', '#00ff00'] } };
  const doc = { baseColor: '#808080', finishRules: [{ color: '#00ff00', material: 'chrome' }], layers: [shape] };
  const ls = withFinishes(doc).layers;
  assert.deepEqual(ls.map(l => [l.id, l.color, l.motif ? l.motif.part : '-', l.material || 'gloss'].join(' ')), ['a #ff0000 - gloss', 'a~p0 #000000 0 gloss', 'a~p1 #ffffff 1 gloss', 'a~p2 #00ff00 2 chrome']);
  assert.deepEqual(finishList(doc).map(f => f.colour), ['#808080', '#ff0000', '#000000', '#ffffff', '#00ff00']);
  // with Random off the extra colours are not used
  assert.deepEqual(withPatterns({ layers: [{ ...shape, motif: { ...shape.motif, random: false } }] }).layers.map(l => l.id), ['a', 'a~p']);
});
