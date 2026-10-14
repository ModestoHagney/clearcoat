// Overspray: everything around the canvas — menus, tool strip,
// the panel cards, dialogs, the right-click menu and the toast. It reads the
// app state and calls back into `actions`; it holds no livery state itself.

import { pieces, hue } from './map.js';
import { SHAPES, PLAIN_SHAPES, roundedOf, plainOf, softened, boxOutline, aspect, hasInner } from '../js/shapes.js';
import { TEXT_FONTS, GOOGLE_FONTS, fadeStyleOf } from '../js/engine.js';
import { FINISHES, finishName, finishLabel, finishList, layerColour, isArea, readFinish, presetOf, withPatterns } from '../js/finish.js';
import { renderTile } from './preview.js';
import { initPicker } from './picker.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const I = { // 20x20 line icons
  select: '<path d="M5 3v12l3.5-3 2.2 5 2-.9-2.2-5H15z"/>',
  pen: '<path d="M4 15 7 5l9 2-3 9z"/><circle cx="4" cy="15" r="1.4"/><circle cx="7" cy="5" r="1.4"/><circle cx="16" cy="7" r="1.4"/><circle cx="13" cy="16" r="1.4"/>',
  ellipse: '<circle cx="10" cy="10" r="6.5"/>',
  rect: '<rect x="4" y="4.5" width="12" height="11" rx="1"/>',
  triangle: '<path d="M10 4 17 16H3z"/>',
  star: '<path d="m10 3 2.1 4.6 5 .5-3.8 3.3 1.1 4.9L10 13.8l-4.4 2.5 1.1-4.9L2.9 8.1l5-.5z"/>',
  diamond: '<path d="M10 3 17 10 10 17 3 10z"/>',
  hexagon: '<path d="M6.5 4h7l3.5 6-3.5 6h-7L3 10z"/>',
  chevron: '<path d="M4 4h5l6 6-6 6H4l6-6z"/>',
  cross: '<path d="M8 3h4v5h5v4h-5v5H8v-5H3V8h5z"/>',
  round: '<rect x="3.5" y="4.5" width="13" height="11" rx="3.5"/>',
  // a rubber stamp: handle, neck, pad
  stamp: '<path d="M8 3.5h4v3.2l-1 3.3h4a1.5 1.5 0 0 1 1.5 1.5V13h-13v-1.5A1.5 1.5 0 0 1 5 10h4L8 6.7z"/><path d="M4 16.5h12"/>',
  edit: '<path d="M4 16h3l8-8-3-3-8 8z"/><path d="m11 6 3 3"/>',
  band: '<path d="M3 13 13 3M7 17 17 7"/>',
  text: '<path d="M4 5h12M10 5v11M8 16h4"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="m4 14 4-3.5 3 2.5 2-1.5 3 2.5"/>',
  // a tipped paint can with a drip
  piece: '<path d="M8.5 3.5 3.6 8.4a1.6 1.6 0 0 0 0 2.2l4.3 4.3a1.6 1.6 0 0 0 2.2 0l5.4-5.4z"/><path d="M6.2 5.8 9.6 2.4"/><path d="M4 9.6h10.6"/><path d="M16.6 12.6c.8 1.2 1.3 2 1.3 2.7a1.3 1.3 0 0 1-2.6 0c0-.7.5-1.5 1.3-2.7z"/>',
  mcentre: '<path d="M10 2v3M10 8v4M10 15v3"/><path d="M4 6h3M13 6h3M4 14h3M13 14h3"/>',
  // two edges that meet: a link of chain
  mlink: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l.9-.9"/>',
  eye: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.2"/>',
  float: '<rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M8 16h8V8"/>',
  dock: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12 4v12"/>',
  fold: '<path d="m5 8 5 5 5-5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  reset: '<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1"/><path d="M4 3.5v3.4h3.4"/>',
  // an open hand
  hand: '<path d="M7.2 10.5V5.2a1.15 1.15 0 0 1 2.3 0V9.4m0-.4V3.9a1.15 1.15 0 0 1 2.3 0V9m0 .2V4.9a1.15 1.15 0 0 1 2.3 0v5m0-1.6a1.15 1.15 0 0 1 2.3 0v3.9c0 3-1.9 4.8-4.8 4.8h-.9c-1.9 0-3-.8-4.1-2.5l-2.2-3.4a1.15 1.15 0 0 1 1.9-1.3l.9 1.2"/>',
};
I.mpick = I.select;
// an outline as SVG path data (a point marked `m` starts a separate piece)
function pathData(pts, f = (v) => v) {
  let start = 0;
  return pts.map((a, i) => {
    const head = !i || a.m ? ((start = i), `M${f(a.x)} ${f(a.y)}`) : '';
    const last = i + 1 === pts.length || !!pts[i + 1].m, b = pts[last ? start : i + 1];
    return head + (a.c ? `Q${f(a.c.x)} ${f(a.c.y)} ${f(b.x)} ${f(b.y)}` : `L${f(b.x)} ${f(b.y)}`) + (last ? 'Z' : '');
  }).join('');
}
// every ready-made shape that has no icon drawn by hand gets one from its own outline
for (const kind of Object.keys(SHAPES)) {
  if (I[kind]) continue;
  const a = aspect(kind), w = a > 1 ? 14 / a : 14, h = a > 1 ? 14 : 14 * a, x = 10 - w / 2, y = 10 - h / 2, f = (v) => +v.toFixed(2);
  // a rounded one is drawn rounder than it really is: at this size its true corners would not show
  const pts = plainOf(kind) ? softened(plainOf(kind), x, y, w, h, 2.3) : boxOutline(kind, x, y, w, h);
  I[kind] = `<path d="${pathData(pts, f)}"/>`;
}
const svg = (name) => `<svg viewBox="0 0 20 20">${I[name]}</svg>`;
// a shape's own outline, drawn small: { pts, w, h } or a ready-made { shape, w, h }
const shapeSvg = (it) => {
  const pad = Math.max(it.w, it.h) * 0.06, box = `${-pad} ${-pad} ${it.w + 2 * pad} ${it.h + 2 * pad}`;
  let d;
  if (it.pts) d = pathData(it.pts);
  else if (it.shape === 'ellipse') d = `M0 ${it.h / 2}A${it.w / 2} ${it.h / 2} 0 1 0 ${it.w} ${it.h / 2}A${it.w / 2} ${it.h / 2} 0 1 0 0 ${it.h / 2}Z`;
  else if (it.shape === 'triangle') d = `M${it.w / 2} 0L${it.w} ${it.h}L0 ${it.h}Z`;
  else d = `M0 0H${it.w}V${it.h}H0Z`;
  return `<svg viewBox="${box}" aria-hidden="true"><path d="${d}" fill="currentColor" fill-rule="nonzero"/></svg>`;
};

// [id, name]
const TOOLS = [
  ['select', 'Select (V)'],
  ['hand', 'Hand (H)'],
  ['pen', 'Pen (P)'],
  ['shape', 'Shape (U)'],
  ['band', 'Band (B)'],
  ['stamp', 'Stamp (S)'],
  ['text', 'Text (T)'],
  ['image', 'Library'],
  ['piece', 'Fill panel (G)'],
];
// Finish mode: the same drawing tools, but what they draw is an area
const FINISH_TOOLS = [
  ['select', 'Pick what to finish (V)'],
  ['hand', 'Hand (H)'],
  ['pen', 'Draw an area (P)'],
  ['shape', 'Area from a shape (U)'],
  ['piece', 'A whole panel (G)'],
];
const MAP_TOOLS = [
  ['mpick', 'Select a panel'],
  ['hand', 'Hand (H)'],
  ['mcentre', 'Centreline'],
  ['mlink', 'Link edges'],
];
const PANELS = ['layers', 'props', 'colour'];
const WEIGHT_NAMES = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi bold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };
// A pattern's Size and Spacing sliders are finer at the low end, where a
// pixel matters most: the slider runs 0 to 1000 and the value goes with its
// square. [least, most] in px on the sheet.
const CURVED = { size: [10, 400], gap: [0, 200] };
const toSlider = (k, v) => Math.round(1000 * Math.sqrt(Math.max(0, Math.min(1, (v - CURVED[k][0]) / (CURVED[k][1] - CURVED[k][0])))));
const fromSlider = (k, s) => Math.round(CURVED[k][0] + (CURVED[k][1] - CURVED[k][0]) * (s / 1000) ** 2);
// A slider with its value beside it, in a box that can be read, typed in, or
// nudged with the arrow keys. curve: one of CURVED's sliders, whose box shows
// the real value and not where the slider stands.
const slider = (id, min, max, v, curve) => {
  const [lo, hi, val] = curve ? [...CURVED[curve], fromSlider(curve, v)] : [min, max, Math.round(v)];
  return `<span class="slide"><input id="${id}" type="range" min="${min}" max="${max}" value="${Math.round(v)}">` +
    `<input class="nbox" data-for="${id}"${curve ? ` data-curve="${curve}"` : ''} type="number" min="${lo}" max="${hi}" step="1" value="${val}" aria-label="Exact value"></span>`;
};
const hexOf = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v).trim()) ? '#' + String(v).trim().replace('#', '').toLowerCase() : null);

export function initUI(app, actions, version) {
  const panels = {};
  for (const key of PANELS) {
    const p = document.createElement('section');
    p.className = 'panel';
    p.dataset.panel = key;
    p.innerHTML = `<header><h2></h2><button class="icon" data-p="float" title="Float" aria-label="Float">${svg('float')}</button><button class="icon" data-p="fold" title="Fold" aria-label="Fold">${svg('fold')}</button><button class="icon" data-p="close" title="Hide" aria-label="Hide">${svg('close')}</button></header><div class="body"></div>`;
    panels[key] = p;
    $('dock').append(p);
  }

  // ---------- menus ----------
  // [label, shortcut, action, { off, tick }]
  const hasLayer = () => app.sel !== null && app.sel !== 'base';
  // what can be done to the selected shapes as shapes, and whether each applies now
  const shapeCan = () => {
    const ls = actions.selectedLayers(), fills = ls.filter((l) => l.type === 'fill' && !l.specOnly), one = ls.length === 1 ? ls[0] : null;
    const parts = one && Array.isArray(one.pts) && one.pts.some((q) => q.m);
    return { merge: ls.length > 1, wrap: fills.length > 0 && fills.length === ls.length, split: !!parts, fillIn: !!parts && hasInner(one.pts) };
  };
  const shapeItems = () => {
    const can = shapeCan();
    return [['Merge', 'Ctrl+E', 'merge', { off: !can.merge }], ['Wrap', '', 'wrap', { off: !can.wrap }], ['Split', '', 'split', { off: !can.split }], ['Fill in', '', 'fillIn', { off: !can.fillIn }]];
  };
  const layerItems = () => [
    ['Copy', 'Ctrl+C', 'copy', { off: !hasLayer() }], ['Paste', 'Ctrl+V', 'paste', { off: !app.clipboard }], ['Duplicate', 'Ctrl+D', 'duplicate', { off: !hasLayer() }], 0,
    ['Bring to front', 'Ctrl+Shift+]', 'front', { off: !hasLayer() }], ['Bring forward', 'Ctrl+]', 'forward', { off: !hasLayer() }],
    ['Send backward', 'Ctrl+[', 'backward', { off: !hasLayer() }], ['Send to back', 'Ctrl+Shift+[', 'back', { off: !hasLayer() }], 0,
    ['Save to library', '', 'saveShape', { off: (actions.selected() || {}).type !== 'fill' && actions.selectedLayers().length < 2 }],
    ...shapeItems(), 0,
    ['Mirrored', 'Ctrl+M', 'mirror', { off: !hasLayer(), tick: !!(actions.selected() || {}).mirrored }], ['Trim to panels', '', 'trim', { off: !hasLayer() }], 0,
    ['Delete', 'Del', 'remove', { off: !hasLayer() }],
  ];
  const menuDefs = () => ({
    File: [
      ['New', '', 'newLivery'], ['Open…', '', 'open'], ['Save', 'Ctrl+S', 'save'], 0,
      ['Load template…', '', 'pickTemplate'], ['Get a template…', '', 'getTemplate'], ['Car setup…', '', 'carSetup'], ['Link iRacing paints folder…', '', 'linkFolder'], ['Save to iRacing', '', 'saveIracing'], 0,
      ['Export TGA', '', 'exportTga'], ['Export PNG', '', 'exportPng'], ['Send to Trading Paints', '', 'sendTp'],
    ],
    Edit: [
      ['Undo', 'Ctrl+Z', 'undo', { off: !app.canUndo }], ['Redo', 'Ctrl+Y', 'redo', { off: !app.canRedo }], 0,
      ...layerItems(), 0,
      ['Select all', 'Ctrl+A', 'selectAll'], 0,
      ['Group', 'Ctrl+G', 'group', { off: actions.selectedLayers().length < 2 }],
      ['Ungroup', 'Ctrl+Shift+G', 'ungroup', { off: !actions.selectedLayers().some((l) => l.groupId) }],
    ],
    View: [
      ['Layers', '', 'show:layers', { tick: app.show.layers }], ['Properties', '', 'show:props', { tick: app.show.props }], ['Colour', '', 'show:colour', { tick: app.show.colour }], 0,
      ['Panel colours on car', 'C', 'toggleGuide', { tick: actions.guideOn() }], ['Panel outlines', '', 'show:outlines', { tick: app.show.outlines }], ['Template lines', '', 'show:lines', { tick: app.show.lines }], ['Mesh', '', 'show:mesh', { tick: app.show.mesh }], 0,
      ['Light', '', 'theme:light', { tick: app.theme === 'light' }], ['Dark', '', 'theme:dark', { tick: app.theme === 'dark' }], ['Match system', '', 'theme:system', { tick: app.theme === 'system' }], 0,
      ['Fit to screen', 'F', 'fit'],
    ],
    Help: [['Keyboard shortcuts…', 'F1', 'shortcuts'], ['About…', '', 'about']],
  });
  const itemHtml = (it) => {
    if (!it) return '<hr>';
    const [label, key, act, o = {}] = it;
    const cls = 'tick' in o ? (o.tick ? 'tick' : 'notick') : '';
    return `<button data-act="${act}" class="${cls}"${o.off ? ' disabled' : ''}><span>${label}</span><kbd>${key}</kbd></button>`;
  };
  function drawMenus() {
    const open = document.querySelector('.menu.open')?.dataset.menu;
    $('menus').innerHTML = Object.entries(menuDefs()).map(([name, items]) =>
      `<div class="menu${name === open ? ' open' : ''}" data-menu="${name}"><button aria-haspopup="true">${name}</button><div class="drop"${name === open ? '' : ' hidden'}>${items.map(itemHtml).join('')}</div></div>`).join('');
  }
  const closeMenus = () => document.querySelectorAll('.menu.open').forEach((m) => { m.classList.remove('open'); m.querySelector('.drop').hidden = true; });

  // ---------- the strip, modes, hint ----------
  function drawChrome() {
    drawMenus();
    $('modes').innerHTML = [['map', 'Map'], ['paint', 'Paint'], ['finish', 'Finish']].map(([id, name]) =>
      `<button data-mode="${id}" aria-pressed="${app.mode === id}">${name}</button>`).join('');
    // drawing a shape: text is a picture and there are no panels to fill, so those two tools are put away
    const strip = app.workshop ? TOOLS.filter(([id]) => id !== 'text' && id !== 'piece' && id !== 'hand') : app.mode === 'map' ? MAP_TOOLS : app.mode === 'finish' ? FINISH_TOOLS : TOOLS;
    $('tools').innerHTML = strip.map(([id, name]) =>
      `<button class="tool" data-tool="${id}" data-tip="${name}" aria-label="${name}" aria-pressed="${app.tool === id}">${svg(id === 'shape' ? app.shapeKind : id)}</button>`).join('');
    // the armed tool's own choices sit right beside the strip
    const opts = $('toolopts');
    if (app.tool === 'shape') {
      // the plain shapes in a row, and under each one its round-cornered version (a gap where there is none)
      const pick = (k, up) => (k ? `<button class="tool${up ? ' up' : ''}" data-kind="${k}" data-tip="${SHAPES[k]}" aria-label="${SHAPES[k]}" aria-pressed="${app.shapeKind === k}">${svg(k)}</button>` : '<span></span>');
      opts.innerHTML = PLAIN_SHAPES.map((k) => pick(k, true)).join('') + PLAIN_SHAPES.map((k) => pick(roundedOf(k), false)).join('');
      opts.style.gridTemplateColumns = `repeat(${PLAIN_SHAPES.length}, auto)`;
    } else if (app.tool === 'band') {
      opts.innerHTML = `<label class="optrow"><span>Width</span><input id="f-band" type="range" min="4" max="300" value="${app.bandWidth}"><output id="f-band-n" class="num">${app.bandWidth}</output></label>`;
    } else if (app.tool === 'stamp') {
      opts.innerHTML = `<label class="optrow"><span>Shape</span><select id="f-stamp">${motifOptions(app.stamp.key)}</select></label>` +
        `<label class="optrow"><span>Size</span><input id="f-stamp-size" type="range" min="10" max="600" value="${app.stamp.size}"><output id="f-stamp-n" class="num">${app.stamp.size}</output></label>`;
    }
    // drawing a shape: its window's own buttons follow what is selected
    if (app.workshop) { const can = shapeCan(); for (const k of ['wrap', 'split', 'fillIn']) $('sb-' + k).disabled = !can[k]; }
    opts.classList.toggle('rows', app.tool === 'stamp');
    opts.classList.toggle('grid', app.tool === 'shape');
    opts.hidden = app.tool !== 'shape' && app.tool !== 'band' && app.tool !== 'stamp';
    // level with the button it belongs to
    const btn = $('tools').querySelector('.tool[aria-pressed="true"]');
    if (btn && !opts.hidden) {
      const r = btn.getBoundingClientRect();
      opts.style.top = Math.max(4, r.top + r.height / 2 - $('stage').getBoundingClientRect().top - opts.offsetHeight / 2) + 'px';
    }
    $('hint').textContent = actions.hint();
    const live = $('btn-live');
    live.setAttribute('aria-pressed', app.live);
    const paused = app.live && app.liveBad;
    live.classList.toggle('bad', paused);
    live.innerHTML = `<i></i>${paused ? 'Live paused' : 'Live'}`;
    live.title = paused ? 'Click to reconnect to the iRacing paints folder' : 'Send every change to the car in iRacing';
    for (const key of PANELS) panels[key].hidden = !app.show[key] || (key === 'colour' && app.mode !== 'paint');

    $('dock').hidden = ![...$('dock').children].some((p) => !p.hidden);
  }

  // ---------- panels ----------
  const swatch = (l) => {
    if (l.type === 'fill' && l.color) return `background:${esc(l.color)}`;
    // ponytail: the layer's own picture as the swatch; skip the very large ones
    if (l.src && l.src.length < 300000 && /^data:image\/[\w+.-]+;base64,[\w+/=]+$/.test(l.src)) return `background-image:url(${l.src})`;
    return 'background:var(--hover)';
  };
  // a group's own colour down the side of its rows: from its id, so it never changes
  const groupHue = (id) => hue([...String(id)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7));
  function layersHtml() {
    const d = app.doc;
    const picked = new Set(actions.selectedLayers().map((l) => l.id));
    const groups = new Map((d.groups || []).map((g) => [g.id, g]));
    const shown = [...d.layers].reverse().filter((l) => !isArea(l)); // an area is Finish mode's, and shows there
    const one = (l) => `<div class="row${picked.has(l.id) ? ' sel' : ''}${l.groupId ? ' grouped' : ''}" data-layer="${esc(l.id)}" draggable="true"${l.groupId ? ` style="--g:${groupHue(l.groupId)}" title="In a group"` : ''}><span class="sw" style="${swatch(l)}"></span><span class="name">${esc(l.name)}</span>${l.mirrored ? '<span class="tags"><i title="Mirrored">⇄</i></span>' : ''}<button class="rowx" data-del="${esc(l.id)}" title="Delete" aria-label="Delete ${esc(l.name)}">${svg('close')}</button><button class="eye${l.visible ? '' : ' off'}" data-eye="${esc(l.id)}" title="Show or hide" aria-label="Show or hide ${esc(l.name)}">${svg('eye')}</button></div>`;
    // A group is one row when it is folded: its name, its colours in the swatch,
    // and how many layers it holds. Unfolded, that row heads its layers.
    const head = (g, ms) => {
      const cols = [...new Set(ms.map((l) => layerColour(l)).filter(Boolean))].slice(0, 4), n = cols.length;
      const sw = n ? `background:linear-gradient(90deg, ${cols.map((c, i) => `${esc(c)} ${i / n * 100}% ${(i + 1) / n * 100}%`).join(', ')})` : swatch(ms[0]);
      const seen = ms.some((l) => l.visible), open = !g.collapsed;
      return `<div class="row grouped ghead${ms.some((l) => picked.has(l.id)) ? ' sel' : ''}" data-layer="${esc(ms[0].id)}" data-group="${esc(g.id)}" data-last="${esc(ms[ms.length - 1].id)}" draggable="true" style="--g:${groupHue(g.id)}" title="A group of ${ms.length} layers. Click its name again to rename it.">` +
        `<button class="twist" data-fold="${esc(g.id)}" aria-expanded="${open}" title="${open ? 'Fold it to one row' : 'Show its layers'}" aria-label="${open ? 'Fold' : 'Unfold'} ${esc(g.name)}">${open ? '▾' : '▸'}</button>` +
        `<span class="sw" style="${sw}"></span><span class="name">${esc(g.name)}</span><span class="count">${ms.length}</span>` +
        `<button class="rowx" data-delg="${esc(g.id)}" title="Delete the group and its layers" aria-label="Delete ${esc(g.name)}">${svg('close')}</button><button class="eye${seen ? '' : ' off'}" data-eyeg="${esc(g.id)}" title="Show or hide" aria-label="Show or hide ${esc(g.name)}">${svg('eye')}</button></div>`;
    };
    const rows = [], headed = new Set();
    for (const l of shown) {
      const g = l.groupId && groups.get(l.groupId);
      if (g && !headed.has(g.id)) { headed.add(g.id); rows.push(head(g, shown.filter((x) => x.groupId === g.id))); }
      if (!g || !g.collapsed) rows.push(one(l));
    }
    rows.push(`<div class="row${app.sel === 'base' ? ' sel' : ''}" data-layer="base"><span class="sw" style="background:${esc(d.baseColor)}"></span><span class="name">Base coat</span></div>`);
    return rows.join('');
  }
  const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
  // Across, or from the middle: which way the fade line runs. Shown with
  // whatever follows it: the paint's fade, or else the pattern's.
  const fadeWay = (l) => `<div class="seg"><button data-fade="linear" aria-pressed="${fadeStyleOf(l) === 'linear'}">Across</button><button data-fade="radial" aria-pressed="${fadeStyleOf(l) === 'radial'}">From the middle</button></div>`;
  const aimNote = '<div class="note">Drag the two dots on the shape to aim it</div>';
  // A shape's paint can fade to a second colour, or to nothing.
  // `l`: the shape whose settings show (the first, when several are selected).
  function fadeHtml(l) {
    const fading = l.fillType === 'linear' || l.fillType === 'radial';
    const out = fading && typeof l.color2 === 'string' && l.color2.length === 9 && l.color2.endsWith('00');
    return `<label class="switch">Fade<input id="f-fade" type="checkbox"${fading ? ' checked' : ''}></label>` + (!fading ? '' :
      fadeWay(l) +
      field('Fades to', `<span class="pair"><input id="f-fade-to" type="color" value="${esc(out ? '#ffffff' : hexOf(l.color2 || '') || '#ffffff')}"${out ? ' disabled' : ''} aria-label="The colour it fades to"><label class="inline"><input id="f-fade-out" type="checkbox"${out ? ' checked' : ''}>Nothing</label></span>`) +
      aimNote);
  }
  // A pattern over a shape's paint: what repeats, its own colour, and how.
  // `l`: the shape whose settings show (the first, when several are selected).
  function patternHtml(l) {
    const mo = l.motif, more = mo ? mo.more || [] : [];
    const col = mo ? esc(hexOf(mo.color || '') || hexOf(l.color || '') || '#ffffff') : '';
    const cols = mo ? mo.colors || [] : [];
    // one small tile for each shape, one swatch for each colour, each with a × to take it out (the last colour left stays)
    const out = (attr, k, what) => `<button type="button" class="mx" ${attr}="${k}" title="Take this ${what} out" aria-label="Take ${what} ${k + 2} out of the pattern">${svg('close')}</button>`;
    const tile = (sh, k) => `<span class="mwrap"><span class="mtile" title="${esc(sh.kind === 'own' ? sh.name : SHAPES[sh.kind])}">${sh.kind === 'own' ? shapeSvg(sh) : svg(sh.kind)}</span>${out('data-patdrop', k, 'shape')}</span>`;
    // Everything about a pattern folds away under one heading. Its shapes and
    // its colours are a row each: the copies take turns with them, or pick
    // between them when Random is on. The first shape added turns the pattern
    // on, and taking the last one out turns it off.
    const add = `<span class="plusbox" title="Add a shape to repeat. The first one turns the pattern on."><span class="icon" aria-hidden="true">+</span><select id="f-pat-add" aria-label="Add a shape to the pattern">${opt('', 'Add a shape…', true)}${motifOptions('', null)}</select></span>`;
    return `<details class="more fold" id="f-patfold"${patOpen ? ' open' : ''}><summary>Pattern</summary>` +
        `<div class="field tiles"><span>Shapes</span><span class="pair wrap">${mo ? tile(mo, -1) + more.map(tile).join('') : ''}${more.length < 6 ? add : ''}</span></div>` +
      (!mo ? '' :
        `<div class="field tiles"><span>Colours</span><span class="pair wrap"><span class="mwrap"><input class="mini" data-pat="pick" id="f-pat-color" type="color" value="${col}" title="The pattern's colour: click to change it" aria-label="Pattern colour">${cols.length ? out('data-patcdrop', -1, 'colour') : ''}</span>` +
          cols.map((c, k) => `<span class="mwrap"><input class="mini" data-patc="${k}" id="f-pat-c${k}" type="color" value="${esc(c)}" title="Click to change this colour" aria-label="Colour ${k + 2} of the pattern">${out('data-patcdrop', k, 'colour')}</span>`).join('') +
          (cols.length < 6 ? `<button type="button" class="icon" data-act="addPatternColour" title="Add another colour: they take turns, or mix when Random is on" aria-label="Add another colour to the pattern">+</button>` : '') +
          '</span></div>' +
        field('Size', slider('f-pat-size', 0, 1000, toSlider('size', mo.size), 'size')) +
        field('Spacing', slider('f-pat-gap', 0, 1000, toSlider('gap', mo.gap), 'gap')) +
        field('Stagger', slider('f-pat-stagger', 0, 100, Math.round(mo.stagger))) +
        field('Turn', slider('f-pat-turn', -180, 180, Math.round(mo.turn))) +
        `<label class="switch" title="Each copy differs a little. The roll is kept with the livery.">Random<input id="f-pat-random" type="checkbox"${mo.random ? ' checked' : ''}></label>` +
        (!mo.random ? '' : `<div class="nest">` +
          field('Size', slider('f-pat-rSize', 0, 100, Math.round(mo.rSize || 0))) +
          field('Position', slider('f-pat-rPos', 0, 100, Math.round(mo.rPos || 0))) +
          field('Turn', slider('f-pat-rTurn', 0, 100, Math.round(mo.rTurn || 0))) +
          `<div class="acts"><button class="btn" data-act="reshuffle" title="Roll again">Reshuffle</button></div>` +
        `</div>`) +
        `<label class="switch" title="The copies get fainter along the fade line, down to nothing">Fade out<input id="f-pat-fadeOut" type="checkbox"${mo.fadeOut ? ' checked' : ''}></label>` +
        `<label class="switch" title="The copies get smaller along the fade line, down to nothing">Shrink<input id="f-pat-shrink" type="checkbox"${mo.shrink ? ' checked' : ''}></label>` +
        // the line they follow is the paint's fade line; when the paint does not fade, its controls are here instead
        ((mo.fadeOut || mo.shrink) && !(l.fillType === 'linear' || l.fillType === 'radial') ? fadeWay(l) + aimNote : '') +
        `<label class="switch" title="Leave out the shape's own paint, so what is underneath shows between the pattern">Pattern only<input id="f-pat-only" type="checkbox"${mo.only ? ' checked' : ''}></label>`) +
      `</details>`;
  }
  // Repeat: the layer copied in a line or a grid, from where it is. `l`: the
  // layer whose settings show (the first, when several are selected).
  function repeatHtml(l) {
    const r = l.repeat, grid = r && r.way === 'grid';
    const across = r && r.way !== 'down', down = r && r.way !== 'across';
    return `<details class="more fold" id="f-repfold"${repOpen ? ' open' : ''}><summary>Repeat</summary>` +
      `<label class="switch" title="Copies of this layer in a line or a grid, starting from where it is. They follow every change to it.">Repeat<input id="f-rep-on" type="checkbox"${r ? ' checked' : ''}></label>` +
      (!r ? '' :
        field('Way', `<select id="f-rep-way">${[['across', 'Across'], ['down', 'Down'], ['grid', 'Grid']].map(([v, n]) => opt(v, n, v === r.way)).join('')}</select>`) +
        `<label class="switch" title="As many as reach the edge of the sheet. Trim it to keep them to a panel.">To the edge<input id="f-rep-fill" type="checkbox"${r.fill ? ' checked' : ''}></label>` +
        (r.fill ? '' : (across ? field(grid ? 'Across' : 'Copies', slider('f-rep-count', 1, 100, r.count)) : '') +
          (down ? field(grid ? 'Down' : 'Copies', slider('f-rep-rows', 1, 100, r.rows)) : '')) +
        (across ? field(grid ? 'Gap across' : 'Gap', slider('f-rep-gapX', -200, 400, r.gapX)) : '') +
        (down ? field(grid ? 'Gap down' : 'Gap', slider('f-rep-gapY', -200, 400, r.gapY)) : '') +
        field('Angle', slider('f-rep-angle', -180, 180, r.angle))) +
      `</details>`;
  }
  // what a pattern can repeat or a stamp place: the ready-made shapes, then
  // the library's. `current`: its key; `kept`: a pattern's own shape that has
  // since left the library, so the list can still name it.
  const motifOptions = (current, kept) => {
    const own = actions.ownShapes();
    const rounds = PLAIN_SHAPES.map(roundedOf).filter(Boolean);
    return PLAIN_SHAPES.map((k) => opt(k, SHAPES[k], k === current)).join('') +
      `<optgroup label="Rounded">${rounds.map((k) => opt(k, SHAPES[k].replace(/^Rounded /, '').replace(/^./, (ch) => ch.toUpperCase()), k === current)).join('')}</optgroup>` +
      (own.length || kept ? `<optgroup label="Your shapes">${own.map((it) => opt('own:' + it.id, it.name, 'own:' + it.id === current)).join('')}${kept && !own.some((it) => 'own:' + it.id === current) ? opt(current, kept, true) : ''}</optgroup>` : '');
  };
  // Colour lives in the Colour panel only. If that panel has been hidden, say
  // where it went, since nothing here sets a colour any more.
  const colourNote = () => (app.show.colour ? '' : '<div class="acts"><button class="btn" data-act="show:colour">Show the Colour panel</button></div>');
  function propsHtml() {
    if (app.sel === 'base') return colourNote() || '<div class="note">Its colour is in the Colour panel</div>';
    const many = actions.selectedLayers();
    if (many.length > 1) { // several: what can be done to them together
      const grouped = many.some((x) => x.groupId);
      const fills = many.filter((x) => x.type === 'fill' && !x.specOnly);
      return `<div class="note">${many.length} layers selected</div>` + colourNote() +
        (fills.length ? fadeHtml(fills.find((x) => x.fillType === 'linear' || x.fillType === 'radial') || fills[0]) + patternHtml(fills.find((x) => x.motif) || fills[0]) : '') +
        repeatHtml(many.find((x) => x.repeat) || many[0]) +
        `<label class="switch" title="Paint them on the twin panel too, or across the centreline (Ctrl+M)">Mirrored<input id="f-mirrored" type="checkbox"${many.some((x) => x.mirrored) ? ' checked' : ''}></label>` +
        `<div class="acts"><button class="btn" data-act="merge" title="Join them into one. It asks first if they differ in colour or kind. (Ctrl+E)">Merge</button>` +
        (shapeCan().wrap ? '<button class="btn" data-act="wrap" title="One shape pulled tight round them, like a rubber band: two circles become a slot">Wrap</button>' : '') +
        `<button class="btn" data-act="${grouped ? 'ungroup' : 'group'}" title="${grouped ? 'They stop being picked up together (Ctrl+Shift+G)' : 'Pick them up together from now on (Ctrl+G)'}">${grouped ? 'Ungroup' : 'Group'}</button></div>`;
    }
    const l = app.doc.layers.find((x) => x.id === app.sel);
    if (!l) return '<div class="note">Nothing selected</div>';
    const colour = l.type === 'fill' || l.type === 'text' || l.type === 'image' ? colourNote() : '';
    const isText = l.type === 'text', isPic = isText || l.type === 'image';
    const fx = l.fx || {};
    const fonts = [...new Set([...TEXT_FONTS, ...GOOGLE_FONTS, ...(app.doc.googleFonts || []), ...(app.doc.customFonts || []).map((f) => f.name)])];
    // what you reach for first, then the switch and buttons, then the rest folded away
    // a shape's fill can fade to a second colour, or to nothing
    const pattern = l.type !== 'fill' || l.specOnly ? '' : patternHtml(l);
    const fade = l.type !== 'fill' ? '' : fadeHtml(l);
    const weights = isText ? actions.fontWeights(l.font) : [];
    const weight = weights.length < 2 ? '' : field('Weight', `<select id="f-fontWeight">${weights.map((w) => opt(w, WEIGHT_NAMES[w], w === (l.fontWeight || 400))).join('')}</select>`);
    const lined = isText && String(l.text || '').includes('\n'); // settings that only mean something with several lines
    const main = !isText ? colour + fade + pattern :
      field('Text', `<textarea id="f-text" rows="2" spellcheck="false" title="Enter starts a new line">${esc(l.text)}</textarea>`) +
      field('Font', `<select id="f-font">${fonts.map((f) => opt(f, f, f === l.font)).join('')}${opt('__google', 'Google font by name…', false)}${opt('__upload', 'Upload a font file…', false)}</select>`) +
      weight +
      colour +
      field('Size', slider('f-fontSize', 40, 400, l.fontSize || 160));
    const inPieces = Array.isArray(l.pts) && l.pts.some((q) => q.m);
    const acts = l.locked ? '' :
      `<label class="switch" title="Paint it on the twin panel too, or across the centreline (Ctrl+M)">Mirrored<input id="f-mirrored" type="checkbox"${l.mirrored ? ' checked' : ''}></label>` +
      (l.mirrored && isPic ? `<label class="switch" title="Off: it reads the right way round on both sides. On: a true mirror image.">Reverse the other side<input id="f-mirrorFlip" type="checkbox"${l.mirrorFlip ? ' checked' : ''}></label>` : '') +
      `<div class="acts">${trimButtons(l)}${l.mirrored ? '<button class="btn" data-act="separate" title="Make the mirrored side a layer of its own">Separate</button>' : ''}${inPieces ? '<button class="btn" data-act="split" title="Undo a merge: one shape for each piece again">Split</button>' : ''}${inPieces && hasInner(l.pts) ? '<button class="btn" data-act="fillIn" title="Make it solid: its holes are filled">Fill in</button>' : ''}${l.type === 'image' ? '<button class="btn" data-act="makeShapes" title="For a flat-colour picture such as a logo: one shape for each colour in it, with the background left out. Each shape then takes a colour like any other.">Make shapes</button>' : ''}${isText ? '<button class="btn" data-act="makeShapes" title="The lettering becomes a shape, so it can fade, take a pattern and be reshaped. It can no longer be retyped.">Make shapes</button>' : ''}${l.type === 'image' && l.color ? '<button class="btn" data-act="ownColours" title="Take the colour off again">Original colours</button>' : ''}</div>`;
    const more = (!isText ? '' :
      field('Outline', `<span class="pair">${slider('f-outlineWidth', 0, 30, l.outlineWidth || 0)}<input id="f-outlineColor" type="color" value="${esc(hexOf(l.outlineColor || '') || '#000000')}" aria-label="Outline colour"></span>`) +
      field('Spacing', slider('f-letterSpacing', 0, 40, l.letterSpacing || 0)) +
      field('Curve', slider('f-curve', -180, 180, l.curve || 0)) +
      (!lined ? '' : field('Line spacing', slider('f-lineSpacing', 60, 300, l.lineSpacing || 120)) +
        field('Lines', `<select id="f-align">${[['left', 'Left'], ['center', 'Centred'], ['right', 'Right']].map(([v, n]) => opt(v, n, v === (l.align || 'center'))).join('')}</select>`)) +
      `<label class="switch">Italic<input id="f-italic" type="checkbox"${l.italic ? ' checked' : ''}></label>`) +
      (!isPic ? '' :
      field('Turn', slider('f-rotation', -180, 180, Math.round(l.rotation || 0))) +
      field('Shadow', `<span class="pair">${slider('f-fx-shadow', 0, 60, fx.shadow || 0)}<input id="f-fx-shadowColor" type="color" value="${esc(hexOf(fx.shadowColor || '') || '#000000')}" aria-label="Shadow colour"></span>`) +
      field('Shadow at', `<span class="pair">${slider('f-fx-shadowDX', -60, 60, fx.shadowDX ?? 8)}${slider('f-fx-shadowDY', -60, 60, fx.shadowDY ?? 8)}</span>`)) +
      field('Opacity', slider('f-opacity', 0, 100, (l.opacity ?? 1) * 100)) +
      field('Blend', `<select id="f-blend" title="Multiply darkens what is under it, for a texture such as worn cardboard">${opt('', 'Normal', !l.blend)}${opt('multiply', 'Multiply', l.blend === 'multiply')}</select>`) +
      field('Name', `<input id="f-name" type="text" value="${esc(l.name)}">`);
    return main + (l.specOnly ? '' : repeatHtml(l)) + acts + `<details class="more" id="f-more"${moreOpen ? ' open' : ''}><summary>More</summary>${more}</details>`;
  }
  let moreOpen = false; // stays as the user left it while the panel is redrawn
  let repOpen = true;   // the same for Repeat's
  let patOpen = true;   // the same for a pattern's settings; they open when a pattern is put on or added to
  const trimCount = (l) => (Array.isArray(l.clip) ? (Array.isArray(l.clip[0]) ? l.clip.length : 1) : 0);
  function trimButtons(l) {
    const n = trimCount(l);
    return `<button class="btn${app.trimming ? ' main' : ''}" data-act="trim" title="Choose the panels it shows in">${app.trimming ? 'Done' : n ? `Trimmed to ${n}` : 'Trim to panels'}</button>` +
      (n ? '<button class="btn" data-act="trimClear" title="Show it everywhere again">Clear trim</button>' : '');
  }
  // ---------- Finish mode's two panels ----------
  // what has a finish of its own; everything else is gloss
  function finishesHtml() {
    const t = app.ftarget;
    const rows = finishList(app.doc).map((f) => {
      const key = f.kind === 'colour' ? f.colour : f.id;
      const on = t && t.kind === f.kind && (f.kind === 'colour' ? t.colour === f.colour : t.id === f.id);
      const layer = f.kind === 'colour' ? null : app.doc.layers.find((l) => l.id === f.id);
      const sw = f.kind === 'colour' ? `background:${esc(f.colour)}` : f.kind === 'area' ? 'background:var(--accent-soft);border-style:dashed' : swatch(layer);
      const what = f.kind === 'colour' ? finishLabel(f.material, f.params) : `${esc(f.name)} · ${finishLabel(f.material, f.params)}`;
      // already the default: nothing to put back
      const plain = f.material === 'gloss' && !f.params;
      const reset = plain ? '' : `<button class="eye" data-findef="${f.kind}:${esc(key)}" title="Back to Gloss, the default" aria-label="Reset this finish to Gloss">${svg('reset')}</button>`;
      return `<div class="row${on ? ' sel' : ''}" data-fin="${f.kind}:${esc(key)}"><span class="sw" style="${sw}"></span><span class="name">${what}</span>${reset}</div>`;
    });
    return rows.join('');
  }
  // the colour the preview is shown in: the target's own, or neutral grey
  // for an area (it paints nothing) or a picture
  function targetColour() {
    const t = app.ftarget;
    if (!t) return '#9aa0ab';
    if (t.kind === 'colour') return t.colour;
    const layer = app.doc.layers.find((l) => l.id === t.id);
    return (t.kind === 'layer' && layer && layerColour(layer)) || '#9aa0ab';
  }
  // the preview and the finish's name, redrawn in place while a slider moves
  function drawTile() {
    const c = $('f-tile'), now = c && actions.finishNow();
    if (!now) return;
    try { renderTile(c, now.material, now.params, targetColour()); } catch { c.hidden = true; }
    const name = $('f-label');
    if (name) name.textContent = finishLabel(now.material, now.params);
  }
  function finishHtml() {
    const t = app.ftarget, d = app.doc;
    if (!t) return '<div class="note">Click a colour or a layer on the sheet</div>';
    const layer = t.kind === 'colour' ? null : d.layers.find((l) => l.id === t.id);
    const now = actions.finishNow() || { material: 'gloss', params: null };
    const f = readFinish(now.material, now.params), preset = presetOf(f);
    const label = t.kind === 'colour' ? `<span class="dot" style="background:${esc(t.colour)}"></span>Everything this colour` : t.kind === 'area' ? esc(layer ? layer.name : 'Area') : `Just ${esc(layer ? layer.name : 'this layer')}`;
    // a shape or text can be finished with its whole colour, or by itself
    const canScope = (t.kind === 'colour' && t.layerId) || (t.kind === 'layer' && layer && layerColour(layer));
    const scope = !canScope ? '' : `<div class="seg"><button data-scope="colour" aria-pressed="${t.kind === 'colour'}">All this colour</button><button data-scope="layer" aria-pressed="${t.kind === 'layer'}">Just this layer</button></div>`;
    // the finish of anything else in the livery, taken over whole: no numbers to match by eye
    const others = finishList(d).filter((o) => !(o.kind === t.kind && (o.kind === 'colour' ? o.colour === t.colour : o.id === t.id)));
    const same = !others.length ? '' : field('Same as', `<select id="fn-same" title="Take the finish another colour or layer has, exactly">${opt('', 'Choose…', true)}${others.map((o) =>
      opt(`${o.kind}:${o.kind === 'colour' ? o.colour : o.id}`, `${o.kind === 'colour' ? o.colour.toUpperCase() : o.name} · ${finishLabel(o.material, o.params)}`, false)).join('')}</select>`);
    return '<canvas id="f-tile" class="ftile" width="472" height="176" aria-hidden="true"></canvas>' +
      `<div class="ftarget">${label}<b id="f-label"></b></div>` + scope +
      `<div class="finishes">${FINISHES.map((k) => `<button data-finish="${k}" aria-pressed="${k === preset}">${finishName(k)}</button>`).join('')}</div>` +
      same +
      field('Metallic', slider('fn-met', 0, 255, f.met)) + field('Roughness', slider('fn-rough', 0, 255, f.rough)) + field('Clearcoat', slider('fn-clear', 0, 255, f.clear)) +
      (preset ? '' : '<div class="acts"><button class="btn" data-act="resetFinish" title="Put the three sliders back">Reset</button></div>') +
      `<label class="switch" title="Specks or chips that catch the light, over this finish">Sparkle<input id="fn-sparkle" type="checkbox"${f.sparkle ? ' checked' : ''}></label>` +
      (!f.sparkle ? '' : field('Amount', slider('fn-amount', 1, 60, f.sparkle.amount)) + field('Size', slider('fn-size', 1, 12, f.sparkle.size)) + field('Strength', slider('fn-strength', 0, 100, f.sparkle.strength)) + `<label class="field" title="Each fleck also lightens the paint under it, so it shows bright even when it has nothing to mirror"><span>Brightness</span>${slider('fn-bright', 0, 100, f.sparkle.bright)}</label>`) +
      (t.kind === 'area' && layer ? `<label class="switch" title="The same area on the twin panel too, or across the centreline">Mirrored<input id="f-mirrored" type="checkbox"${layer.mirrored ? ' checked' : ''}></label>` : '');
  }

  // ---------- Map mode's two panels ----------
  const opt = (v, label, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  function piecesHtml() {
    const list = pieces(app.doc.regionMap);
    if (!list.length) return '<div class="note">Load a template to get a map</div>';
    return list.map((r, i) => `<div class="row${r.id === app.piece ? ' sel' : ''}" data-piece="${esc(r.id)}"><span class="sw" style="background:${hue(i)}"></span><span class="name">${esc(r.name)}</span><span class="tags">${r.mirror ? '<i title="Has a twin">⇄</i>' : ''}${r.center ? '<i title="Has a centreline">┆</i>' : ''}</span></div>`).join('');
  }
  function pieceHtml() {
    const m = app.doc.regionMap, list = pieces(m);
    if (!list.length) return '<div class="note">Load a template to get a map</div>';
    const r = list.find((x) => x.id === app.piece);
    const top = !r ? '<div class="note">Click a panel</div>'
      : field('Name', `<input id="m-name" type="text" value="${esc(r.name)}">`) +
        field('Twin', `<select id="m-pair">${opt('', 'None', !r.mirror)}${list.filter((x) => x !== r).map((x) => opt(x.id, x.name, x.id === r.mirror)).join('')}</select>`) +
        `<div class="acts">${r.center ? '<button class="btn" data-act="centreRemove">Remove centreline</button>' : '<button class="btn" data-act="centreStart" title="Two matching corners, one each side">Set centreline</button>'}</div>`;
    return top + '<hr class="rule">' +
      `<label class="switch">Panel colours<input id="m-colours" type="checkbox"${app.mapShow.colours ? ' checked' : ''}></label>` +
      `<label class="switch" title="Paints the panel colours and names onto the car, so you can see which panel is which in the sim">Show on car<input id="m-guide" type="checkbox"${actions.guideOn() ? ' checked' : ''}></label>` +
      '<div class="acts"><button class="btn" data-act="pickMapFile">Load map…</button><button class="btn" data-act="saveMap">Save map…</button></div>';
  }
  // colours in use, most used first
  function usedColours() {
    const n = new Map();
    const add = (c) => { const h = hexOf(c || ''); if (h) n.set(h, (n.get(h) || 0) + 1); };
    add(app.doc.baseColor);
    for (const l of withPatterns(app.doc).layers) if (l.visible) add(layerColour(l));
    // in the order they sit in the livery (base coat, then back to front), so
    // a swatch does not jump about when a colour is used more or less
    return [...n.keys()].slice(0, 14);
  }
  function colourHtml() {
    const d = app.doc, cur = actions.currentColour(), sel = actions.selected();
    const linked = app.sel === 'base' ? d.baseRef : sel ? sel.colorRef : null;
    const saved = d.palette.map((c) => `<span class="chipwrap"><button class="chip${c.id === linked ? ' on' : ''}" data-pal="${esc(c.id)}"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</button><button class="chipedit" data-edit="${esc(c.id)}" title="Rename or change" aria-label="Edit ${esc(c.name)}">${svg('edit')}</button></span>`).join('');
    const used = usedColours();
    return `<div class="sub">Saved with this livery</div><div class="chips">${saved}<button class="chip add" data-act="saveColour" title="Save the current colour">+ Save</button></div>` +
      (used.length ? `<div class="sub">In this livery</div><div class="dots">${used.map((c) => `<button class="dot" data-col="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="${c}"></button>`).join('')}</div>` : '') +
      `<div class="cur"><input data-colour="pick" id="c-pick" type="color" value="${esc(cur)}" title="Choose a colour" aria-label="Colour"></div>`;
  }
  function drawPanels() {
    const inMap = app.mode === 'map', inFinish = app.mode === 'finish';
    panels.layers.querySelector('h2').textContent = inMap ? 'Panels' : inFinish ? 'Finishes' : 'Layers';
    panels.props.querySelector('h2').textContent = inMap ? 'Panel' : inFinish ? 'Finish' : 'Properties';
    panels.colour.querySelector('h2').textContent = 'Colour';
    panels.layers.querySelector('.body').innerHTML = inMap ? piecesHtml() : inFinish ? finishesHtml() : layersHtml();
    panels.props.querySelector('.body').innerHTML = inMap ? pieceHtml() : inFinish ? finishHtml() : propsHtml();
    panels.colour.querySelector('.body').innerHTML = colourHtml();
    drawTile();
    const cur = panels.layers.querySelector('.row.sel');
    if (inMap && cur) cur.scrollIntoView({ block: 'nearest' });
  }
  const refreshChrome = () => drawChrome();
  const refresh = () => { drawChrome(); drawPanels(); };

  // A slider and the box beside it are one control. A value typed in the box
  // moves the slider and is announced as the slider's own change, so nothing
  // else needs to know about the box; a dragged slider fills the box in.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains('nbox')) {
      const s = $(t.dataset.for), v = Math.max(+t.min, Math.min(+t.max, +t.value));
      if (!s || t.value === '' || !Number.isFinite(v)) return; // half-typed
      if (t.dataset.curve) { s.value = toSlider(t.dataset.curve, v); s.dataset.exact = v; } else s.value = v;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (t.type === 'range' && e.isTrusted) {
      const box = t.parentNode.querySelector('.nbox');
      delete t.dataset.exact;
      if (box) box.value = box.dataset.curve ? fromSlider(box.dataset.curve, +t.value) : t.value;
    }
  }, true);
  // A box that is done with says so as its slider's 'change'. That waits until
  // the boxes are left altogether: some panels are rebuilt on it, which would
  // take the next box from under a click that goes straight from one to another.
  const isBox = (el) => !!(el && el.classList && el.classList.contains('nbox'));
  let owed = null;
  const settleBoxes = () => {
    if (isBox(document.activeElement) || !owed) return;
    const s = owed; owed = null;
    if (s.isConnected) s.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.addEventListener('change', (e) => {
    const t = e.target, s = isBox(t) && $(t.dataset.for);
    if (!s) return;
    t.value = t.dataset.curve ? (s.dataset.exact ?? fromSlider(t.dataset.curve, +s.value)) : s.value; // what it came to, held within its range
    owed = s;
    setTimeout(settleBoxes, 0);
  }, true);
  document.addEventListener('focusout', (e) => { if (isBox(e.target)) setTimeout(settleBoxes, 0); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && isBox(e.target)) { e.preventDefault(); e.target.blur(); } }, true); // Enter: done with the box

  // controls inside Properties: these must not rebuild the panel they sit in
  // the Colour panel's colour box
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.colour) return;
    const v = t.value;
    const sw = panels.layers.querySelector(`[data-layer="${CSS.escape(String(app.sel))}"] .sw`);
    if (sw && (app.sel === 'base' || (actions.selected() || {}).type === 'fill')) sw.style.background = v;
    actions.setColour(v);
    // a picture's first colour: Properties gains "Original colours" (the colour boxes are left alone, one is in use)
    if (app.mode === 'paint' && (actions.selected() || {}).type === 'image' && !panels.props.querySelector('[data-act="ownColours"]')) panels.props.querySelector('.body').innerHTML = propsHtml();
  });
  panels.props.addEventListener('input', (e) => {
    const t = e.target;
    const layer = app.doc.layers.find((x) => x.id === app.sel);
    // Finish mode's sliders: the finish's numbers; the preview follows in place
    const fn = /^fn-(met|rough|clear|amount|size|strength|bright)$/.exec(t.id || '');
    if (fn) { actions.tweakFinish(fn[1], +t.value); drawTile(); return; }
    if (t.id === 'f-fade-to') { actions.setFade('to', t.value); return; }
    if (t.dataset.pat) { actions.tweakMotif('color', t.value); return; } // the pattern's colour
    if (t.dataset.patc !== undefined) { actions.patternColour(+t.dataset.patc, t.value); return; }
    const pat = /^f-pat-(size|gap|stagger|turn|rSize|rPos|rTurn)$/.exec(t.id || '');
    if (pat) { actions.tweakMotif(pat[1], t.dataset.exact !== undefined ? +t.dataset.exact : CURVED[pat[1]] ? fromSlider(pat[1], +t.value) : +t.value); return; }
    const rep = /^f-rep-(count|rows|gapX|gapY|angle)$/.exec(t.id || '');
    if (rep) { actions.setRepeat({ [rep[1]]: +t.value }, false); return; }
    // plain settings: the control's id names the layer setting it sets
    const m = /^f-(fx-)?(fontSize|outlineWidth|outlineColor|letterSpacing|lineSpacing|curve|rotation|shadow|shadowColor|shadowDX|shadowDY|text)$/.exec(t.id || '');
    if (m && layer) {
      const v = t.type === 'range' ? +t.value : t.value;
      actions.setProp((m[1] ? 'fx.' : '') + m[2], v);
      if (m[2] === 'text') { const nm = $('f-name'); if (nm) nm.value = layer.name; const row = panels.layers.querySelector(`[data-layer="${CSS.escape(layer.id)}"] .name`); if (row) row.textContent = layer.name; }
      return;
    }
    if (t.id === 'f-opacity' && layer) {
      layer.opacity = t.value / 100;
      actions.change({ panels: false });
    }
  });
  $('toolopts').addEventListener('input', (e) => {
    if (e.target.id === 'f-stamp-size') { $('f-stamp-n').textContent = e.target.value; actions.setStamp({ size: +e.target.value }); return; }
    if (e.target.id === 'f-stamp') { actions.setStamp({ key: e.target.value }); return; }
    if (e.target.id !== 'f-band') return;
    $('f-band-n').textContent = e.target.value;
    actions.setBandWidth(+e.target.value);
  });
  // Layers list: drag a row up or down to change what is in front of what.
  // The top of the list is the front of the sheet.
  let dragId = null;
  let dragWhole = false; // the row being dragged is a group's own: all its layers move
  const dropMark = (row, cls) => { for (const r of panels.layers.querySelectorAll('.drop-above, .drop-below')) r.classList.remove('drop-above', 'drop-below'); if (row && cls) row.classList.add(cls); };
  const dropSpot = (e) => {
    const row = e.target.closest('.row[data-layer]');
    if (!row || !dragId || row.dataset.layer === dragId) return null;
    const box = row.getBoundingClientRect(), base = row.dataset.layer === 'base';
    return { row, above: base || e.clientY < box.top + box.height / 2 }; // nothing goes behind the base coat
  };
  panels.layers.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row[data-layer][draggable]');
    if (!row || app.mode === 'map') { e.preventDefault(); return; }
    dragId = row.dataset.layer; dragWhole = !!row.dataset.group;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  panels.layers.addEventListener('dragover', (e) => {
    const spot = dropSpot(e);
    if (!spot) { dropMark(null); return; }
    e.preventDefault();
    dropMark(spot.row, spot.above ? 'drop-above' : 'drop-below');
  });
  panels.layers.addEventListener('drop', (e) => {
    const spot = dropSpot(e);
    dropMark(null);
    if (!spot) return;
    e.preventDefault();
    // above a row in the list = in front of that layer on the sheet
    // (a group's own row stands for all its layers: they go together, and what is dropped below it lands behind its last one)
    actions.reorder(dragId, spot.above ? spot.row.dataset.layer : spot.row.dataset.last || spot.row.dataset.layer, spot.above, dragWhole);
  });
  // A name in the list is renamed by a double click, or by a click on it once
  // it is already the one selected (as file lists do). The first click selects,
  // which redraws the list, so the browser's own dblclick never arrives (its
  // target is gone): two clicks on the same name, close together, are counted here.
  let nameClick = { key: null, at: 0 };
  panels.layers.addEventListener('click', (e) => {
    const row = e.target.closest('.row[data-layer]');
    if (!row || row.dataset.layer === 'base' || !e.target.closest('.name') || e.shiftKey || e.ctrlKey || e.metaKey || app.mode !== 'paint') return;
    const gid = row.dataset.group, key = gid || row.dataset.layer, sel = actions.selectedLayers();
    const twice = nameClick.key === key && performance.now() - nameClick.at < 450;
    const already = gid ? row.classList.contains('sel') && sel.every((l) => l.groupId === gid) : sel.length === 1 && sel[0].id === key;
    nameClick = twice ? { key: null, at: 0 } : { key, at: performance.now() };
    if (!twice && !already) return;
    e.stopPropagation(); // it is already selected: nothing else to do with this click
    nameClick = { key: null, at: 0 };
    gid ? actions.renameGroup(gid) : actions.renameLayer(key);
  }, true);
  panels.layers.addEventListener('dragend', () => { dragId = null; dropMark(null); });

  // Every colour box opens the app's own colour pop-up (see picker.js), which
  // has the livery's colours in it; the browser's own is never shown.
  const picker = initPicker({
    colours: () => ({ saved: app.doc.palette.map((c) => ({ name: c.name, color: hexOf(c.color) })).filter((c) => c.color), used: usedColours() }),
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'color' || !t.id) return;
    e.preventDefault();
    picker.open(t);
  }, true);

  // a saved colour is renamed, changed or deleted from its chip
  const editChip = (e) => {
    const chip = e.target.closest('.chipwrap');
    if (!chip) return;
    e.preventDefault();
    actions.editColour(chip.querySelector('[data-pal]').dataset.pal);
  };
  panels.colour.addEventListener('contextmenu', editChip);
  panels.colour.addEventListener('dblclick', editChip);
  panels.props.addEventListener('toggle', (e) => { if (e.target.id === 'f-more') moreOpen = e.target.open; if (e.target.id === 'f-patfold') patOpen = e.target.open; if (e.target.id === 'f-repfold') repOpen = e.target.open; }, true);
  panels.props.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'fn-sparkle') return actions.tweakFinish('sparkle', e.target.checked);
    if (id === 'fn-same') { if (e.target.value) actions.copyFinish(e.target.value); return; }
    if (/^fn-/.test(id)) return refresh(); // a slider let go: Reset comes or goes, the list's name updates
    if (id === 'f-mirrored') return actions.mirror();
    if (id === 'f-font') return actions.setFont(e.target.value);
    if (id === 'f-fontWeight') { actions.setProp('fontWeight', +e.target.value === 400 ? null : +e.target.value); return; }
    if (id === 'f-align') { actions.setProp('align', e.target.value === 'center' ? null : e.target.value); return; }
    if (id === 'f-fade') return actions.setFade('on', e.target.checked);
    if (id === 'f-rep-on') return actions.setRepeat(e.target.checked ? {} : null);
    if (id === 'f-rep-way') return actions.setRepeat({ way: e.target.value });
    if (id === 'f-rep-fill') return actions.setRepeat({ fill: e.target.checked });
    if (id === 'f-pat-add') { if (e.target.value) actions.addMotifShape(e.target.value); return; }
    if (id === 'f-pat-only') return actions.tweakMotif('only', e.target.checked);
    if (id === 'f-pat-random') return actions.motifRandom(e.target.checked);
    if (id === 'f-pat-fadeOut') return actions.motifFade('fadeOut', e.target.checked);
    if (id === 'f-pat-shrink') return actions.motifFade('shrink', e.target.checked);
    if (e.target.dataset.pat) return; // nothing is redrawn: that would swallow the click that took the focus away
    if (id === 'f-fade-out') return actions.setFade('out', e.target.checked);
    if (id === 'f-italic') { actions.setProp('italic', e.target.checked); return; }
    if (id === 'f-mirrorFlip') { actions.setProp('mirrorFlip', e.target.checked); return; }
    if (id === 'f-blend') { actions.setProp('blend', e.target.value || null); return; }
    if (id === 'm-name') return actions.mapRename(e.target.value.trim());
    if (id === 'm-pair') return actions.mapPair(e.target.value);
    if (id === 'm-colours') return actions.toggleMapColours();
    if (id === 'm-guide') return actions.toggleGuide();
    const layer = app.doc.layers.find((x) => x.id === app.sel);
    if (e.target.id === 'f-name' && layer && e.target.value.trim()) { layer.name = e.target.value.trim(); actions.change(); }
  });

  // ---------- toast ----------
  let toastTimer = null;
  function say(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6500 : 3200);
  }

  // ---------- dialogs ----------
  const dlg = $('dlg');
  $('dlg-cancel').addEventListener('click', () => dlg.close('cancel'));
  // body: trusted markup built here (callers escape anything a user typed)
  function ask({ title, body = '', ok = 'OK', cancel = 'Cancel' }) {
    return new Promise((resolve) => {
      $('dlg-title').textContent = title;
      $('dlg-body').innerHTML = body && !body.includes('<') ? `<div class="note">${body}</div>` : body;
      $('dlg-ok').hidden = ok === null;
      $('dlg-ok').textContent = ok || '';
      $('dlg-cancel').hidden = cancel === null;
      $('dlg-cancel').textContent = cancel || '';
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.showModal();
    });
  }
  async function askText({ title, label, value = '', ok = 'OK' }) {
    const p = ask({ title, ok, body: `<label><span>${esc(label)}</span><input id="dlg-text" type="text" value="${esc(value)}"></label>` });
    $('dlg-text').select();
    return (await p) ? $('dlg-text').value.trim() || null : null;
  }
  const ago = (ts) => {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  };
  async function pickProject(list) {
    let picked = null;
    const body = list.length
      ? `<div class="plist">${list.map((p) => `<button type="button" data-id="${esc(p.id)}">${p.thumb ? `<img alt="" src="${esc(p.thumb)}">` : ''}<span><b>${esc(p.name || 'untitled')}</b><small>${p.updatedAt ? ago(p.updatedAt) : ''}</small></span></button>`).join('')}</div>`
      : '<div class="note">No saved projects yet.</div>';
    const p = ask({ title: 'Open a project', body, ok: null });
    $('dlg-body').onclick = (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) { picked = b.dataset.id; dlg.close('ok'); }
    };
    await p;
    $('dlg-body').onclick = null;
    return picked;
  }
  async function carSetup(cur) {
    const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
    const body =
      `<label><span>Customer number</span><input id="cs-id" type="text" inputmode="numeric" placeholder="e.g. 123456" value="${esc(cur.custid)}"></label>` +
      `<label><span>Painting a</span><select id="cs-target">${opt('car', 'Car', cur.target === 'car')}${opt('helmet', 'Helmet', cur.target === 'helmet')}${opt('suit', 'Suit', cur.target === 'suit')}</select></label>` +
      `<label class="check"><input id="cs-num" type="checkbox"${cur.customNumber ? ' checked' : ''}><span>Custom number paint</span></label>` +
      (cur.cars.length ? `<label><span>Car folder</span><select id="cs-car">${opt('', 'Choose…', !cur.cars.includes(cur.car))}` +
        (cur.near.length ? `<optgroup label="Closest to this livery's name">${cur.near.map((c) => opt(c, c, false)).join('')}</optgroup><optgroup label="All">` : '') +
        cur.cars.map((c) => opt(c, c, c === cur.car)).join('') + (cur.near.length ? '</optgroup>' : '') + '</select></label>' : '') +
      `<div class="note">${!cur.folder ? 'No iRacing paints folder linked yet.' : cur.cars.length ? 'Folder linked: ' + esc(cur.folder) : `No car folders found in ${esc(cur.folder)}. Link the iRacing paints folder itself.`}</div>`;
    if (!await ask({ title: 'Car setup', body, ok: 'Save' })) return null;
    return { custid: $('cs-id').value, target: $('cs-target').value, customNumber: $('cs-num').checked, car: $('cs-car') ? $('cs-car').value : null };
  }
  async function editColour(c) {
    let del = false;
    const p = ask({
      title: 'Saved colour', ok: 'Save',
      body: `<label><span>Name</span><input id="ec-name" type="text" value="${esc(c.name)}"></label>` +
        `<label><span>Colour</span><span class="pair"><input id="ec-pick" type="color" value="${esc(c.color)}"><input id="ec-hex" class="mono" type="text" maxlength="7" spellcheck="false" value="${esc(c.color)}"></span></label>` +
        '<div><button type="button" class="btn" id="ec-del">Delete this colour</button></div>',
    });
    $('ec-pick').oninput = () => { $('ec-hex').value = $('ec-pick').value; };
    $('ec-hex').oninput = () => { const v = hexOf($('ec-hex').value); if (v) $('ec-pick').value = v; };
    $('ec-del').onclick = () => { del = true; dlg.close('ok'); };
    if (!await p) return null;
    return del ? 'delete' : { name: $('ec-name').value.trim(), color: $('ec-pick').value };
  }
  // ---------- the library ----------
  // → { kind: 'logos' | 'graphics' | 'shapes' | 'file', item } or null
  // The library: my own pictures, my own shapes, and a search of the open icon
  // sets, whose finds come in as shapes. search(query) → the finds;
  // fetchIcon(find) → the shape made from one.
  // shapesOnly: pictures are left out (a shape is being drawn, and only shapes can join it)
  async function library(lib, { remove, search, fetchIcon, shapesOnly = false }) {
    let tab = shapesOnly ? (lib.shapes.length ? 'shapes' : 'search') : lib.logos.length ? 'logos' : lib.shapes.length ? 'shapes' : 'search', picked = null;
    let query = '', found = null, state = ''; // found: the last search's finds; state: '' | 'busy' | a message
    const tile = (kind, it, art, own) => `<span class="tilewrap"><button type="button" class="tile" data-lib="${kind}:${esc(it.id)}" title="${esc(it.name)}">${art}<span>${esc(it.name)}</span></button>${own ? `<button type="button" class="tilex" data-libx="${kind}:${esc(it.id)}" title="Remove from the library" aria-label="Remove ${esc(it.name)}">${svg('close')}</button>` : ''}</span>`;
    const results = () => (state === 'busy' ? '<div class="note">Searching…</div>'
      : state ? `<div class="note">${esc(state)}</div>`
      : !found ? '<div class="note">Type a word and press Enter: flame, wing, skull, wrench…</div>'
      : !found.length ? '<div class="note">Nothing found for that. Try another word.</div>'
      : `<div class="tiles">${found.map((it, k) => `<span class="tilewrap"><button type="button" class="tile" data-icon="${k}" title="${esc(it.name)} · ${esc(it.set)}${it.licence ? ' · ' + esc(it.licence) : ''}"><img alt="" loading="lazy" src="${esc(it.preview)}"><span>${esc(it.name)}</span></button></span>`).join('')}</div>`);
    const draw = () => {
      const sets = shapesOnly ? [] : lib.sets || []; // several layers saved as one: not something a shape can be drawn from
      const tabs = [['logos', `Your pictures${lib.logos.length ? ' · ' + lib.logos.length : ''}`], ['shapes', `Your shapes${lib.shapes.length + sets.length ? ' · ' + (lib.shapes.length + sets.length) : ''}`], ['search', 'Search icons']].filter(([k]) => !shapesOnly || k !== 'logos');
      const side = tab === 'logos' ? '<button type="button" class="btn" data-lib="file:" style="margin-left:auto">Picture from a file…</button>'
        : tab === 'shapes' ? (shapesOnly ? '' : '<button type="button" class="btn main" data-lib="draw:" style="margin-left:auto" title="A blank page and the drawing tools: what you draw is saved here as one shape">Draw a shape</button>') +
          `<button type="button" class="btn" data-lib="shapefile:"${shapesOnly ? ' style="margin-left:auto"' : ''} title="What the file fills becomes a shape: it takes a colour and works as a pattern or a stamp">Shape from an SVG file…</button>` : '';
      const grid = tab === 'logos' ? lib.logos.map((it) => tile('logos', it, `<img alt="" src="${esc(it.src)}">`, true)).join('')
        : sets.map((it) => tile('sets', it, `<img alt="" src="${esc(it.thumb)}">`, true)).join('') + lib.shapes.map((it) => tile('shapes', it, shapeSvg(it), true)).join('');
      const empty = tab === 'logos' ? 'Pictures you bring in are kept here.' : 'Shapes you save, search for or bring in from a file are kept here. Select several layers and use Edit › Save to library to keep them as one.';
      $('dlg-body').innerHTML = `<div class="tabs">${tabs.map(([k, name]) => `<button type="button" data-libtab="${k}" aria-pressed="${k === tab}">${name}</button>`).join('')}${side}</div>` +
        (tab === 'search'
          ? `<input id="lib-q" type="text" placeholder="Search icons" value="${esc(query)}" spellcheck="false" autocomplete="off" aria-label="Search icons"><div id="lib-found">${results()}</div>` +
            '<div class="note small">They come in as shapes. From Game Icons (credit kept with the livery), Material Symbols, Material Design Icons and Bootstrap Icons.</div>'
          : grid ? `<div class="tiles">${grid}</div>` : `<div class="note">${empty}</div>`);
      if (tab === 'search') $('lib-q').focus();
    };
    const run = async () => {
      query = $('lib-q').value.trim();
      if (!query) return;
      state = 'busy'; $('lib-found').innerHTML = results();
      const asked = query;
      try { found = await search(query); state = ''; }
      catch { found = null; state = 'The search could not be reached. It needs an internet connection.'; }
      if (asked === query && tab === 'search' && $('lib-found')) $('lib-found').innerHTML = results(); // not if another search has started since
    };
    const p = ask({ title: 'Library', ok: null, cancel: 'Close' });
    dlg.classList.add('wide', 'lib');
    draw();
    $('dlg-body').onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'lib-q') { e.preventDefault(); run(); } }; // Enter searches; it must not close the dialog
    $('dlg-body').onclick = async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.libtab) { tab = t.dataset.libtab; draw(); return; }
      if (t.dataset.icon !== undefined) { // a find: fetched and made into a shape before the dialog closes
        const it = found[+t.dataset.icon];
        t.disabled = true;
        try { picked = { kind: 'icon', item: await fetchIcon(it) }; dlg.close('ok'); }
        catch (err) { t.disabled = false; say(err.message || 'That icon could not be made into a shape', true); }
        return;
      }
      const [kind, id] = (t.dataset.libx || t.dataset.lib || '').split(':');
      if (t.dataset.libx) { remove(kind, id); lib[kind] = lib[kind].filter((x) => x.id !== id); draw(); return; }
      if (!kind) return;
      picked = kind === 'file' || kind === 'shapefile' || kind === 'draw' ? { kind } : { kind, item: lib[kind].find((x) => x.id === id) };
      dlg.close('ok');
    };
    await p;
    $('dlg-body').onclick = $('dlg-body').onkeydown = null;
    dlg.classList.remove('wide', 'lib');
    return picked && (picked.kind === 'file' || picked.kind === 'shapefile' || picked.kind === 'draw' || picked.item) ? picked : null;
  }
  // Merging layers that cannot simply become one shape: what should happen?
  // → 'shape' | '#rrggbb' (make them all this colour, then one shape) | 'group' | 'picture' | null
  async function mergeChoice({ shapes, sameColour, colours, top }) {
    let picked = null;
    const why = !shapes ? 'Text and pictures cannot be part of a shape.'
      : !sameColour ? 'These shapes are different colours. One shape has one colour.'
      : 'These shapes have different settings (fade, finish, trim or Mirrored).';
    const oneShape = !shapes ? ''
      : !sameColour ? `<div class="sub">Make them all</div><div class="dots">${colours.map((c) => `<button type="button" class="dot big" data-pick="${esc(c)}" style="background:${esc(c)}" title="${esc(c.toUpperCase())}" aria-label="Make them all ${esc(c)}"></button>`).join('')}</div>`
      : `<button type="button" class="btn" data-pick="shape">One shape, like ${esc(top)}</button>`;
    const p = ask({
      title: 'Merge', ok: null,
      body: `<div class="note">${why}</div>${oneShape}<div class="acts"><button type="button" class="btn" data-pick="group" title="They stay separate, but are picked up together">Group them instead</button><button type="button" class="btn" data-pick="picture" title="One flat picture: it can be given one colour, but not reshaped">Merge into a picture</button></div>`,
    });
    $('dlg-body').onclick = (e) => {
      const t = e.target.closest('[data-pick]');
      if (t) { picked = t.dataset.pick; dlg.close('ok'); }
    };
    await p;
    $('dlg-body').onclick = null;
    return picked;
  }
  // Keyboard shortcuts, laid out as other programs lay theirs out: one action
  // to a row under the name it usually goes by, keys as keycaps, in groups.
  // Each entry: [action, ...ways], a way being the keys pressed together.
  // (What the keys really do is in the keydown handler in app.js and key() in tools.js.)
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
  const KEYS = [
    ['Tools', [
      ['Select', ['V']], ['Hand', ['H']], ['Pen', ['P']], ['Shape', ['U']], ['Band', ['B']], ['Stamp', ['S']],
      ['Text', ['T']], ['Fill panel', ['G']],
    ]],
    ['View', [
      ['Pan', ['Space', 'Drag'], ['Middle-drag']], ['Zoom', ['Scroll']], ['Zoom in', ['+']], ['Zoom out', ['−']], ['Fit to screen', ['F']],
      ['Panel colours on car', ['C']],
    ]],
    ['Selection', [
      ['Select all', ['Ctrl', 'A']], ['Deselect', ['Esc']], ['Add to selection', ['Ctrl', 'Click'], ['Shift', 'Click']], ['Select a range in Layers', ['Shift', 'Click']], ['Select one layer of a group', ['Double-click']], ['Marquee select', ['Drag']],
    ]],
    ['Edit', [
      ['Undo', ['Ctrl', 'Z']], ['Redo', ['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']],
      ['Copy', ['Ctrl', 'C']], ['Paste', ['Ctrl', 'V']], ['Duplicate', ['Ctrl', 'D']], ['Delete', ['Del'], ['Backspace']],
      ['Nudge 1 px', ['Arrow keys']], ['Nudge 10 px', ['Shift', 'Arrow keys']],
    ]],
    ['Arrange', [
      ['Bring forward', ['Ctrl', ']']], ['Send backward', ['Ctrl', '[']], ['Bring to front', ['Ctrl', 'Shift', ']']], ['Send to back', ['Ctrl', 'Shift', '[']],
      ['Group', ['Ctrl', 'G']], ['Ungroup', ['Ctrl', 'Shift', 'G']], ['Merge', ['Ctrl', 'E']], ['Mirror', ['Ctrl', 'M']],
    ]],
    ['Drawing', [
      ['Finish path', ['Enter']], ['Remove last point', ['Backspace']], ['Cancel', ['Esc']],
      ['Constrain angle to 45°', ['Shift']], ['Constrain proportions', ['Shift']], ['Rotate in 15° steps', ['Shift']],
      ['Add point', ['Click path']], ['Delete point', ['Right-click']], ['Context menu', ['Right-click']],
    ]],
    ['File', [
      ['Save', ['Ctrl', 'S']], ['Keyboard shortcuts', ['F1']],
    ]],
  ];
  const keycap = (k) => `<kbd>${esc(MAC && k === 'Ctrl' ? '⌘' : k)}</kbd>`;
  const shortcuts = () => {
    const group = ([name, rows]) => `<section><h4>${name}</h4>${rows.map(([action, ...ways]) =>
      `<div class="key"><span>${action}</span><span class="caps">${ways.map((w) => w.map(keycap).join('<i>+</i>')).join('<i class="or">or</i>')}</span></div>`).join('')}</section>`;
    // two columns, each a run of whole groups
    const cols = [[KEYS[0], KEYS[1], KEYS[2], KEYS[6]], [KEYS[3], KEYS[4], KEYS[5]]]; // Tools, View, Selection, File | Edit, Arrange, Drawing
    const p = ask({ title: 'Keyboard shortcuts', ok: 'Close', cancel: null, body: `<div class="keys">${cols.map((c) => `<div>${c.map(group).join('')}</div>`).join('')}</div>` });
    dlg.classList.add('wide');
    return p.then(() => dlg.classList.remove('wide'));
  };
  // who drew the icons used in the open livery: the open sets ask to be named
  const credits = () => {
    const list = actions.credits();
    return !list.length ? '' : '<div class="sub">Icons in this livery</div>' + list.map((c) =>
      `<div class="note">${esc(c.name)}: ${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.set)}</a>` : esc(c.set)}${c.author ? ' by ' + esc(c.author) : ''}${c.licence ? ', ' + esc(c.licence) : ''}</div>`).join('');
  };
  const about = () => ask({ title: 'About', ok: 'Close', cancel: null, body: `<div class="brandname">Overspray</div><div class="note">${esc(version)}</div><div class="note">Built on <a href="https://github.com/OblivionsPeak/clearcoat" target="_blank" rel="noopener">Clearcoat by OblivionsPeak</a></div>` + credits() });

  // ---------- clicks ----------
  const run = (act) => {
    if (!act) return;
    if (act.startsWith('show:')) { const k = act.slice(5); app.show[k] = !app.show[k]; actions.redraw(); return; } // a view choice: nothing in the livery changes
    if (act.startsWith('theme:')) return actions.setTheme(act.slice(6));
    if (act === 'shortcuts') return shortcuts();
    if (act === 'about') return about();
    return actions[act]();
  };
  document.addEventListener('click', (e) => {
    document.querySelector('.ctx')?.remove();
    const menuBtn = e.target.closest('.menu > button');
    if (menuBtn) {
      const m = menuBtn.parentElement, on = !m.classList.contains('open');
      closeMenus();
      m.classList.toggle('open', on);
      m.querySelector('.drop').hidden = !on;
      return;
    }
    const t = e.target.closest('button, .row');
    if (!t || !t.closest('.drop')) closeMenus();
    if (!t || t.disabled) return;
    if (t.dataset.act !== undefined) { closeMenus(); return run(t.dataset.act); }
    if (t.dataset.mode) return actions.setMode(t.dataset.mode);
    if (t.dataset.findef) { const [kind, key] = t.dataset.findef.split(/:(.*)/); return actions.finishDefault(kind, key); }
    if (t.dataset.fin) { const [kind, key] = t.dataset.fin.split(/:(.*)/); return actions.finishSelect(kind, key); }
    if (t.dataset.finish) return actions.setFinish(t.dataset.finish);
    if (t.dataset.scope) return actions.finishScope(t.dataset.scope);
    if (t.dataset.fade) return actions.setFade('style', t.dataset.fade);
    if (t.dataset.patdrop !== undefined) return actions.dropMotifShape(+t.dataset.patdrop);
    if (t.dataset.patcdrop !== undefined) return actions.dropPatternColour(+t.dataset.patcdrop);
    if (t.dataset.piece) return actions.pickPiece(t.dataset.piece);
    if (t.dataset.tool === 'image') return actions.openLibrary(); // nothing to arm: it opens the library
    if (t.dataset.tool) return actions.setTool(t.dataset.tool);
    if (t.dataset.edit) return actions.editColour(t.dataset.edit);
    if (t.dataset.pal) return actions.usePalette(t.dataset.pal);
    if (t.dataset.col) return actions.applyColour(t.dataset.col);
    if (t.dataset.kind) return actions.setShapeKind(t.dataset.kind);
    if (t.dataset.del) return actions.removeLayer(t.dataset.del);
    if (t.dataset.fold) return actions.foldGroup(t.dataset.fold);
    if (t.dataset.delg) return actions.removeGroup(t.dataset.delg);
    if (t.dataset.eyeg) return actions.showGroup(t.dataset.eyeg);
    if (t.dataset.eye) {
      const l = app.doc.layers.find((x) => x.id === t.dataset.eye);
      if (l) { l.visible = !l.visible; actions.change(); }
      return;
    }
    if (t.dataset.layer) { // Shift: the whole run from the row clicked last to this one; Ctrl: add or take out this one
      if (e.shiftKey && t.dataset.layer !== 'base' && panels.layers.contains(t)) return actions.selectRange(t.dataset.layer);
      // a layer's own row is that layer alone, even in a group; the group's row is the group
      return actions.select(t.dataset.layer, e.ctrlKey || e.metaKey || e.shiftKey, !t.dataset.group && panels.layers.contains(t));
    }
    if (t.dataset.p) {
      const p = t.closest('.panel'), key = p.dataset.panel;
      if (t.dataset.p === 'fold') p.querySelector('.body').hidden = !p.querySelector('.body').hidden;
      if (t.dataset.p === 'close') app.show[key] = false;
      if (t.dataset.p === 'float') {
        const floating = p.classList.toggle('float'), n = PANELS.indexOf(key);
        t.innerHTML = svg(floating ? 'dock' : 'float');
        t.title = floating ? 'Dock' : 'Float';
        t.setAttribute('aria-label', t.title);
        if (floating) { $('stage').append(p); p.style.left = 24 + n * 24 + 'px'; p.style.top = 20 + n * 150 + 'px'; }
        else {
          p.style.left = p.style.top = '';
          const next = PANELS.slice(n + 1).map((k) => panels[k]).find((q) => q.parentElement === $('dock'));
          next ? next.before(p) : $('dock').append(p);
        }
      }
      refresh(); // Properties mentions the Colour panel when it is hidden
    }
  });

  // right-click menus: on the sheet, and on a row of the Layers list
  const openCtx = (e, items) => {
    e.preventDefault();
    document.querySelector('.ctx')?.remove();
    const m = document.createElement('div'), box = $('stage').getBoundingClientRect();
    m.className = 'drop ctx';
    m.innerHTML = items.map(itemHtml).join('');
    $('stage').append(m);
    m.style.left = Math.max(4, Math.min(e.clientX - box.left, box.width - m.offsetWidth - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(e.clientY - box.top, box.height - m.offsetHeight - 4)) + 'px';
  };
  $('stage').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.panel')) return;
    openCtx(e, [...layerItems(), 0, ['Fit to screen', 'F', 'fit']]);
  });
  panels.layers.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row[data-layer]');
    if (!row || app.mode !== 'paint') return;
    e.preventDefault();
    const id = row.dataset.layer;
    if (id === 'base') return; // nothing in the menu applies to the base coat
    if (!actions.selectedLayers().some((l) => l.id === id)) actions.select(id); // the menu is about what is selected
    openCtx(e, layerItems());
  });

  // floating panels move by their header
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.panel.float > header');
    if (!h || e.target.closest('button')) return;
    const p = h.parentElement;
    drag = { p, dx: e.clientX - p.offsetLeft, dy: e.clientY - p.offsetTop };
    h.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const st = $('stage');
    drag.p.style.left = Math.max(0, Math.min(st.clientWidth - 60, e.clientX - drag.dx)) + 'px';
    drag.p.style.top = Math.max(0, Math.min(st.clientHeight - 30, e.clientY - drag.dy)) + 'px';
  });
  document.addEventListener('pointerup', () => { drag = null; });

  // put the cursor in a Properties box, ready to type over what is there
  const focusField = (id) => { const el = $(id); if (el) { el.focus(); if (el.select) el.select(); } };
  return { refresh, refreshChrome, say, ask, askText, pickProject, carSetup, shortcuts, editColour, focusField, library, mergeChoice };
}
