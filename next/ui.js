// Clearcoat, new screen: everything around the canvas — menus, tool strip,
// the panel cards, dialogs, the right-click menu and the toast. It reads the
// app state and calls back into `actions`; it holds no livery state itself.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const I = { // 20x20 line icons
  select: '<path d="M5 3v12l3.5-3 2.2 5 2-.9-2.2-5H15z"/>',
  pen: '<path d="M4 15 7 5l9 2-3 9z"/><circle cx="4" cy="15" r="1.4"/><circle cx="7" cy="5" r="1.4"/><circle cx="16" cy="7" r="1.4"/><circle cx="13" cy="16" r="1.4"/>',
  ellipse: '<circle cx="10" cy="10" r="6.5"/>',
  rect: '<rect x="4" y="4.5" width="12" height="11" rx="1"/>',
  triangle: '<path d="M10 4 17 16H3z"/>',
  edit: '<path d="M4 16h3l8-8-3-3-8 8z"/><path d="m11 6 3 3"/>',
  band: '<path d="M3 13 13 3M7 17 17 7"/>',
  text: '<path d="M4 5h12M10 5v11M8 16h4"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.3"/><path d="m4 14 4-3.5 3 2.5 2-1.5 3 2.5"/>',
  piece: '<path d="M3 13c2-6 5-8 9-8l5 3v5H3z"/><path d="M9 5.5V13"/>',
  eye: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.2"/>',
  float: '<rect x="4" y="4" width="9" height="9" rx="1.5"/><path d="M8 16h8V8"/>',
  dock: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M12 4v12"/>',
  fold: '<path d="m5 8 5 5 5-5"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  dropper: '<path d="M4 16v-2.5l6.5-6.5 2.5 2.5L6.5 16z"/><path d="m9.5 6 4.5 4.5"/><path d="m12 7.5 2.2-2.2a1.6 1.6 0 0 1 2.3 2.3l-2.2 2.2"/>',
};
const svg = (name) => `<svg viewBox="0 0 20 20">${I[name]}</svg>`;

// [id, name, built yet?] — the strip shows the whole Paint set so the layout
// is the final one; tools from later stages are dimmed.
const TOOLS = [
  ['select', 'Select (V)', true],
  ['pen', 'Pen (P)', true],
  ['shape', 'Shape (S)', true],
  ['band', 'Straight band (B)', true],
  ['text', 'Text', false],
  ['image', 'Image or logo', false],
  ['piece', 'Fill a piece', false],
];
const LATER = 'later stage';
const PANELS = ['layers', 'props', 'colour'];
const KINDS = { ellipse: 'Circle', rect: 'Box', triangle: 'Triangle' };
const hexOf = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v).trim()) ? '#' + String(v).trim().replace('#', '').toLowerCase() : null);
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
const hexOfRgb = (v) => {
  const n = String(v).split(/[^\d]+/).filter(Boolean).map(Number);
  return n.length === 3 && n.every((x) => x >= 0 && x <= 255) ? '#' + n.map((x) => x.toString(16).padStart(2, '0')).join('') : null;
};

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
  const layerItems = () => [
    ['Copy', 'Ctrl+C', 'copy', { off: !hasLayer() }], ['Paste', 'Ctrl+V', 'paste', { off: !app.clipboard }], ['Duplicate', 'Ctrl+D', 'duplicate', { off: !hasLayer() }], 0,
    ['Bring forward', 'Ctrl+]', 'forward', { off: !hasLayer() }], ['Send backward', 'Ctrl+[', 'backward', { off: !hasLayer() }], 0,
    ['Delete', 'Del', 'remove', { off: !hasLayer() }],
  ];
  const menuDefs = () => ({
    File: [
      ['New', '', 'newLivery'], ['Open…', '', 'open'], ['Save', 'Ctrl+S', 'save'], 0,
      ['Load template…', '', 'pickTemplate'], ['Car setup…', '', 'carSetup'], ['Link iRacing folder…', '', 'linkFolder'], ['Save to iRacing', '', 'saveIracing'], 0,
      ['Export TGA', '', 'exportTga'], ['Export PNG', '', 'exportPng'],
    ],
    Edit: [
      ['Undo', 'Ctrl+Z', 'undo', { off: !app.canUndo }], ['Redo', 'Ctrl+Y', 'redo', { off: !app.canRedo }], 0,
      ...layerItems(), 0,
      ['Merge layers', '', '', { off: true }],
    ],
    View: [
      ['Layers', '', 'show:layers', { tick: app.show.layers }], ['Properties', '', 'show:props', { tick: app.show.props }], ['Colour', '', 'show:colour', { tick: app.show.colour }], 0,
      ['Piece outlines', '', 'show:outlines', { tick: app.show.outlines }], ['Template lines', '', 'show:lines', { tick: app.show.lines }], 0,
      ['Light', '', 'theme:light', { tick: app.theme === 'light' }], ['Dark', '', 'theme:dark', { tick: app.theme === 'dark' }], ['Match system', '', 'theme:system', { tick: app.theme === 'system' }], 0,
      ['Fit to screen', 'F', 'fit'],
    ],
    Help: [['Shortcuts…', '?', 'shortcuts'], ['About…', '', 'about']],
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
      `<button data-mode="${id}" aria-pressed="${app.mode === id}"${id === 'paint' ? '' : ` disabled title="Comes in a ${LATER}"`}>${name}</button>`).join('');
    $('tools').innerHTML = TOOLS.map(([id, name, ready]) =>
      `<button class="tool" data-tool="${id}" data-tip="${ready ? name : `${name} · ${LATER}`}" aria-label="${name}" aria-pressed="${app.tool === id}"${ready ? '' : ' disabled'}>${svg(id === 'shape' ? app.shapeKind : id)}</button>`).join('');
    // the armed tool's own choices sit right beside the strip
    const opts = $('toolopts');
    if (app.tool === 'shape') {
      opts.innerHTML = Object.entries(KINDS).map(([k, name]) => `<button class="tool" data-kind="${k}" data-tip="${name}" aria-label="${name}" aria-pressed="${app.shapeKind === k}">${svg(k)}</button>`).join('');
    } else if (app.tool === 'band') {
      opts.innerHTML = `<label class="optrow"><span>Width</span><input id="f-band" type="range" min="4" max="300" value="${app.bandWidth}"><output id="f-band-n" class="num">${app.bandWidth}</output></label>`;
    }
    opts.hidden = app.tool !== 'shape' && app.tool !== 'band';
    $('hint').textContent = actions.hint();
    const live = $('btn-live');
    live.setAttribute('aria-pressed', app.live);
    live.classList.toggle('bad', app.live && app.liveBad);
    for (const key of PANELS) panels[key].hidden = !app.show[key];
    $('dock').hidden = ![...$('dock').children].some((p) => !p.hidden);
  }

  // ---------- panels ----------
  const swatch = (l) => {
    if (l.type === 'fill' && l.color) return `background:${esc(l.color)}`;
    // ponytail: the layer's own picture as the swatch; skip the very large ones
    if (l.src && l.src.length < 300000 && /^data:image\/[\w+.-]+;base64,[\w+/=]+$/.test(l.src)) return `background-image:url(${l.src})`;
    return 'background:var(--hover)';
  };
  function layersHtml() {
    const d = app.doc;
    const rows = [...d.layers].reverse().map((l) =>
      `<div class="row${l.id === app.sel ? ' sel' : ''}" data-layer="${esc(l.id)}"><span class="sw" style="${swatch(l)}"></span><span class="name">${esc(l.name)}</span><button class="eye${l.visible ? '' : ' off'}" data-eye="${esc(l.id)}" title="Show or hide" aria-label="Show or hide ${esc(l.name)}">${svg('eye')}</button></div>`);
    rows.push(`<div class="row${app.sel === 'base' ? ' sel' : ''}" data-layer="base"><span class="sw" style="background:${esc(d.baseColor)}"></span><span class="name">Base coat</span></div>`);
    return rows.join('');
  }
  const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
  const colourField = (id, c) => field('Colour', `<span class="pair"><input data-colour="pick" id="${id}" type="color" value="${esc(c)}"><input data-colour="hex" id="${id}-hex" class="mono" type="text" maxlength="7" spellcheck="false" value="${esc(c)}"></span>`);
  function propsHtml() {
    if (app.sel === 'base') return colourField('f-base', app.doc.baseColor);
    const l = app.doc.layers.find((x) => x.id === app.sel);
    if (!l) return '<div class="note">Nothing selected</div>';
    const colour = l.type === 'fill' && hexOf(l.color || '') ? colourField('f-colour', l.color) : '';
    return colour + field('Name', `<input id="f-name" type="text" value="${esc(l.name)}">`) +
      field('Opacity', `<input id="f-opacity" type="range" min="0" max="100" value="${Math.round((l.opacity ?? 1) * 100)}">`);
  }
  // colours in use, most used first
  function usedColours() {
    const n = new Map();
    const add = (c) => { const h = hexOf(c || ''); if (h) n.set(h, (n.get(h) || 0) + 1); };
    add(app.doc.baseColor);
    for (const l of app.doc.layers) if (l.type === 'fill' && l.visible) add(l.color);
    return [...n].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 14);
  }
  function colourHtml() {
    const d = app.doc, cur = actions.currentColour(), sel = actions.selected();
    const linked = app.sel === 'base' ? d.baseRef : sel ? sel.colorRef : null;
    const saved = d.palette.map((c) => `<span class="chipwrap"><button class="chip${c.id === linked ? ' on' : ''}" data-pal="${esc(c.id)}"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</button><button class="chipedit" data-edit="${esc(c.id)}" title="Rename or change" aria-label="Edit ${esc(c.name)}">${svg('edit')}</button></span>`).join('');
    const used = usedColours();
    return `<div class="sub">Saved with this livery</div><div class="chips">${saved}<button class="chip add" data-act="saveColour" title="Save the current colour">+ Save</button></div>` +
      (used.length ? `<div class="sub">In this livery</div><div class="dots">${used.map((c) => `<button class="dot" data-col="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="${c}"></button>`).join('')}</div>` : '') +
      `<div class="cur"><input data-colour="pick" id="c-pick" type="color" value="${esc(cur)}" aria-label="Colour"><button class="icon${app.picking ? ' on' : ''}" data-act="pickColour" title="Pick a colour from the sheet (I)" aria-label="Pick a colour from the sheet">${svg('dropper')}</button><span class="ways">${Object.keys(app.ways).map((w) => `<button data-way="${w}" aria-pressed="${app.ways[w]}">${w}</button>`).join('')}</span></div>` +
      (app.ways.Hex ? field('Hex', `<input data-colour="hex" id="c-hex" class="mono" type="text" maxlength="7" spellcheck="false" value="${esc(cur)}">`) : '') +
      (app.ways.RGB ? field('RGB', `<input data-colour="rgb" id="c-rgb" class="mono" type="text" spellcheck="false" value="${rgbOf(cur)}">`) : '');
  }
  function drawPanels() {
    panels.layers.querySelector('h2').textContent = 'Layers';
    panels.props.querySelector('h2').textContent = 'Properties';
    panels.colour.querySelector('h2').textContent = 'Colour';
    panels.layers.querySelector('.body').innerHTML = layersHtml();
    panels.props.querySelector('.body').innerHTML = propsHtml();
    panels.colour.querySelector('.body').innerHTML = colourHtml();
  }
  const refreshChrome = () => drawChrome();
  const refresh = () => { drawChrome(); drawPanels(); };

  // controls inside Properties: these must not rebuild the panel they sit in
  // Every colour control, in whichever panel, is one of three kinds (a colour
  // box, a hex box, an RGB box). Typing in one updates the others in place.
  document.addEventListener('input', (e) => {
    const t = e.target, kind = t.dataset ? t.dataset.colour : null;
    if (!kind) return;
    const v = kind === 'rgb' ? hexOfRgb(t.value) : hexOf(t.value);
    if (!v) return; // half-typed
    for (const el of document.querySelectorAll('[data-colour]')) {
      if (el === t) continue;
      el.value = el.dataset.colour === 'rgb' ? rgbOf(v) : v;
    }
    const sw = panels.layers.querySelector(`[data-layer="${CSS.escape(String(app.sel))}"] .sw`);
    if (sw && (app.sel === 'base' || (actions.selected() || {}).type === 'fill')) sw.style.background = v;
    actions.setColour(v);
  });
  panels.props.addEventListener('input', (e) => {
    const t = e.target;
    const layer = app.doc.layers.find((x) => x.id === app.sel);
    if (t.id === 'f-opacity' && layer) {
      layer.opacity = t.value / 100;
      actions.change({ panels: false });
    }
  });
  $('toolopts').addEventListener('input', (e) => {
    if (e.target.id !== 'f-band') return;
    $('f-band-n').textContent = e.target.value;
    actions.setBandWidth(+e.target.value);
  });
  // a saved colour is renamed, changed or deleted from its chip
  const editChip = (e) => {
    const chip = e.target.closest('.chipwrap');
    if (!chip) return;
    e.preventDefault();
    actions.editColour(chip.querySelector('[data-pal]').dataset.pal);
  };
  panels.colour.addEventListener('contextmenu', editChip);
  panels.colour.addEventListener('dblclick', editChip);
  panels.props.addEventListener('change', (e) => {
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
      (cur.cars.length ? `<label><span>Car folder</span><select id="cs-car">${opt('', '(' + cur.folder + ')', !cur.car)}${cur.cars.map((c) => opt(c, c, c === cur.car)).join('')}</select></label>` : '') +
      `<div class="note">${cur.folder ? 'Folder linked: ' + esc(cur.folder) : 'No iRacing folder linked yet.'}</div>`;
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
  const shortcuts = () => ask({
    title: 'Shortcuts', ok: 'Close', cancel: null,
    body: '<table>' + [
      ['Pan', 'Space-drag, middle-drag'], ['Zoom', 'Wheel, + and −'], ['Fit to screen', 'F'],
      ['Select, Pen, Shape, Band', 'V, P, S, B'], ['Pick a colour from the sheet', 'I'], ['Finish a pen shape', 'Enter'], ['Undo the last point', 'Backspace'], ['Hold 45°', 'Shift'],
      ['Copy, paste, duplicate', 'Ctrl+C, V, D'], ['Nudge 1 px, 10 px', 'Arrows, Shift+Arrows'], ['Forward, backward', 'Ctrl+], Ctrl+['], ['Delete', 'Del'],
      ['Undo, redo', 'Ctrl+Z, Ctrl+Y'], ['Save', 'Ctrl+S'],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('') + '</table>',
  });
  const about = () => ask({ title: 'Clearcoat', ok: 'Close', cancel: null, body: `<div class="note">New screen, ${esc(version)}</div><div class="note"><a href="../">Open the original screen</a></div>` });

  // ---------- clicks ----------
  const run = (act) => {
    if (!act) return;
    if (act.startsWith('show:')) { const k = act.slice(5); app.show[k] = !app.show[k]; actions.change({ panels: false }); return; }
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
    if (t.dataset.tool) return actions.setTool(t.dataset.tool);
    if (t.dataset.edit) return actions.editColour(t.dataset.edit);
    if (t.dataset.pal) return actions.usePalette(t.dataset.pal);
    if (t.dataset.col) return actions.applyColour(t.dataset.col);
    if (t.dataset.way) return actions.setWay(t.dataset.way);
    if (t.dataset.kind) return actions.setShapeKind(t.dataset.kind);
    if (t.dataset.eye) {
      const l = app.doc.layers.find((x) => x.id === t.dataset.eye);
      if (l) { l.visible = !l.visible; actions.change(); }
      return;
    }
    if (t.dataset.layer) return actions.select(t.dataset.layer);
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
      drawChrome();
    }
  });

  // right-click menu on the sheet
  $('stage').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.panel')) return;
    e.preventDefault();
    document.querySelector('.ctx')?.remove();
    const m = document.createElement('div'), box = $('stage').getBoundingClientRect();
    m.className = 'drop ctx';
    m.innerHTML = [...layerItems(), 0, ['Fit to screen', 'F', 'fit']].map(itemHtml).join('');
    $('stage').append(m);
    m.style.left = Math.max(4, Math.min(e.clientX - box.left, box.width - m.offsetWidth - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(e.clientY - box.top, box.height - m.offsetHeight - 4)) + 'px';
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

  return { refresh, refreshChrome, say, ask, askText, pickProject, carSetup, shortcuts, editColour };
}
