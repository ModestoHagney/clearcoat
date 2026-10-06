// Clearcoat livery brief — driver-facing form (brief.html).
// Single ES module, no dependencies. Pure logic lives in brief-shared.js.

import {
  MOODS, STYLES, FINISHES, CARS, LOGO_MAX_EDGE, LOGO_WARN_BYTES,
  fitWithin, dataUrlBytes, formatBytes, normalizeHex,
  validateBrief, buildBrief, briefFilename, logoNameFromFile, moveItem,
} from './brief-shared.js';

const DRAFT_KEY = 'clearcoat-brief-draft/1';
const OTHER = '__other__';
const $ = (id) => document.getElementById(id);

// ---------- state ----------

const defaultState = () => ({
  driver: { name: '', number: '', custid: '' },
  team: '',
  carChoice: '',
  carOther: '',
  car: '',
  paletteMode: 'colors',
  colors: { primary: '#0b1b3a', secondary: '#ff6a00', accent: '#ffffff' },
  mood: null,
  style: null,
  finish: null,
  logos: [],          // { id, name, src, w, h, bytes }
  notes: '',
});

let state = defaultState();
let touched = new Set();   // fields the user has interacted with — errors only show for these
let submitted = false;     // after a download attempt, show every error

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return;
    state = { ...defaultState(), ...d, driver: { ...defaultState().driver, ...(d.driver || {}) }, colors: { ...defaultState().colors, ...(d.colors || {}) } };
    if (!Array.isArray(state.logos)) state.logos = [];
    state.logos = state.logos.filter((l) => l && typeof l.src === 'string').map((l) => ({ ...l, id: l.id || uid() }));
  } catch { /* storage unavailable or corrupt — start clean */ }
}

let saveTimer = 0;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch {
      // quota (logos too big) — keep everything but the logo pixels
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, logos: [] })); } catch { /* give up quietly */ }
    }
  }, 150);
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- palette helpers ----------

function currentColors() {
  if (state.paletteMode === 'mood') {
    const m = MOODS.find((x) => x.id === state.mood);
    return m ? m.colors : ['#3a3f4a', '#5d636e', '#9aa0ab'];
  }
  const c = state.colors;
  return [normalizeHex(c.primary) || '#000000', normalizeHex(c.secondary) || '#000000', normalizeHex(c.accent) || '#ffffff'];
}

// Side-profile car. The stripe geometry changes with the chosen style so the
// preview hints at the look, not just the colours.
function carSvg([p, s, a], style, { number = '' } = {}) {
  const body = 'M18 62 C 30 40, 70 30, 120 30 L 170 30 C 200 30, 228 38, 262 50 L 300 56 C 316 59, 326 64, 326 72 L 326 84 C 326 90, 320 94, 312 94 L 30 94 C 20 94, 14 88, 14 80 L 14 70 Z';
  const clip = `<clipPath id="cb"><path d="${body}"/></clipPath>`;
  let defs = clip;
  let decor = '';
  switch (style) {
    case 'minimal':
      decor = `<rect x="14" y="80" width="312" height="5" fill="${s}"/><rect x="14" y="86" width="312" height="1.5" fill="${a}"/>`;
      break;
    case 'clean':
      decor = `<path d="M14 94 L 14 70 L 150 70 L 170 94 Z" fill="${s}"/><path d="M160 30 L 200 30 L 230 94 L 190 94 Z" fill="${s}" opacity=".9"/><path d="M192 94 L 232 94 L 234 90 L 194 90 Z" fill="${a}"/>`;
      break;
    case 'bold':
      decor = `<path d="M100 30 L 190 30 L 150 94 L 60 94 Z" fill="${s}"/><path d="M200 30 L 232 32 L 200 94 L 166 94 Z" fill="${a}"/>`;
      break;
    case 'aggressive':
      decor = `<path d="M14 94 L 90 30 L 118 30 L 50 94 Z" fill="${s}"/><path d="M110 94 L 190 30 L 206 30 L 140 94 Z" fill="${s}" opacity=".85"/><path d="M150 94 L 220 36 L 230 40 L 170 94 Z" fill="${a}"/><path d="M230 94 L 300 56 L 326 72 L 260 94 Z" fill="${s}" opacity=".7"/>`;
      break;
    case 'classic':
      decor = `<rect x="14" y="30" width="312" height="64" fill="none"/><path d="M14 56 L 326 56 L 326 70 L 14 70 Z" fill="${s}"/><path d="M14 53 L 326 53 L 326 55 L 14 55 Z" fill="${a}"/><path d="M14 71 L 326 71 L 326 73 L 14 73 Z" fill="${a}"/>`;
      break;
    case 'gradient':
      defs += `<linearGradient id="cg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${p}"/><stop offset=".55" stop-color="${s}"/><stop offset="1" stop-color="${a}"/></linearGradient>`;
      decor = `<rect x="0" y="0" width="340" height="120" fill="url(#cg)"/>`;
      break;
    default:
      decor = `<path d="M14 94 L 14 76 L 326 76 L 326 94 Z" fill="${s}" opacity=".8"/>`;
  }
  const num = number
    ? `<text x="150" y="80" text-anchor="middle" font-family="Khand, 'Arial Narrow', sans-serif" font-weight="700" font-size="30" fill="${a}" stroke="${p}" stroke-width="1.2" paint-order="stroke">${escapeHtml(number)}</text>`
    : '';
  return `<svg viewBox="0 0 340 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Livery colour preview">
  <defs>${defs}</defs>
  <rect width="340" height="120" fill="#0a0b0e"/>
  <ellipse cx="170" cy="102" rx="150" ry="5" fill="#000" opacity=".55"/>
  <g clip-path="url(#cb)"><rect width="340" height="120" fill="${p}"/>${decor}
    <rect x="0" y="30" width="340" height="18" fill="#fff" opacity=".06"/></g>
  <path d="${body}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="1.5"/>
  <path d="M120 33 L 168 33 L 200 50 L 112 50 Z" fill="#0c1016" opacity=".92"/>
  <path d="M124 35 L 166 35 L 188 48 L 118 48 Z" fill="#2a3a4a" opacity=".5"/>
  <circle cx="72" cy="94" r="17" fill="#0a0b0e"/><circle cx="72" cy="94" r="11" fill="#1b1e25"/><circle cx="72" cy="94" r="5" fill="#434957"/>
  <circle cx="262" cy="94" r="17" fill="#0a0b0e"/><circle cx="262" cy="94" r="11" fill="#1b1e25"/><circle cx="262" cy="94" r="5" fill="#434957"/>
  ${num}
</svg>`;
}

// 44×30 glyphs for the style chips — abstract panels, not cars
function styleGlyph(id) {
  const o = '#ff4d00', w = '#e8e6e1', g = '#3a3f4a';
  const map = {
    minimal: `<rect width="44" height="30" fill="${g}"/><rect y="22" width="44" height="2" fill="${o}"/>`,
    clean: `<rect width="44" height="30" fill="${g}"/><path d="M0 30 L0 16 L18 16 L24 30Z" fill="${o}"/><path d="M28 0 L36 0 L44 18 L44 30 L40 30Z" fill="${w}"/>`,
    bold: `<rect width="44" height="30" fill="${g}"/><path d="M10 0 L30 0 L22 30 L2 30Z" fill="${o}"/><path d="M32 0 L40 0 L32 30 L24 30Z" fill="${w}"/>`,
    aggressive: `<rect width="44" height="30" fill="${g}"/><path d="M0 30 L14 0 L20 0 L6 30Z" fill="${o}"/><path d="M14 30 L30 0 L33 0 L17 30Z" fill="${w}"/><path d="M24 30 L44 6 L44 14 L30 30Z" fill="${o}" opacity=".7"/>`,
    classic: `<rect width="44" height="30" fill="${g}"/><rect y="11" width="44" height="8" fill="${o}"/><rect y="9" width="44" height="1.5" fill="${w}"/><rect y="19.5" width="44" height="1.5" fill="${w}"/>`,
    gradient: `<defs><linearGradient id="gg-${id}" x1="0" x2="1"><stop offset="0" stop-color="${g}"/><stop offset=".6" stop-color="${o}"/><stop offset="1" stop-color="${w}"/></linearGradient></defs><rect width="44" height="30" fill="url(#gg-${id})"/>`,
  };
  return `<svg viewBox="0 0 44 30" aria-hidden="true">${map[id] || ''}</svg>`;
}

// CSS backgrounds for the finish balls
const FINISH_BALL = {
  gloss: 'radial-gradient(circle at 32% 28%, #fff 0 8%, rgba(255,255,255,.15) 18%, transparent 30%), radial-gradient(circle at 50% 50%, #ff6a26, #7a1f00 70%)',
  matte: 'radial-gradient(circle at 40% 35%, #d9603a, #8a2e12 75%)',
  satin: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.35) 0 10%, transparent 40%), radial-gradient(circle at 50% 50%, #ef5a2a, #7a2208 75%)',
  metallic: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,.8) 0 6%, transparent 22%), repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.08) 0 1px, transparent 1px 3px), radial-gradient(circle at 50% 50%, #ff6a26, #6a1a00 75%)',
  pearl: 'radial-gradient(circle at 32% 28%, #fff 0 8%, transparent 26%), linear-gradient(135deg, #ffb59e, #ff6a26 40%, #b84cff 75%, #2dd6c1)',
  candy: 'radial-gradient(circle at 32% 28%, #fff 0 7%, rgba(255,255,255,.2) 20%, transparent 32%), radial-gradient(circle at 50% 60%, #ff2a3a, #4a0010 80%)',
  chrome: 'radial-gradient(circle at 32% 28%, #fff 0 10%, transparent 28%), linear-gradient(180deg, #f4f6f9 0 46%, #39414f 50%, #9aa3b4 100%)',
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- build static chip groups ----------

function buildCarSelect() {
  const sel = $('f-car');
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = 'Choose a car…'; ph.disabled = true;
  sel.appendChild(ph);
  for (const c of CARS) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c; sel.appendChild(o);
  }
  const other = document.createElement('option');
  other.value = OTHER; other.textContent = 'Other / not listed…';
  sel.appendChild(other);
}

function chip({ id, label, desc, lead }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.id = id;
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `${lead}<span class="chip-text"><span class="chip-label">${escapeHtml(label)}</span>${desc ? `<span class="chip-desc">${escapeHtml(desc)}</span>` : ''}</span>`;
  return b;
}

function buildChips() {
  const moods = $('chips-mood');
  for (const m of MOODS) {
    const tri = `<span class="tri" aria-hidden="true"><span style="background:${m.colors[0]}"></span><span style="background:${m.colors[1]}"></span><span style="background:${m.colors[2]}"></span></span>`;
    moods.appendChild(chip({ id: m.id, label: m.label, lead: tri }));
  }
  const styles = $('chips-style');
  for (const s of STYLES) {
    styles.appendChild(chip({ id: s.id, label: s.label, desc: s.desc, lead: `<span class="glyph">${styleGlyph(s.id)}</span>` }));
  }
  const finishes = $('chips-finish');
  for (const f of FINISHES) {
    finishes.appendChild(chip({ id: f.id, label: f.label, desc: f.desc, lead: `<span class="finish-ball" aria-hidden="true" style="--ball:${FINISH_BALL[f.id]}"></span>` }));
  }

  const bindGroup = (el, key, field) => {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      state[key] = b.dataset.id;
      touched.add(field);
      render(); saveDraft();
    });
    // arrow keys move between chips like a radio group
    el.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const chips = [...el.querySelectorAll('.chip')];
      const i = chips.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const next = chips[(i + dir + chips.length) % chips.length];
      next.focus(); next.click();
    });
  };
  bindGroup(moods, 'mood', 'palette');
  bindGroup(styles, 'style', 'style');
  bindGroup(finishes, 'finish', 'finish');
}

// ---------- render ----------

function setPressed(groupEl, value) {
  for (const b of groupEl.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.id === value));
}

function render() {
  const errors = validateBrief(state);
  const showErr = (field, inputEl) => {
    const el = $('err-' + field);
    const visible = !!errors[field] && (submitted || touched.has(field));
    el.textContent = visible ? errors[field] : '';
    el.classList.toggle('show', visible);
    if (inputEl) inputEl.setAttribute('aria-invalid', String(visible));
  };

  // who
  showErr('name', $('f-name'));
  showErr('number', $('f-number'));
  showErr('custid', $('f-custid'));
  // car
  $('car-other-wrap').hidden = state.carChoice !== OTHER;
  showErr('car', $('f-car'));
  // palette
  $('pal-pick').setAttribute('aria-pressed', String(state.paletteMode !== 'mood'));
  $('pal-mood').setAttribute('aria-pressed', String(state.paletteMode === 'mood'));
  $('pal-colors').hidden = state.paletteMode === 'mood';
  $('pal-moods').hidden = state.paletteMode !== 'mood';
  setPressed($('chips-mood'), state.mood);
  for (const k of ['primary', 'secondary', 'accent']) {
    const hex = normalizeHex(state.colors[k]) || '#000000';
    $('c-' + k).parentElement.style.setProperty('--sw', hex);
    $('hex-' + k).textContent = hex;
  }
  showErr('palette');
  const colors = currentColors();
  $('livery-preview').innerHTML = carSvg(colors, state.style);
  // style / finish
  setPressed($('chips-style'), state.style);
  setPressed($('chips-finish'), state.finish);
  showErr('style');
  showErr('finish');
  // logos
  renderLogos();
  // summary
  renderSummary(errors, colors);
  // progress: six "sections" — who, car, colours, style, finish, plus logos-or-notes counts when anything's there
  const done = [
    !errors.name && !errors.number && !errors.custid,
    !errors.car,
    !errors.palette,
    !errors.style,
    !errors.finish,
    state.logos.length > 0 || state.notes.trim().length > 0,
  ].filter(Boolean).length;
  $('progress').innerHTML = `<b>${done}</b> / 6 done`;
}

function renderSummary(errors, colors) {
  const d = state.driver;
  const set = (id, val, fallback = '—') => {
    const el = $(id);
    el.textContent = val || fallback;
    el.classList.toggle('dim', !val);
  };
  set('sum-name', d.name.trim() ? `${d.name.trim()}${d.custid.trim() ? ` · #${d.custid.trim()}` : ''}` : '');
  set('sum-car', state.car.trim());
  set('sum-team', state.team.trim(), 'no team');
  if (state.paletteMode === 'mood') {
    const m = MOODS.find((x) => x.id === state.mood);
    set('sum-palette', m ? `${m.label} mood — designer picks` : '', 'pick a mood');
  } else {
    set('sum-palette', colors.join(' · '));
  }
  set('sum-style', STYLES.find((s) => s.id === state.style)?.label || '', 'not chosen');
  set('sum-finish', FINISHES.find((f) => f.id === state.finish)?.label || '', 'not chosen');
  const sl = $('sum-logos');
  if (state.logos.length) {
    sl.classList.remove('dim');
    sl.innerHTML = `<span class="sum-chips">${state.logos.map((l, i) => `<span class="${i === 0 ? 'main' : ''}">${i + 1}. ${escapeHtml(l.name)}</span>`).join('')}</span>`;
  } else {
    sl.classList.add('dim'); sl.textContent = 'none yet';
  }
  $('sum-svg').innerHTML = carSvg(colors, state.style);
  $('sum-num').textContent = d.number.trim() ? `#${d.number.trim()}` : '';

  const ok = Object.keys(errors).length === 0;
  const rd = $('readiness');
  rd.classList.toggle('ok', ok);
  const missing = [];
  if (errors.name) missing.push('name');
  if (errors.number) missing.push('number');
  if (errors.custid) missing.push('customer ID');
  if (errors.car) missing.push('car');
  if (errors.palette) missing.push('colours');
  if (errors.style) missing.push('style');
  if (errors.finish) missing.push('finish');
  $('readiness-text').textContent = ok
    ? `Ready — this downloads as ${briefFilename(d.name, d.number)}`
    : `Still needed: ${missing.join(', ')}.`;
  $('btn-download').disabled = !ok;
  $('btn-copy').disabled = !ok;
}

// ---------- logos ----------

function totalLogoBytes() { return state.logos.reduce((n, l) => n + (l.bytes || 0), 0); }

function renderLogos() {
  const list = $('logo-list');
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  list.innerHTML = '';
  state.logos.forEach((l, i) => {
    let li = existing.get(l.id);
    if (!li) li = logoRow(l);
    li.dataset.index = i;
    li.querySelector('.rank').textContent = i + 1;
    li.querySelector('.rank').setAttribute('aria-label', `Logo ${i + 1} of ${state.logos.length}, ${l.name}. Press up or down arrow to reorder.`);
    li.querySelector('.tag').textContent = i === 0 ? 'main sponsor' : `priority ${i + 1}`;
    li.querySelector('.up').disabled = i === 0;
    li.querySelector('.down').disabled = i === state.logos.length - 1;
    list.appendChild(li);
  });
  const foot = $('logo-foot');
  foot.hidden = state.logos.length === 0;
  const bytes = totalLogoBytes();
  const sizeEl = $('logo-size');
  sizeEl.textContent = `${state.logos.length} logo${state.logos.length === 1 ? '' : 's'} · ${formatBytes(bytes)}` + (bytes > LOGO_WARN_BYTES ? ' — large; the file may be slow to share' : '');
  sizeEl.classList.toggle('warn', bytes > LOGO_WARN_BYTES);
}

function logoRow(l) {
  const li = document.createElement('li');
  li.className = 'logo-item';
  li.dataset.id = l.id;
  li.draggable = true;
  li.innerHTML = `
    <span class="rank" tabindex="0" role="button">1</span>
    <img class="thumb" alt="" src="${l.src}">
    <div class="meta">
      <input type="text" value="${escapeHtml(l.name)}" aria-label="Logo name" maxlength="40">
      <small><span class="tag">main sponsor</span> · ${l.w}×${l.h} · ${formatBytes(l.bytes)}</small>
    </div>
    <div class="actions">
      <button type="button" class="icon-btn up" aria-label="Move up">&#9650;</button>
      <button type="button" class="icon-btn down" aria-label="Move down">&#9660;</button>
      <button type="button" class="icon-btn del" aria-label="Remove logo">&#10005;</button>
    </div>`;
  const idx = () => state.logos.findIndex((x) => x.id === l.id);
  li.querySelector('input').addEventListener('input', (e) => { l.name = e.target.value; renderSummary(validateBrief(state), currentColors()); saveDraft(); });
  li.querySelector('.up').addEventListener('click', () => { const i = idx(); state.logos = moveItem(state.logos, i, i - 1); render(); saveDraft(); });
  li.querySelector('.down').addEventListener('click', () => { const i = idx(); state.logos = moveItem(state.logos, i, i + 1); render(); saveDraft(); });
  li.querySelector('.del').addEventListener('click', () => { state.logos = state.logos.filter((x) => x.id !== l.id); render(); saveDraft(); toast(`Removed ${l.name}`); });
  li.querySelector('.rank').addEventListener('keydown', (e) => {
    const i = idx();
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); state.logos = moveItem(state.logos, i, i - 1); render(); saveDraft(); li.querySelector('.rank').focus(); }
    if (e.key === 'ArrowDown' && i < state.logos.length - 1) { e.preventDefault(); state.logos = moveItem(state.logos, i, i + 1); render(); saveDraft(); li.querySelector('.rank').focus(); }
  });
  // drag to reorder
  li.addEventListener('dragstart', (e) => { dragId = l.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', l.id); } catch { /* ignore */ } });
  li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); clearDropMarks(); });
  li.addEventListener('dragover', (e) => {
    if (!dragId || dragId === l.id) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const below = e.clientY > r.top + r.height / 2;
    clearDropMarks();
    li.classList.add(below ? 'drop-below' : 'drop-above');
  });
  li.addEventListener('drop', (e) => {
    if (!dragId || dragId === l.id) return;
    e.preventDefault();
    const from = state.logos.findIndex((x) => x.id === dragId);
    let to = idx();
    const r = li.getBoundingClientRect();
    const below = e.clientY > r.top + r.height / 2;
    if (below && from > to) to += 1;
    if (!below && from < to) to -= 1;
    state.logos = moveItem(state.logos, from, to);
    dragId = null; clearDropMarks(); render(); saveDraft();
  });
  return li;
}

let dragId = null;
function clearDropMarks() {
  for (const el of document.querySelectorAll('.logo-item.drop-above, .logo-item.drop-below')) el.classList.remove('drop-above', 'drop-below');
}

// Decode → downscale (longest edge ≤ LOGO_MAX_EDGE) → PNG data URL.
async function processLogoFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('not an image'));
      im.src = url;
    });
    // SVGs without intrinsic size report 0 — give them a sensible canvas
    const nw = img.naturalWidth || 1024, nh = img.naturalHeight || 1024;
    const { w, h } = fitWithin(nw, nh, LOGO_MAX_EDGE);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const src = cv.toDataURL('image/png');
    return { id: uid(), name: logoNameFromFile(file.name), src, w, h, bytes: dataUrlBytes(src) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function addFiles(files) {
  const list = [...files].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|svg)$/i.test(f.name));
  if (!list.length) { toast('Those weren\'t image files', true); return; }
  let added = 0, failed = 0;
  for (const f of list) {
    try { state.logos.push(await processLogoFile(f)); added++; }
    catch { failed++; }
  }
  render(); saveDraft();
  if (failed) toast(`${added} added, ${failed} couldn't be read`, true);
  else toast(`${added} logo${added === 1 ? '' : 's'} added`);
}

// ---------- output ----------

function briefJson() { return JSON.stringify(buildBrief(state), null, 2); }

function download() {
  submitted = true;
  const errors = validateBrief(state);
  if (Object.keys(errors).length) {
    render();
    const first = document.querySelector('.err.show');
    first?.closest('.section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('A few things still need filling in', true);
    return;
  }
  const json = briefJson();
  const name = briefFilename(state.driver.name, state.driver.number);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  $('btn-download').classList.remove('flash'); void $('btn-download').offsetWidth; $('btn-download').classList.add('flash');
  toast(`Saved ${name} — send it to your designer`);
}

async function copyJson() {
  submitted = true;
  if (Object.keys(validateBrief(state)).length) { render(); toast('A few things still need filling in', true); return; }
  const json = briefJson();
  try {
    await navigator.clipboard.writeText(json);
    toast('Brief copied — paste it to your designer');
  } catch {
    // clipboard blocked (http, permissions) — fall back to a selectable textarea
    const ta = document.createElement('textarea');
    ta.value = json; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    toast(ok ? 'Brief copied — paste it to your designer' : 'Copy blocked by the browser — use Download instead', !ok);
  }
  $('btn-copy').classList.remove('flash'); void $('btn-copy').offsetWidth; $('btn-copy').classList.add('flash');
}

function reset() {
  if (!confirm('Start over? This clears everything you\'ve entered on this device.')) return;
  state = defaultState();
  touched = new Set(); submitted = false;
  clearDraft();
  syncInputsFromState();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Cleared');
}

let toastTimer = 0;
function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- inputs ----------

function syncInputsFromState() {
  $('f-name').value = state.driver.name;
  $('f-number').value = state.driver.number;
  $('f-custid').value = state.driver.custid;
  $('f-team').value = state.team;
  const sel = $('f-car');
  if (state.carChoice && [...sel.options].some((o) => o.value === state.carChoice)) sel.value = state.carChoice;
  else sel.value = '';
  $('f-car-other').value = state.carOther;
  for (const k of ['primary', 'secondary', 'accent']) $('c-' + k).value = normalizeHex(state.colors[k]) || '#000000';
  $('f-notes').value = state.notes;
}

function recomputeCar() {
  state.car = state.carChoice === OTHER ? state.carOther : (state.carChoice || '');
}

function bindInputs() {
  const bind = (id, fn, field) => {
    const el = $(id);
    el.addEventListener('input', (e) => { fn(e.target.value); if (field) touched.add(field); render(); saveDraft(); });
    el.addEventListener('blur', () => { if (field) { touched.add(field); render(); } });
  };
  bind('f-name', (v) => { state.driver.name = v; }, 'name');
  bind('f-number', (v) => { state.driver.number = v.replace(/\s+/g, '').slice(0, 3); $('f-number').value = state.driver.number; }, 'number');
  bind('f-custid', (v) => { state.driver.custid = v.trim(); }, 'custid');
  bind('f-team', (v) => { state.team = v; });
  bind('f-car-other', (v) => { state.carOther = v; recomputeCar(); }, 'car');
  bind('f-notes', (v) => { state.notes = v; });
  $('f-car').addEventListener('change', (e) => {
    state.carChoice = e.target.value; recomputeCar(); touched.add('car');
    render(); saveDraft();
    if (state.carChoice === OTHER) $('f-car-other').focus();
  });
  for (const k of ['primary', 'secondary', 'accent']) {
    $('c-' + k).addEventListener('input', (e) => { state.colors[k] = e.target.value; touched.add('palette'); render(); saveDraft(); });
  }
  $('pal-pick').addEventListener('click', () => { state.paletteMode = 'colors'; render(); saveDraft(); });
  $('pal-mood').addEventListener('click', () => { state.paletteMode = 'mood'; touched.add('palette'); render(); saveDraft(); });

  // logos
  const drop = $('drop');
  $('f-logos').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('f-logos').click(); } });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { if (dragId) return; e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { if (dragId) return; e.preventDefault(); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
  // page-wide drop (anywhere) also lands in logos, but never hijacks logo reordering
  document.addEventListener('dragover', (e) => { if (!dragId) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (!dragId && e.dataTransfer?.files?.length && !e.target.closest('#drop')) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  $('btn-download').addEventListener('click', download);
  $('btn-copy').addEventListener('click', copyJson);
  $('btn-reset').addEventListener('click', reset);
  $('brief-form').addEventListener('submit', (e) => { e.preventDefault(); download(); });
}

// ---------- boot ----------

buildCarSelect();
buildChips();
loadDraft();
recomputeCar();
syncInputsFromState();
bindInputs();
render();

// offline: same service worker as the editor (skipped with ?nosw=1 for tests)
if ('serviceWorker' in navigator && !/[?&]nosw=1/.test(location.search) && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

// test hook — read-only view of the state and the exact JSON the download emits
window.__brief = { get state() { return state; }, json: briefJson };
