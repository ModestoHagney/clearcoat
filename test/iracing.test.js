import test from 'node:test';
import assert from 'node:assert/strict';

// iracing.js pulls in engine.js, which makes scratch canvases at module
// scope; stub just enough DOM for the import (see engine.test.js).
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { paintFilenames, validCustid, matchCar } = await import('../js/iracing.js');

test('paintFilenames: car paint and its spec map', () => {
  assert.deepEqual(paintFilenames({ target: 'car', customNumber: false }, '123456'), ['car_123456.tga', 'car_spec_123456.tga']);
});

test('paintFilenames: a custom-number paint uses the car_num_ prefix, same spec name', () => {
  assert.deepEqual(paintFilenames({ target: 'car', customNumber: true }, '123456'), ['car_num_123456.tga', 'car_spec_123456.tga']);
});

test('paintFilenames: helmets and suits have no spec map', () => {
  assert.deepEqual(paintFilenames({ target: 'helmet' }, '7'), ['helmet_7.tga', null]);
  assert.deepEqual(paintFilenames({ target: 'suit' }, '7'), ['suit_7.tga', null]);
});

test('validCustid: digits only', () => {
  assert.equal(validCustid('123456'), true);
  assert.equal(validCustid(' 123456 '), true);
  for (const bad of ['', null, undefined, '12a', 'car', '12 34']) assert.equal(validCustid(bad), false);
});

test('matchCar: the template\'s name finds its car folder, and says when it cannot tell', () => {
  const folders = ['bmwm4gt3', 'bmwm4gt4', 'ferrari488gt3', 'ferrari488gt3evo', 'hyundaielantracn7', 'hyundaivelostern', 'mx5 cup', 'mx5 mx52016', 'porsche992cup', 'rt2000'];
  assert.equal(matchCar('Hyundai Veloster N', folders).car, 'hyundaivelostern');
  assert.equal(matchCar('BMW_M4_GT3_template.psd', folders).car, 'bmwm4gt3');
  assert.equal(matchCar('Ferrari 488 GT3 Evo', folders).car, 'ferrari488gt3evo'); // the longer whole name wins
  assert.equal(matchCar('Porsche 911 GT3 Cup (992)', folders).car, 'porsche992cup');
  const lost = matchCar('Skip Barber Formula 2000', folders);
  assert.equal(lost.car, null);                        // nothing close: it is asked for
  assert.equal(lost.ranked.length, folders.length);    // with every folder listed, nearest first
  assert.equal(matchCar('untitled livery', folders).car, null);
  assert.equal(matchCar('anything', []).car, null);
});
