// Clearcoat, new screen: shapes from outside. An SVG (a file, or an icon from
// the open icon sets searched through the Iconify service) is read into one of
// this app's own outlines, so it is a shape like any other: it takes a colour,
// repeats as a pattern, stamps, mirrors and can be reshaped.
//
// What an SVG fills becomes the shape, and so does the inside of a line that
// closes on itself. A line left open has no inside to fill, and several
// colours come in as one.

import { parsePath, evenOddPieces, asOutline } from '../js/svgpath.js';
import { bounds, joined, mapped } from '../js/shapes.js';

// The sets searched: filled icons whose licences allow this use. Game Icons
// asks for a credit, which is why every icon brought in carries one.
export const SETS = ['game-icons', 'material-symbols', 'mdi', 'bi'];
const API = 'https://api.iconify.design';
const SIZE_ON_SHEET = 300; // px along the longer side when first placed

// the shapes an SVG can hold besides <path>, as path data
function dataOf(el) {
  const n = (k) => parseFloat(el.getAttribute(k)) || 0;
  switch (el.tagName.toLowerCase()) {
    case 'path': return el.getAttribute('d') || '';
    case 'rect': return `M${n('x')} ${n('y')}h${n('width')}v${n('height')}h${-n('width')}z`; // ponytail: rounded corners (rx) come in square
    case 'circle': { const r = n('r'); return `M${n('cx') - r} ${n('cy')}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`; }
    case 'ellipse': { const rx = n('rx'), ry = n('ry'); return `M${n('cx') - rx} ${n('cy')}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`; }
    case 'polygon': return 'M' + (el.getAttribute('points') || '').trim() + 'z';
    default: return '';
  }
}

// svg: the file's text. → { pts, w, h }: the outline from its own top-left
// corner, sized for the sheet. Throws with a plain reason when there is no
// shape to be had.
export function svgToShape(svg) {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('That file is not an SVG');
  // It has to be in the page for the browser to work out each part's fill and
  // where its transforms put it. Drawn 1:1 with its own viewBox, unseen.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
  const live = host.appendChild(document.importNode(root, true));
  document.body.appendChild(host);
  try {
    const vb = live.viewBox && live.viewBox.baseVal && live.viewBox.baseVal.width ? live.viewBox.baseVal : null;
    const size = vb ? Math.max(vb.width, vb.height) : Math.max(parseFloat(live.getAttribute('width')) || 0, parseFloat(live.getAttribute('height')) || 0) || 100;
    if (vb) { live.setAttribute('width', vb.width); live.setAttribute('height', vb.height); }
    const parts = [];
    for (const el of live.querySelectorAll('path, rect, circle, ellipse, polygon')) {
      if (el.closest('defs, clipPath, mask, symbol, pattern, marker')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      // Drawn as a line only: a line that closes on itself is taken as the
      // edge of a shape and filled; one that does not has no inside to fill.
      const lineOnly = cs.fill === 'none';
      if (lineOnly && cs.stroke === 'none') continue; // draws nothing at all
      let pieces = parsePath(dataOf(el), size / 800, { closedOnly: lineOnly });
      if (!pieces.length) continue;
      if (cs.fillRule === 'evenodd') pieces = evenOddPieces(pieces);
      const m = el.getCTM();
      const at = (p) => (m ? { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f } : { x: p.x, y: p.y });
      parts.push(mapped(asOutline(pieces), at));
    }
    if (!parts.length) throw new Error('Nothing in it is filled or closes on itself, so there is no shape to make. It can still come in as a picture.');
    // ponytail: each part is turned as a whole so parts add up where they
    // overlap; a part that was meant to cut a hole in another part (rare:
    // holes are normally inside one path) comes in solid.
    const all = joined(parts), b = bounds(all), k = SIZE_ON_SHEET / Math.max(b.w, b.h, 1e-6), r = (v) => Math.round(v * 100) / 100;
    return { pts: mapped(all, p => ({ x: r((p.x - b.x) * k), y: r((p.y - b.y) * k) })), w: r(b.w * k), h: r(b.h * k) };
  } finally {
    host.remove();
  }
}

const words = (name) => name.replace(/[-_]+/g, ' ').replace(/^./, ch => ch.toUpperCase());

// → [{ id: 'set:name', name, set, author, licence, url, svg, preview }], best matches first.
// The service limits how often it may be asked, so the drawings come in one
// request for each set rather than one for each icon, and a find already
// holds its own drawing: picking it asks for nothing more.
export async function searchIcons(query, limit = 64) {
  const get = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('The icon search did not answer');
    return res.json();
  };
  const data = await get(`${API}/search?query=${encodeURIComponent(query)}&limit=${limit}&prefixes=${SETS.join(',')}`);
  const sets = data.collections || {}, ids = data.icons || [], bySet = new Map();
  for (const id of ids) { const [prefix, name] = id.split(':'); bySet.set(prefix, [...(bySet.get(prefix) || []), name]); }
  const drawn = new Map(); // id → the icon's SVG
  await Promise.all([...bySet].map(async ([prefix, names]) => {
    const d = await get(`${API}/${prefix}.json?icons=${names.map(encodeURIComponent).join(',')}`);
    for (const name of names) {
      const alias = (d.aliases || {})[name], icon = (d.icons || {})[alias ? alias.parent : name]; // ponytail: an alias that is its parent turned or flipped comes in as the parent
      if (!icon || !icon.body) continue;
      const w = icon.width || d.width || 16, h = icon.height || d.height || 16;
      drawn.set(`${prefix}:${name}`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.left || 0} ${icon.top || 0} ${w} ${h}">${icon.body}</svg>`);
    }
  }));
  return ids.filter(id => drawn.has(id)).map((id) => {
    const [prefix, name] = id.split(':'), info = sets[prefix] || {}, svg = drawn.get(id);
    return {
      id, name: words(name), svg,
      set: info.name || prefix, author: (info.author && info.author.name) || '', licence: (info.license && info.license.title) || '',
      url: (info.license && info.license.url) || (info.author && info.author.url) || '',
      preview: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg),
    };
  });
}

// a find read into a library shape: { name, shape: 'path', pts, w, h, credit }
export function iconShape(icon) {
  const made = svgToShape(icon.svg);
  return { name: icon.name, shape: 'path', ...made, credit: { icon: icon.id, name: icon.name, set: icon.set, author: icon.author, licence: icon.licence, url: icon.url } };
}
