import test from 'node:test';
import assert from 'node:assert/strict';

// iracing.js pulls in engine.js, which makes scratch canvases at module
// scope; stub just enough DOM for the import (see engine.test.js).
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
const { paintFilenames, validCustid } = await import('../js/iracing.js');

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
