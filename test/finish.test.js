import test from 'node:test';
import assert from 'node:assert/strict';

// finish.js pulls in engine.js; stub the DOM it touches at import
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { finishOf, baseFinish, withFinishes, setRule, finishList, ruleFor } = await import('../js/finish.js');
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

test('setRule replaces a colour\'s rule; gloss removes it', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  setRule(d, '#111214', 'satin');
  assert.deepEqual(d.finishRules, [{ color: '#111214', material: 'satin' }]);
  setRule(d, '#111214', 'gloss');
  assert.deepEqual(d.finishRules, []);
  assert.equal(ruleFor(d, '#111214'), null);
});

test('finishList: rules with how much they cover, then layers and areas with their own', () => {
  const d = doc();
  setRule(d, '#111214', 'matte');
  d.layers[2].material = 'candy'; d.layers[2].finishOwn = true;
  const area = createFillLayer('#000000'); area.name = 'Area 1'; area.specOnly = true; area.material = 'pearl';
  d.layers.push(area);
  assert.deepEqual(finishList(d), [
    { kind: 'colour', colour: '#111214', material: 'matte', used: 2 },
    { kind: 'layer', id: d.layers[2].id, name: 'Red', material: 'candy' },
    { kind: 'area', id: area.id, name: 'Area 1', material: 'pearl' },
  ]);
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
