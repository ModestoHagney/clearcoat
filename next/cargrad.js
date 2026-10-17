// Overspray: the car gradient window. A car gradient is one fade over the
// whole car: its colours sit on a strip that stands for the car, front to
// back, and each panel takes the stretch of the strip its car line covers
// (map.carLines, see regions.js carLineEnds and mirror.js withCarLines).
// Here the colours are dragged along the strip, and the car lines are made:
// a line dragged over panels on the sheet, then along the strip where those
// panels sit on the car. The lines belong to the car's map, so every car
// gradient uses them.

import { carStops } from '../js/engine.js';
import { regionById } from '../js/regions.js';
import { pieceAt } from '../js/mirror.js';
import { pieces } from './map.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const X = '<svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg>';
// the blocks as a CSS gradient, for the strip and the swatches
export const carCss = (blocks) => {
  const s = carStops(blocks);
  return s.length ? `linear-gradient(90deg, ${s.map((o) => `${o.color} ${(o.at * 100).toFixed(2)}%`).join(', ')})` : 'var(--hover)';
};
const clamp = (v) => Math.max(0, Math.min(1, v));

export function initCarGradient(app, env) {
  const { screenToDoc, docToScreen, requestDraw } = env;
  let layerId = null;   // the car gradient the window is open for
  let drag = null;      // in the window: a block, a block's end or a line's end being dragged
  let drawing = false;  // Add a panel line: the next drag on the sheet is the line
  let sheetLine = null; // that line while it is dragged, { from, to }
  let pending = null;   // a line on the sheet, waiting for its stretch of the strip: { regions, from, to }
  let shown = '';       // what the window last showed, so an undo redraws it
  let eatClick = false; // a drag just ended on a colour box: its click must not open the colour pop-up

  const el = document.createElement('div');
  el.className = 'cgwin';
  el.hidden = true;
  $stage().append(el);
  function $stage() { return document.getElementById('stage'); }

  const map = () => app.doc.regionMap;
  const layer = () => app.doc.layers.find((l) => l.id === layerId && l.car) || null;
  const lines = () => (map() && map().carLines) || [];
  const names = (ids) => ids.map((id) => (regionById(map(), id) || { name: id }).name).join(', ');

  function render() {
    const l = layer();
    if (!l) { close(); return; }
    const bl = l.car.blocks, m = map();
    const missing = m ? pieces(m).filter((r) => !lines().some((cl) => cl.regions.includes(r.id))) : [];
    const hint = !m ? 'Load a template first: the lines go on its panels.'
      : drawing ? 'Drag a line on the sheet over the panels, front to back. Esc stops.'
      : pending ? `Now drag along the strip where ${esc(names(pending.regions))} ${pending.regions.length > 1 ? 'sit' : 'sits'} on the car, front to back.`
      : 'Drag a colour to move it, its ends to make it longer or shorter, click it to change it. A gap fades, touching colours meet at a sharp edge.';
    el.innerHTML = `<header><b>Car gradient</b><button class="icon" data-cg="close" title="Close" aria-label="Close">${X}</button></header>` +
      '<div class="cg-ends"><span>Front of the car</span><span>Back</span></div>' +
      `<div class="cg-strip${pending ? ' wait' : ''}" data-cg="strip" style="background:${carCss(bl)}">${pending ? '<i class="cg-pend"></i>' : ''}</div>` +
      '<div class="cg-blocks">' + bl.map((b, k) => `<div class="cg-block" data-k="${k}" style="left:${b.from * 100}%;width:${(b.to - b.from) * 100}%">` +
        `<input type="color" id="cg-c${k}" data-cgc="${k}" value="${esc(b.color)}" aria-label="Colour ${k + 1}" title="Drag to move it, click to change it">` +
        `<i class="cg-h" data-end="from"></i><i class="cg-h" data-end="to"></i>` +
        (bl.length > 1 ? `<button class="mx" data-cgdrop="${k}" title="Take this colour out" aria-label="Take colour ${k + 1} out">${X}</button>` : '') + '</div>').join('') + '</div>' +
      `<div class="cg-acts"><button class="btn" data-cg="add"${bl.length >= 12 ? ' disabled' : ''}>Add a colour</button></div>` +
      `<div class="cg-hint">${hint}</div>` +
      '<div class="cg-lines">' + lines().map((cl, k) => {
        const lo = Math.min(cl.a, cl.b), hi = Math.max(cl.a, cl.b);
        return `<div class="cg-line" data-line="${k}"><span class="cg-bar${cl.b < cl.a ? ' back' : ''}" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"><i data-lend="${cl.a <= cl.b ? 'a' : 'b'}"></i><i data-lend="${cl.a <= cl.b ? 'b' : 'a'}"></i></span>` +
          `<span class="cg-name" style="${lo > 0.5 ? `right:${(1 - lo) * 100}%;text-align:right` : `left:${hi * 100}%`}">${esc(names(cl.regions))}</span>` +
          `<button class="mx" data-lineout="${k}" title="Take this line off" aria-label="Take the line for ${esc(names(cl.regions))} off">${X}</button></div>`;
      }).join('') + '</div>' +
      `<div class="cg-acts"><button class="btn" data-cg="line"${m ? '' : ' disabled'} aria-pressed="${drawing}">Add a panel line</button>` +
      (missing.length && m ? `<span class="cg-missing" title="${esc(missing.map((r) => r.name).join(', '))}">No line yet: ${esc(missing.slice(0, 6).map((r) => r.name).join(', '))}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}</span>` : '') + '</div>';
    shown = JSON.stringify([l.car, lines(), drawing, !!pending]);
  }

  function open(id) { layerId = id; el.hidden = false; render(); requestDraw(); }
  function close() { el.hidden = true; layerId = null; drawing = false; pending = sheetLine = drag = null; requestDraw(); }
  // after an undo, or a change made elsewhere: the window shows what is there now
  function sync() {
    if (el.hidden || drag) return;
    const l = layer();
    if (app.mode !== 'paint') { close(); return; }
    if (!l) { close(); return; }
    if (JSON.stringify([l.car, lines(), drawing, !!pending]) !== shown) render();
  }

  // ---- the colours ----
  const blocks = () => layer().car.blocks.map((b) => ({ ...b }));
  const setBlocks = (bl, live) => env.setBlocks(layerId, bl, live);
  function addColour() {
    const bl = blocks().sort((a, b) => a.from - b.from);
    // in the middle of the widest gap, a tenth of the car long (or as long as the gap allows)
    let best = { at: 0, w: bl.length ? bl[0].from : 1 };
    bl.forEach((b, i) => { const end = i + 1 < bl.length ? bl[i + 1].from : 1, w = end - b.to; if (w > best.w) best = { at: b.to, w }; });
    const len = Math.min(0.1, best.w * 0.5), mid = best.at + best.w / 2;
    bl.push({ color: env.nextColour(bl.map((b) => b.color)), from: clamp(mid - len / 2), to: clamp(mid + len / 2) });
    setBlocks(bl, false);
    render();
  }

  // ---- the lines ----
  const setLines = (ls, live, msg) => env.setLines(ls, live, msg);
  // the panels a line on the sheet passes over, in order along it
  function under(a, b) {
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4)), ids = [];
    for (let i = 0; i <= n; i++) {
      const r = pieceAt(map(), a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n);
      if (r && !r.kind && !ids.includes(r.id)) ids.push(r.id);
    }
    return ids;
  }
  function placeLine(a, b) {
    const p = pending;
    pending = null;
    // a panel has one line: one it was on before lets it go
    const ls = lines().map((cl) => ({ ...cl, regions: cl.regions.filter((id) => !p.regions.includes(id)) })).filter((cl) => cl.regions.length);
    ls.push({ ...p, a, b });
    setLines(ls, false, `Car line set for ${names(p.regions)}`);
    render();
  }

  // ---- dragging in the window ----
  const frac = (e) => { const r = el.querySelector('.cg-strip').getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width); };
  // an end lands on another colour's end when it comes within 6 px of it, so two can be made to touch
  function snapEnd(v, bl, skip) {
    const w = el.querySelector('.cg-strip').getBoundingClientRect().width || 1;
    for (const [i, b] of bl.entries()) for (const e of [b.from, b.to]) if (i !== skip && Math.abs(e - v) * w < 6) return e;
    return v;
  }
  el.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (e.button !== 0 || t.closest('button')) return;
    if (t.closest('header')) { // moved by its title bar, off whatever it covers
      e.preventDefault();
      const r = el.getBoundingClientRect(), box = $stage().getBoundingClientRect();
      drag = { kind: 'win', dx: e.clientX - r.left, dy: e.clientY - r.top, box };
      el.setPointerCapture(e.pointerId);
      return;
    }
    const strip = t.closest('[data-cg="strip"]');
    if (strip && pending) { e.preventDefault(); drag = { kind: 'strip', a: frac(e), b: frac(e) }; strip.setPointerCapture(e.pointerId); showPending(); return; }
    const end = t.closest('[data-lend]');
    if (end) { e.preventDefault(); drag = { kind: 'lend', k: +t.closest('[data-line]').dataset.line, end: end.dataset.lend, moved: false }; end.setPointerCapture(e.pointerId); return; }
    const blk = t.closest('.cg-block');
    if (!blk) return;
    const k = +blk.dataset.k, b = layer().car.blocks[k], h = t.closest('.cg-h');
    // held from the first move, not the press: a plain click must still reach the colour box
    drag = { kind: h ? h.dataset.end : 'move', k, x0: frac(e), from: b.from, to: b.to, moved: false, px: e.clientX, id: e.pointerId };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'win') {
      const { box } = drag;
      el.style.left = Math.max(0, Math.min(box.width - el.offsetWidth, e.clientX - box.left - drag.dx)) + 'px';
      el.style.top = Math.max(0, Math.min(box.height - el.offsetHeight, e.clientY - box.top - drag.dy)) + 'px';
      el.style.bottom = 'auto'; el.style.transform = 'none';
      return;
    }
    if (drag.kind === 'strip') { drag.b = frac(e); showPending(); return; }
    if (drag.kind === 'lend') {
      drag.moved = true;
      const ls = lines().map((cl) => ({ ...cl }));
      ls[drag.k][drag.end] = frac(e);
      setLines(ls, true);
      const cl = ls[drag.k], lo = Math.min(cl.a, cl.b), hi = Math.max(cl.a, cl.b), bar = el.querySelector(`[data-line="${drag.k}"] .cg-bar`);
      bar.style.left = lo * 100 + '%'; bar.style.width = (hi - lo) * 100 + '%'; bar.classList.toggle('back', cl.b < cl.a);
      return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.px) < 3) return;
    if (!drag.moved) el.setPointerCapture(drag.id);
    drag.moved = true;
    const bl = blocks(), b = bl[drag.k], d = frac(e) - drag.x0, len = drag.to - drag.from;
    if (drag.kind === 'move') {
      let from = Math.max(0, Math.min(1 - len, drag.from + d));
      const sf = snapEnd(from, bl, drag.k), st = snapEnd(from + len, bl, drag.k);
      if (sf !== from) from = sf; else if (st !== from + len) from = st - len;
      b.from = from; b.to = from + len;
    } else if (drag.kind === 'from') b.from = Math.min(snapEnd(clamp(drag.from + d), bl, drag.k), b.to);
    else b.to = Math.max(snapEnd(clamp(drag.to + d), bl, drag.k), b.from);
    const blk = el.querySelector(`.cg-block[data-k="${drag.k}"]`);
    blk.style.left = b.from * 100 + '%'; blk.style.width = (b.to - b.from) * 100 + '%';
    el.querySelector('.cg-strip').style.background = carCss(bl);
    setBlocks(bl, true); // the sheet follows as it moves
  });
  const up = () => {
    const d = drag;
    if (!d) return;
    drag = null;
    if (d.kind === 'win') return;
    if (d.kind === 'strip') {
      if (Math.abs(d.b - d.a) < 0.01) { env.say('Drag along the strip, front to back, where those panels sit'); render(); return; }
      placeLine(d.a, d.b);
      return;
    }
    if (d.kind === 'lend') { if (d.moved) setLines(lines().map((cl) => ({ ...cl })), false); render(); return; }
    if (d.moved) { eatClick = true; setBlocks(blocks(), false); render(); }
  };
  window.addEventListener('pointerup', up); // let go anywhere
  window.addEventListener('pointercancel', up);
  // ahead of the colour pop-up's own listener: a drag that ends on a colour box is not a click on it
  window.addEventListener('click', (e) => { if (eatClick && el.contains(e.target)) { eatClick = false; e.stopPropagation(); e.preventDefault(); } else eatClick = false; }, true);
  function showPending() {
    const i = el.querySelector('.cg-pend');
    if (!i || !drag) return;
    const lo = Math.min(drag.a, drag.b), hi = Math.max(drag.a, drag.b);
    i.style.left = lo * 100 + '%'; i.style.width = (hi - lo) * 100 + '%';
  }
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.cgc;
    if (k === undefined) return;
    e.stopPropagation();
    const bl = blocks();
    bl[+k].color = e.target.value;
    el.querySelector('.cg-strip').style.background = carCss(bl);
    setBlocks(bl, true);
  });
  el.addEventListener('change', (e) => { if (e.target.dataset.cgc !== undefined) { e.stopPropagation(); setBlocks(blocks(), false); } });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cg === 'close') return close();
    if (t.dataset.cg === 'add') return addColour();
    if (t.dataset.cg === 'line') { drawing = !drawing; pending = null; render(); requestDraw(); return; }
    if (t.dataset.cgdrop !== undefined) { setBlocks(blocks().filter((_, i) => i !== +t.dataset.cgdrop), false); render(); return; }
    if (t.dataset.lineout !== undefined) { const k = +t.dataset.lineout; setLines(lines().filter((_, i) => i !== k), false, `Car line taken off ${names(lines()[k].regions)}`); render(); }
  });

  // ---- the line on the sheet (while Add a panel line is on) ----
  const round = (p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  function down(e, s) { const p = round(screenToDoc(s.x, s.y)); sheetLine = { from: p, to: { ...p } }; requestDraw(); }
  function move(e, s) { if (!sheetLine) return; sheetLine.to = round(screenToDoc(s.x, s.y)); requestDraw(); }
  function upSheet() {
    const L = sheetLine;
    sheetLine = null;
    if (!L) return;
    const a = docToScreen(L.from.x, L.from.y), b = docToScreen(L.to.x, L.to.y);
    const regions = Math.hypot(b.x - a.x, b.y - a.y) < 8 ? [] : under(L.from, L.to);
    if (!regions.length) { env.say('Drag the line over one or more panels, front to back'); requestDraw(); return; }
    drawing = false;
    pending = { regions, from: L.from, to: L.to };
    render();
    requestDraw();
  }
  function key(e) {
    if (el.hidden || e.key !== 'Escape' || !(drawing || pending)) return false;
    drawing = false; pending = sheetLine = null; render(); requestDraw();
    return true;
  }

  // the car lines on the sheet while the window is open, the one being made on top
  function drawOverlay(ctx, accent) {
    if (el.hidden) return;
    const arrow = (L, col, w) => {
      const A = docToScreen(L.from.x, L.from.y), B = docToScreen(L.to.x, L.to.y), t = Math.atan2(B.y - A.y, B.x - A.x);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      for (const k of [-1, 1]) { ctx.moveTo(B.x, B.y); ctx.lineTo(B.x - 12 * Math.cos(t + k * 0.45), B.y - 12 * Math.sin(t + k * 0.45)); }
      ctx.lineCap = 'round'; ctx.strokeStyle = '#101114'; ctx.lineWidth = w + 2.5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.lineCap = 'butt';
    };
    for (const cl of lines()) arrow(cl, '#ffffff', 2);
    if (pending) arrow(pending, accent, 3);
    if (sheetLine) arrow(sheetLine, accent, 3);
  }

  return {
    open, close, sync, key, drawOverlay,
    isOpen: () => !el.hidden,
    drawing: () => drawing && !el.hidden,
    down, move, up: upSheet,
  };
}
