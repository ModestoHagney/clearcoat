import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js rasterises text through a 2D context. Node has no canvas, so the
// stub below is just enough for regenerateText's straight-text path to run:
// every draw call is a no-op and measureText reports a width proportional to
// the string, which is what the tests below check against.
function stubCtx() {
  const ctx = {
    font: '', textAlign: '', textBaseline: '', lineJoin: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    measureText: (s) => ({ width: s.length * 10 }),
    fillText() {}, strokeText() {}, save() {}, restore() {}, translate() {}, rotate() {},
    drawImage() {}, clearRect() {}, fillRect() {},
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  };
  return ctx;
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: stubCtx, toDataURL: () => 'data:text' }),
};
globalThis.Image = class {
  set src(v) { queueMicrotask(() => this.onload && this.onload()); }
};

const { createDoc, createTextLayer, serializeDoc, deserializeDoc } = await import('../js/engine.js');
const {
  applyVariant, variableText, newDriver, normalizeDrivers, exportableDrivers, hasVariables,
} = await import('../js/variants.js');

function docWithVariables() {
  const doc = createDoc();
  const num = { ...createTextLayer(), id: 'T1', name: 'number', text: '00', variable: 'number' };
  const name = { ...createTextLayer(), id: 'T2', name: 'name', text: 'DRIVER', variable: 'name' };
  const plain = { ...createTextLayer(), id: 'T3', name: 'sponsor', text: 'OPMO' };
  const custom = { ...createTextLayer(), id: 'T4', name: 'flag', text: '--', variable: 'custom:flag' };
  doc.layers = [num, name, plain, custom];
  doc.drivers = [
    newDriver({ id: 'D1', name: 'A. Driver', number: '22', custid: '1016399' }),
    newDriver({ id: 'D2', name: 'B. Driver', number: '7', custid: 'abc' }),
    newDriver({ id: 'D3', name: 'C. Driver', number: '3', custid: '555', enabled: false }),
  ];
  return doc;
}

test('a new doc has no drivers and a new text layer has no variable', () => {
  assert.deepEqual(createDoc().drivers, []);
  assert.equal(createTextLayer().variable, null);
});

test('variableText resolves number, name and custom fields', () => {
  const d = { name: 'Ann', number: '42', fields: { flag: 'USA' } };
  assert.equal(variableText('number', d), '42');
  assert.equal(variableText('name', d), 'Ann');
  assert.equal(variableText('custom:flag', d), 'USA');
  assert.equal(variableText('custom:missing', d), '');
  assert.equal(variableText(null, d), null);
  assert.equal(variableText('bogus', d), null);
});

test('applyVariant swaps bound text layers and leaves the live doc alone', () => {
  const doc = docWithVariables();
  const regenerated = [];
  const regen = (l) => { regenerated.push(l.id); l.img = { width: 1, height: 1 }; l.src = 'data:' + l.text; };
  const out = applyVariant(doc, { ...doc.drivers[0], fields: { flag: 'CAN' } }, regen);

  assert.notEqual(out, doc);
  assert.notEqual(out.layers, doc.layers);
  assert.equal(out.layers.length, 4);
  assert.equal(out.layers[0].text, '22');
  assert.equal(out.layers[1].text, 'A. Driver');
  assert.equal(out.layers[3].text, 'CAN');
  assert.equal(out.layers[2], doc.layers[2], 'unbound layers are shared by reference');
  assert.deepEqual(regenerated.sort(), ['T1', 'T2', 'T4']);
  // the master is untouched
  assert.equal(doc.layers[0].text, '00');
  assert.equal(doc.layers[1].text, 'DRIVER');
  assert.equal(doc.layers[3].text, '--');
  // doc-level fields travel with the variant (export reads target/customNumber)
  assert.equal(out.target, doc.target);
  assert.equal(out.customNumber, doc.customNumber);
});

test('applyVariant uses regenerateText by default', () => {
  const doc = docWithVariables();
  const out = applyVariant(doc, doc.drivers[0]);
  assert.equal(out.layers[0].text, '22');
  assert.ok(out.layers[0].img, 'variant layer was re-rasterised');
  assert.notEqual(out.layers[0].img, doc.layers[0].img);
});

test('exportableDrivers keeps enabled rows with a numeric custid', () => {
  const doc = docWithVariables();
  assert.deepEqual(exportableDrivers(doc.drivers).map(d => d.id), ['D1']);
  assert.equal(hasVariables(doc), true);
  assert.equal(hasVariables(createDoc()), false);
});

test('normalizeDrivers drops junk and de-duplicates ids', () => {
  const out = normalizeDrivers([
    { id: 'X', name: 'a', number: 1, custid: 123 },
    { id: 'X', name: 'b' },
    null, 'junk',
    { name: 'c', enabled: false },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 'X');
  assert.equal(out[0].number, '1');
  assert.equal(out[0].custid, '123');
  assert.notEqual(out[1].id, 'X');
  assert.equal(out[2].enabled, false);
  assert.ok(out[2].id);
  assert.deepEqual(normalizeDrivers(undefined), []);
});

test('drivers and text variables survive a serialize → deserialize round trip', async () => {
  const doc = docWithVariables();
  const data = serializeDoc(doc);
  assert.equal(data.drivers.length, 3);
  assert.equal(data.layers[0].variable, 'number');
  assert.equal(data.layers[2].variable, null);

  const back = await deserializeDoc(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(back.drivers, doc.drivers);
  assert.equal(back.layers.find(l => l.id === 'T1').variable, 'number');
  assert.equal(back.layers.find(l => l.id === 'T2').variable, 'name');
  assert.equal(back.layers.find(l => l.id === 'T3').variable, null);
  assert.equal(back.layers.find(l => l.id === 'T4').variable, 'custom:flag');
});

test('deserialize tolerates missing or broken driver data', async () => {
  const data = serializeDoc(createDoc());
  delete data.drivers;
  assert.deepEqual((await deserializeDoc(data)).drivers, []);
  data.drivers = [null, { id: 'A' }, { id: 'A', name: 'dup' }, 5];
  const back = await deserializeDoc(data);
  assert.equal(back.drivers.length, 2);
  assert.notEqual(back.drivers[0].id, back.drivers[1].id);
});
