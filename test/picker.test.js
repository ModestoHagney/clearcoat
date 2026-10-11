import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsv, hsvToHex, parseHex, rgbToHex, hexToRgb } from '../next/picker.js';

test('a colour goes to the square and the hue bar and comes back the same', () => {
  for (const hex of ['#000000', '#ffffff', '#808080', '#ff0000', '#00ff00', '#0000ff', '#1a6cff', '#111214', '#e6194b', '#ffe119', '#0082c8', '#f58231', '#39ff14', '#7b2d8e']) {
    assert.equal(hsvToHex(...hexToHsv(hex)), hex, hex);
  }
  assert.deepEqual(hexToHsv('#ff0000'), [0, 1, 1]);
  assert.deepEqual(hexToHsv('#00ff00'), [120, 1, 1]);
  assert.deepEqual(hexToHsv('#0000ff'), [240, 1, 1]);
  assert.equal(hsvToHex(360, 1, 1), '#ff0000'); // the far end of the hue bar is red again
});

test('typed values: hex with or without #, the short form, and nothing half-typed', () => {
  assert.equal(parseHex('#1A6CFF'), '#1a6cff');
  assert.equal(parseHex(' 1a6cff '), '#1a6cff');
  assert.equal(parseHex('#fa0'), '#ffaa00');
  assert.equal(parseHex('#1a6c'), null);
  assert.equal(parseHex('zzzzzz'), null);
  assert.equal(rgbToHex(26, 108, 255), '#1a6cff');
  assert.equal(rgbToHex(300, -5, 12.6), '#ff000d'); // out of range is held in range
  assert.deepEqual(hexToRgb('#1a6cff'), [26, 108, 255]);
});
