import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEF_FORMAT, MOODS, MOOD_IDS, STYLE_IDS, FINISH_IDS,
  fitWithin, dataUrlBytes, formatBytes, normalizeHex,
  validateBrief, buildBrief, briefFilename, logoNameFromFile, moveItem,
} from '../js/brief-shared.js';

const HEX = /^#[0-9a-f]{6}$/;

test('mood palette table matches the generator spec', () => {
  const expected = {
    night: ['#0b1b3a', '#ff6a00', '#ffffff'],
    sunset: ['#2a0a3a', '#ff4e50', '#f9d423'],
    forest: ['#0f2f1f', '#9acd32', '#f4f1de'],
    ice: ['#e8f1f8', '#1b6ca8', '#0a1a2a'],
    fire: ['#1a0505', '#ff2a00', '#ffb400'],
    military: ['#2f3a24', '#6b7a4b', '#d8c58a'],
    retro: ['#f2e8cf', '#d1495b', '#1d3557'],
    neon: ['#0a0a0f', '#39ff14', '#ff2d95'],
    royal: ['#1a0b3d', '#ffd700', '#ffffff'],
    mono: ['#111111', '#ffffff', '#ff3b3b'],
  };
  assert.deepEqual(MOOD_IDS, Object.keys(expected));
  for (const m of MOODS) {
    assert.deepEqual(m.colors, expected[m.id], m.id);
    for (const c of m.colors) assert.match(c, HEX);
  }
});

test('enum tables match the schema', () => {
  assert.equal(BRIEF_FORMAT, 'clearcoat-brief/1');
  assert.deepEqual(STYLE_IDS, ['minimal', 'clean', 'bold', 'aggressive', 'classic', 'gradient']);
  assert.deepEqual(FINISH_IDS, ['gloss', 'matte', 'satin', 'metallic', 'pearl', 'candy', 'chrome']);
});

test('fitWithin downscales the longest edge to the cap and never upscales', () => {
  assert.deepEqual(fitWithin(4096, 2048, 1024), { w: 1024, h: 512, scale: 0.25 });
  assert.deepEqual(fitWithin(300, 3000, 1024), { w: 102, h: 1024, scale: 1024 / 3000 });
  assert.deepEqual(fitWithin(800, 600, 1024), { w: 800, h: 600, scale: 1 });
  assert.deepEqual(fitWithin(1024, 1024, 1024), { w: 1024, h: 1024, scale: 1 });
  // degenerate inputs still produce a drawable canvas
  assert.deepEqual(fitWithin(0, 0, 1024), { w: 1, h: 1, scale: 1 });
  const thin = fitWithin(100000, 1, 1024);
  assert.equal(thin.w, 1024); assert.equal(thin.h, 1);
  // default cap is 1024
  assert.equal(fitWithin(2048, 100).w, 1024);
});

test('dataUrlBytes decodes base64 length with padding', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,AA=='), 1);
  assert.equal(dataUrlBytes('data:text/plain,hello'), 5);
  assert.equal(dataUrlBytes('nope'), 0);
  assert.equal(dataUrlBytes(null), 0);
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(500), '1 KB');
  assert.equal(formatBytes(1536), '2 KB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.50 MB');
});

test('normalizeHex accepts #rgb, #rrggbb, bare, rejects junk', () => {
  assert.equal(normalizeHex('#FF6A00'), '#ff6a00');
  assert.equal(normalizeHex('ff6a00'), '#ff6a00');
  assert.equal(normalizeHex('#f60'), '#ff6600');
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex(undefined), null);
});

const full = () => ({
  driver: { name: 'R. Davenport', number: '64', custid: '1016399' },
  team: 'OpMo Enduro Alpha',
  car: 'Dallara P217',
  paletteMode: 'colors',
  colors: { primary: '#0b1b3a', secondary: '#ff6a00', accent: '#ffffff' },
  mood: null,
  style: 'bold',
  finish: 'metallic',
  logos: [
    { name: 'OpMo', src: 'data:image/png;base64,AAAA' },
    { name: 'Second', src: 'data:image/png;base64,BBBB' },
  ],
  notes: '  keep the roof white  ',
});

test('validateBrief: happy path and each failure', () => {
  assert.deepEqual(validateBrief(full()), {});
  assert.ok(validateBrief({ ...full(), driver: { name: '', number: '64', custid: '' } }).name);
  assert.ok(validateBrief({ ...full(), driver: { name: 'x', number: '', custid: '' } }).number);
  assert.ok(validateBrief({ ...full(), driver: { name: 'x', number: '1234', custid: '' } }).number);
  assert.ok(validateBrief({ ...full(), driver: { name: 'x', number: '6 4', custid: '' } }).number);
  assert.ok(validateBrief({ ...full(), driver: { name: 'x', number: '64', custid: '12a' } }).custid);
  assert.equal(validateBrief({ ...full(), driver: { name: 'x', number: '64', custid: '' } }).custid, undefined);
  assert.ok(validateBrief({ ...full(), car: '' }).car);
  assert.ok(validateBrief({ ...full(), colors: { primary: 'zz', secondary: '#000', accent: '#fff' } }).palette);
  assert.ok(validateBrief({ ...full(), paletteMode: 'mood', mood: null }).palette);
  assert.deepEqual(validateBrief({ ...full(), paletteMode: 'mood', mood: 'neon' }), {});
  assert.ok(validateBrief({ ...full(), style: 'swoopy' }).style);
  assert.ok(validateBrief({ ...full(), finish: null }).finish);
});

test('buildBrief emits exactly the schema (explicit colours)', () => {
  const b = buildBrief(full());
  assert.deepEqual(Object.keys(b), ['format', 'car', 'team', 'driver', 'palette', 'style', 'finish', 'logos', 'notes']);
  assert.equal(b.format, 'clearcoat-brief/1');
  assert.equal(b.car, 'Dallara P217');
  assert.equal(b.team, 'OpMo Enduro Alpha');
  assert.deepEqual(b.driver, { name: 'R. Davenport', number: '64', custid: '1016399' });
  assert.deepEqual(b.palette, { primary: '#0b1b3a', secondary: '#ff6a00', accent: '#ffffff' });
  assert.equal(b.style, 'bold');
  assert.equal(b.finish, 'metallic');
  assert.deepEqual(b.logos, [
    { name: 'OpMo', src: 'data:image/png;base64,AAAA', priority: 1 },
    { name: 'Second', src: 'data:image/png;base64,BBBB', priority: 2 },
  ]);
  assert.equal(b.notes, 'keep the roof white');
});

test('buildBrief: optional fields are omitted when empty, mood palette shape', () => {
  const s = { ...full(), team: '  ', paletteMode: 'mood', mood: 'sunset', logos: [], notes: '' };
  s.driver = { name: 'A', number: '7', custid: '' };
  const b = buildBrief(s);
  assert.deepEqual(Object.keys(b), ['format', 'car', 'driver', 'palette', 'style', 'finish', 'logos', 'notes']);
  assert.deepEqual(b.driver, { name: 'A', number: '7' });
  assert.deepEqual(b.palette, { mood: 'sunset' });
  assert.deepEqual(b.logos, []);
  assert.equal(b.notes, '');
  // round-trips through JSON unchanged
  assert.deepEqual(JSON.parse(JSON.stringify(b)), b);
});

test('briefFilename slugs the driver and number', () => {
  assert.equal(briefFilename('R. Davenport', '64'), 'r-davenport-64.brief.json');
  assert.equal(briefFilename('José Álvarez', '7'), 'jose-alvarez-7.brief.json');
  assert.equal(briefFilename('', ''), 'driver-brief.brief.json');
  assert.equal(briefFilename('a/b\\c:d', '00'), 'a-b-c-d-00.brief.json');
});

test('logoNameFromFile strips extension and separators', () => {
  assert.equal(logoNameFromFile('OpMo_Logo-white.png'), 'OpMo Logo white');
  assert.equal(logoNameFromFile('sponsor.svg'), 'sponsor');
  assert.equal(logoNameFromFile(''), 'logo');
});

test('moveItem reorders immutably and ignores out-of-range', () => {
  const a = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(a, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(a, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(a, 1, 1), a);
  assert.deepEqual(moveItem(a, 1, 9), a);
  assert.notEqual(moveItem(a, 1, 9), a);
  assert.deepEqual(a, ['a', 'b', 'c', 'd']);
});
