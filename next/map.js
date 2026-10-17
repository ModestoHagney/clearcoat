// Overspray: Map mode. The map is what the app knows about the
// sheet beyond pixels: which outline is which panel, which panel is the twin
// of which, and where a panel's centreline runs. Painting tools (fill a
// panel, trim, mirror) work from it; this mode is where it is looked at and
// corrected.

import { SIZE, createImageLayer, loadImage } from '../js/engine.js';
import { regionOutline, regionById, centerLine, snapToOutline, slideAlong, labelPoint, linkPoints, linkLength, linkDir, matchPoint, twinLink, twinOf } from '../js/regions.js';
import { pieceAt } from '../js/mirror.js';

export const GUIDE = 'Panel guide'; // the layer that puts the panel colours on the car
export const pieces = (map) => (map ? map.regions.filter(r => !r.kind) : []);
// golden-angle steps keep neighbours in the list far apart in colour
export const hue = (i, alpha = 1) => `hsl(${(i * 137.5) % 360} 62% ${i % 2 ? 64 : 50}% / ${alpha})`;

// where each panel's name goes; worked out once per outline, not per frame
const labelCache = new WeakMap();
function labelOf(r, later) {
  const c = labelCache.get(r);
  if (c && c.n === r.points.length && c.x0 === r.points[0].x && c.y0 === r.points[0].y) return c.p;
  const p = labelPoint(r, later);
  labelCache.set(r, { n: r.points.length, x0: r.points[0].x, y0: r.points[0].y, p });
  return p;
}

// Linked edges get the same run of colour bands down both sides, so on the car
// the same colours should face each other across the join. Strong colours,
// unlike each other, in an order that reads differently backwards: a link made
// the wrong way round shows up.
const BANDS = ['#ffffff', '#e6194b', '#ffe119', '#0082c8', '#101114', '#f58231'];
const linkHue = (i) => `hsl(${(i * 137.5 + 40) % 360} 95% 62%)`;

// The panel colours, names, linked edges and centrelines as a full-sheet
// picture: what the "Show on car" guide layer is made of.
export function guideCanvas(map) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const list = pieces(map);
  const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); };
  list.forEach((r, i) => {
    trace(regionOutline(r));
    ctx.fillStyle = hue(i); ctx.fill();
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 3; ctx.stroke();
  });
  (map.links || []).forEach((link, i) => {
    const n = Math.max(3, Math.min(16, Math.round(linkLength(map, link) / 48)));
    for (const side of ['a', 'b']) {
      const r = regionById(map, link[side].region);
      if (!r) continue;
      ctx.save();
      trace(regionOutline(r)); ctx.clip(); // the band stays inside its own panel
      ctx.lineCap = 'butt'; ctx.lineWidth = 44; // half falls outside the outline and is clipped away
      for (let k = 0; k < n; k++) {
        const pts = linkPoints(map, link, side, k / n, (k + 1) / n, 3);
        ctx.beginPath(); pts.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.strokeStyle = BANDS[(k + i) % BANDS.length]; ctx.stroke();
      }
      ctx.restore();
    }
  });
  for (const r of list) {
    const cl = centerLine(r);
    if (!cl) continue;
    ctx.save();
    trace(regionOutline(r)); ctx.clip();
    ctx.beginPath(); ctx.moveTo(cl.p0.x, cl.p0.y); ctx.lineTo(cl.p1.x, cl.p1.y);
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 14; ctx.stroke();
    ctx.setLineDash([28, 20]); ctx.strokeStyle = '#ffe119'; ctx.lineWidth = 8; ctx.stroke();
    ctx.restore();
  }
  list.forEach((r, i) => {
    const p = labelOf(r, list.slice(i + 1));
    let size = Math.max(14, Math.min(64, p.room * 0.7));
    ctx.font = `700 ${size}px "IBM Plex Mono", monospace`;
    const fit = (p.room * 1.7) / ctx.measureText(r.name).width;
    if (fit < 1) { size = Math.max(11, size * fit); ctx.font = `700 ${size}px "IBM Plex Mono", monospace`; }
    ctx.lineWidth = size / 4; ctx.strokeStyle = '#101114'; ctx.strokeText(r.name, p.x, p.y);
    ctx.fillStyle = '#ffffff'; ctx.fillText(r.name, p.x, p.y);
  });
  return c;
}

export const guideLayer = (doc) => doc.layers.find(l => l.type === 'image' && l.name === GUIDE) || null;
// Puts the guide on the car (a locked layer on top of everything), refreshes
// it after a map edit, or takes it off again.
export async function syncGuide(doc, on) {
  const old = guideLayer(doc);
  if (!on) { if (old) doc.layers.splice(doc.layers.indexOf(old), 1); return; }
  if (!doc.regionMap) return;
  const src = guideCanvas(doc.regionMap).toDataURL('image/png');
  const img = await loadImage(src);
  if (old) { old.img = img; old.src = src; return; }
  const layer = createImageLayer(img, src, GUIDE);
  layer.scale = 1;
  layer.locked = true; // sheet-sized: it must never be grabbed by a click
  doc.layers.push(layer);
}

export function initMap(app, env) {
  const { screenToDoc, docToScreen, requestDraw } = env;
  let pending = null;   // centreline: the first corner clicked, { region, x, y }
  let snap = null;      // centreline and link: where a click would land right now
  // Link edges: which edges meet on the car. Four clicks make one: the two
  // ends of the shared stretch on one panel, then the two spots they meet on
  // the other, in the same order. Links live in the map (see regions.js).
  let ends = [];        // the ends clicked so far for the link being made: { region, x, y }
  let seam = null;      // near a linked edge: that spot and the one it meets, { at, partner }
  let slide = null;     // a link's end being slid along its edge: { region, ends, start, moved }
  let picked = null;    // the link end last grabbed, for the arrow keys to nudge: { region, ends }

  const map = () => app.doc.regionMap;
  const sel = () => (map() && app.piece ? regionById(map(), app.piece) : null);

  // the nearest spot on a panel's edge, corners preferred (free: no corner pull)
  function edgeSnap(p, only, reach = 14 / app.view.zoom, free = false) {
    let best = null;
    for (const r of pieces(map())) {
      if (only && r.id !== only) continue;
      const q = snapToOutline(regionOutline(r), p.x, p.y, free ? 0 : 4 / app.view.zoom);
      if (q.d <= reach && (!best || q.d < best.d)) best = { region: r.id, x: q.x, y: q.y, d: q.d };
    }
    return best;
  }
  const centreTarget = () => (pending ? pending.region : app.centreFor);
  // the second end of a stretch stays on the first end's panel; an end of a link already on that edge is landed on exactly
  // (skip: ends not to land on, the ones being slid; free: no pull to corners or ends, Alt held while sliding)
  function linkSnap(p, only = ends.length % 2 ? ends[ends.length - 1].region : null, reach, skip = [], free = false) {
    const hit = edgeSnap(p, only, reach, free);
    if (!hit || free) return hit;
    for (const l of map().links || []) for (const sd of [l.a, l.b]) {
      if (sd.region !== hit.region) continue;
      for (const end of [sd.from, sd.to]) if (!skip.includes(end) && Math.hypot(end.x - hit.x, end.y - hit.y) <= 10 / app.view.zoom) return { region: hit.region, x: end.x, y: end.y };
    }
    return hit;
  }
  // The link end under the pointer, with every other end at that same spot on
  // the same panel: where two links butt up on one edge they move together.
  function linkEndAt(s) {
    const m = map(), links = m.links || [];
    for (const l of links) for (const sd of [l.a, l.b]) for (const end of [sd.from, sd.to]) {
      const q = docToScreen(end.x, end.y);
      if (Math.hypot(q.x - s.x, q.y - s.y) > 9) continue;
      const mates = [];
      for (const l2 of links) for (const side of ['a', 'b']) {
        const s2 = l2[side];
        if (s2.region !== sd.region) continue;
        const hit = [s2.from, s2.to].filter(e => Math.hypot(e.x - end.x, e.y - end.y) < 0.6);
        // which way round the stretch runs is pinned, or it would flip to the
        // short way the moment it is slid past half the outline
        if (hit.length) { s2.dir = linkDir(m, l2, side); mates.push(...hit); }
      }
      return { region: sd.region, ends: mates };
    }
    return null;
  }
  // would moving these ends to `to` land them on the other end of their own stretch?
  const clashes = (moving, to) => map().links.some(l => [l.a, l.b].some(sd =>
    (moving.includes(sd.from) ? [sd.to] : moving.includes(sd.to) ? [sd.from] : []).some(o => Math.hypot(o.x - to.x, o.y - to.y) < 2)));
  const place = (moving, to) => { for (const end of moving) { end.x = Math.round(to.x * 10) / 10; end.y = Math.round(to.y * 10) / 10; } };
  // Left/Right: the picked end `step` px along its panel's edge, Right whichever way
  // goes more right on screen at the first press (on an upright edge: down)
  function nudge(dir, step) {
    const m = map(), r = picked && regionById(m, picked.region);
    // gone if the link was removed or the map replaced (undo)
    if (!r || !(m.links || []).some(l => [l.a, l.b].some(sd => picked.ends.includes(sd.from) || picked.ends.includes(sd.to)))) { picked = null; requestDraw(); return; }
    const e0 = picked.ends[0], pts = regionOutline(r);
    // which way round the outline Right goes is settled on the first press and kept,
    // so going round a corner doesn't flip it
    if (!picked.way) {
      const fwd = slideAlong(pts, e0.x, e0.y, 1), back = slideAlong(pts, e0.x, e0.y, -1);
      const dx = fwd.x - back.x, dy = fwd.y - back.y;
      picked.way = (Math.abs(dx) > 0.1 ? dx : dy) > 0 ? 1 : -1;
    }
    const to = slideAlong(pts, e0.x, e0.y, dir * picked.way * step);
    if (clashes(picked.ends, to)) { env.say('The two ends need to be apart'); return; }
    place(picked.ends, to);
    seam = null;
    env.mapChanged();
  }
  const nameOf = (id) => (regionById(map(), id) || { name: id }).name;
  // a link goes with its twin on the other side of the car, as they were made: → the twin removed, or null
  function dropLink(m, link) {
    const twin = twinOf(m, link);
    for (const l of [link, twin]) if (l) m.links.splice(m.links.indexOf(l), 1);
    picked = null;
    return twin;
  }
  function linkClick(p, remove) {
    const m = map();
    if (remove) {
      const hit = matchPoint(m, p.x, p.y, 12 / app.view.zoom);
      if (!hit) { env.say('No link there to remove'); return; }
      const twin = dropLink(m, m.links[hit.index]);
      seam = null;
      env.mapChanged(twin ? 'Link removed, and its twin on the other side' : 'Link removed');
      return;
    }
    const n = ends.length, hit = linkSnap(p);
    if (!hit) { env.say(n % 2 ? 'Click the other end on the same panel\'s edge' : 'Click closer to a panel\'s edge'); return; }
    if (n % 2 && Math.hypot(hit.x - ends[n - 1].x, hit.y - ends[n - 1].y) < 2) { env.say('The two ends need to be apart'); return; }
    ends.push(hit);
    if (ends.length < 4) { requestDraw(); env.refreshChrome(); return; }
    const [a1, a2, b1, b2] = ends, pt = (c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 });
    const link = { a: { region: a1.region, from: pt(a1), to: pt(a2) }, b: { region: b1.region, from: pt(b1), to: pt(b2) } };
    (m.links || (m.links = [])).push(link);
    const twin = twinLink(m, link); // the matching edges on the other side of the car get linked too
    if (twin) m.links.push(twin);
    ends = []; snap = null;
    env.mapChanged(`Linked ${nameOf(a1.region)} and ${nameOf(b1.region)}` + (twin ? `, and ${nameOf(twin.a.region)} and ${nameOf(twin.b.region)}` : ''));
  }

  function down(e, s) {
    if (!map()) return;
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'mlink') {
      // a press on a link's end: a drag slides it along the edge, a plain click still counts as a click there
      const grab = !e.altKey && !ends.length ? linkEndAt(s) : null;
      if (grab) { slide = { ...grab, start: s, moved: false }; picked = grab; }
      else linkClick(p, e.altKey);
      return;
    }
    if (app.tool === 'mcentre') {
      const hit = edgeSnap(p, centreTarget());
      if (!hit) { env.say(pending ? 'Click the matching corner on the same panel' : 'Click closer to the panel\'s edge'); return; }
      if (!pending) { pending = hit; requestDraw(); env.refreshChrome(); return; }
      if (Math.hypot(hit.x - pending.x, hit.y - pending.y) < 2) { env.say('The two corners need to be apart'); return; }
      const r = regionById(map(), hit.region), pt = (c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 });
      r.center = { a: pt(pending), b: pt(hit) };
      pending = snap = null;
      app.piece = r.id;
      app.centreFor = null;
      app.tool = 'mpick';
      env.mapChanged(`Centreline set on ${r.name}`);
      return;
    }
    const r = pieceAt(map(), p.x, p.y);
    env.pickPiece(r ? r.id : null);
  }

  function move(e, s) {
    if (!map()) return;
    if (app.tool === 'mlink') {
      const p = screenToDoc(s.x, s.y);
      if (slide) {
        if (!slide.moved && Math.hypot(s.x - slide.start.x, s.y - slide.start.y) < 4) return;
        slide.moved = true;
        const to = linkSnap(p, slide.region, Infinity, slide.ends, e.altKey);
        // an end may not land on the other end of its own stretch
        if (to && !clashes(slide.ends, to)) place(slide.ends, to);
        snap = seam = null;
        requestDraw();
        return;
      }
      snap = linkSnap(p);
      const m = matchPoint(map(), p.x, p.y, 10 / app.view.zoom); // where this spot lands on the other panel
      seam = m ? { at: m.at, partner: m.partner } : null;
      requestDraw();
      return;
    }
    if (app.tool !== 'mcentre') return;
    const hit = edgeSnap(screenToDoc(s.x, s.y), centreTarget());
    if ((hit && hit.x) !== (snap && snap.x) || (hit && hit.y) !== (snap && snap.y)) { snap = hit; requestDraw(); }
  }

  function up() {
    if (!slide) return;
    const d = slide;
    slide = null;
    if (d.moved) { env.mapChanged(); env.refreshChrome(); }
    else { picked = null; linkClick(screenToDoc(d.start.x, d.start.y), false); }
  }

  function key(e) {
    if (app.tool === 'mlink' && picked && !ends.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { nudge(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey ? 10 : 1); return true; }
    if (app.tool === 'mlink' && e.key === 'Backspace') { // takes back the last click, or the last link made
      if (ends.length) { ends.pop(); requestDraw(); env.refreshChrome(); }
      else if (map() && (map().links || []).length) { const m = map(), twin = dropLink(m, m.links[m.links.length - 1]); seam = null; env.mapChanged(twin ? 'Last link removed, and its twin' : 'Last link removed'); }
      return true;
    }
    if (e.key !== 'Escape') return false;
    if (pending) { pending = null; requestDraw(); env.refreshChrome(); }
    else if (picked && app.tool === 'mlink') { picked = null; requestDraw(); env.refreshChrome(); }
    else if (ends.length) { ends = []; requestDraw(); env.refreshChrome(); }
    else if (app.tool === 'mcentre' || app.tool === 'mlink') env.setTool('mpick');
    else env.pickPiece(null);
    return true;
  }
  function cancel() { pending = snap = seam = slide = picked = null; ends = []; }

  const hint = () => {
    if (app.tool === 'hand') return 'Drag to move the sheet · wheel zooms · H or Esc puts it down';
    if (!map()) return 'Load a template to get a map';
    if (app.tool === 'mcentre') return pending ? 'Click the matching corner on the other side' : 'Click a corner, then its match on the other side';
    if (app.tool === 'mlink') return [(picked ? '← → nudge the end you moved (Shift: 10 px) · Esc lets go · ' : '') + 'Click one end of an edge that meets another panel · drag a link\'s end to move it (hold Alt to skip snapping) · Alt+click removes a link', 'Click the other end, on the same panel', 'Now the spot on the other panel that meets end 1', 'And the spot that meets end 2'][ends.length] + (ends.length ? ' · Backspace takes one back' : '');
    return sel() ? 'Name it, pair it or set its centreline on the right' : 'Click a panel';
  };

  // screen space
  function drawOverlay(ctx, accent) {
    const m = map();
    if (!m) return;
    const S = (q) => docToScreen(q.x, q.y);
    const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { const a = S(q); i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); }); ctx.closePath(); };
    const list = pieces(m), z = app.view.zoom;
    ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    list.forEach((r, i) => {
      trace(regionOutline(r));
      if (app.mapShow.colours) { ctx.fillStyle = hue(i, 0.82); ctx.fill(); }
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.25; ctx.stroke();
    });
    for (const r of m.regions) { // the kit's own number and sponsor boxes
      if (!r.kind) continue;
      const a = S(r), b = S({ x: r.x + r.w, y: r.y + r.h });
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#101114'; ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
    for (const r of list) {
      const cl = centerLine(r);
      if (!cl) continue;
      ctx.save();
      trace(regionOutline(r)); ctx.clip();
      const a = S(cl.p0), b = S(cl.p1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([9, 6]); ctx.strokeStyle = '#ffe119'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    if (app.mapShow.colours) list.forEach((r, i) => {
      const p = labelOf(r, list.slice(i + 1));
      let size = Math.max(14, Math.min(64, p.room * 0.7)) * z;
      if (size < 7) return; // too small to read at this zoom
      ctx.font = `600 ${size}px "IBM Plex Mono", monospace`;
      const fit = (p.room * 1.7 * z) / ctx.measureText(r.name).width;
      if (fit < 1) { size *= fit; if (size < 7) return; ctx.font = `600 ${size}px "IBM Plex Mono", monospace`; }
      const a = S(p);
      ctx.lineWidth = Math.max(2, size / 4); ctx.strokeStyle = '#101114'; ctx.strokeText(r.name, a.x, a.y);
      ctx.fillStyle = '#ffffff'; ctx.fillText(r.name, a.x, a.y);
    });
    const cur = sel();
    if (cur) {
      const twin = cur.mirror ? regionById(m, cur.mirror) : null;
      if (twin) { trace(regionOutline(twin)); ctx.setLineDash([7, 5]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); }
      trace(regionOutline(cur));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
    }
    const dot = (q, r, fill) => { const a = S(q); ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); };
    // linked edges: both stretches of a link in one colour, a big dot on the ends that meet each other
    ctx.lineCap = 'round';
    (m.links || []).forEach((link, i) => {
      for (const side of ['a', 'b']) {
        const pts = linkPoints(m, link, side);
        if (!pts.length) continue;
        ctx.beginPath(); pts.forEach((q, k) => { const a = S(q); k ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); });
        ctx.strokeStyle = '#101114'; ctx.lineWidth = 7; ctx.stroke();
        ctx.strokeStyle = linkHue(i); ctx.lineWidth = 4; ctx.stroke();
        dot(pts[0], 5, linkHue(i)); dot(pts[pts.length - 1], 3, linkHue(i));
      }
    });
    ctx.lineCap = 'butt';
    if (app.tool === 'mlink') {
      if (seam) { // this spot, and where it meets the other panel
        const a = S(seam.at), b = S(seam.partner);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.setLineDash([3, 5]); ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 9, 0, Math.PI * 2); ctx.strokeStyle = '#101114'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      if (picked && !ends.length) { const a = S(picked.ends[0]); ctx.beginPath(); ctx.arc(a.x, a.y, 11, 0, Math.PI * 2); ctx.strokeStyle = '#101114'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke(); } // the end the arrow keys move
      if (snap) { const a = S(snap); ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ends.forEach((c, k) => { dot(c, 8, accent); const a = S(c); ctx.fillStyle = '#ffffff'; ctx.fillText(String(k % 2 + 1), a.x, a.y + 0.5); }); // 1 meets 1, 2 meets 2
    }
    if (pending) dot(pending, 6, accent);
    if (app.tool === 'mcentre' && snap) {
      const a = S(snap);
      ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      if (pending) { // where the centreline would run
        const p0 = S(pending);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(a.x, a.y);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  return { down, move, up, key, cancel, hint, drawOverlay };
}
