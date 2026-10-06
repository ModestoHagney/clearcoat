// Clearcoat livery brief — pure, DOM-free parts shared by the driver form
// (brief.html) and the node tests. The brief format itself is
// "clearcoat-brief/1"; the validator lives with the generator, so anything
// here that shapes the output must match that schema exactly.

export const BRIEF_FORMAT = 'clearcoat-brief/1';

// Mood palettes — identical table to the generator's. Order = chip order.
export const MOODS = [
  { id: 'night',    label: 'Night',    colors: ['#0b1b3a', '#ff6a00', '#ffffff'] },
  { id: 'sunset',   label: 'Sunset',   colors: ['#2a0a3a', '#ff4e50', '#f9d423'] },
  { id: 'forest',   label: 'Forest',   colors: ['#0f2f1f', '#9acd32', '#f4f1de'] },
  { id: 'ice',      label: 'Ice',      colors: ['#e8f1f8', '#1b6ca8', '#0a1a2a'] },
  { id: 'fire',     label: 'Fire',     colors: ['#1a0505', '#ff2a00', '#ffb400'] },
  { id: 'military', label: 'Military', colors: ['#2f3a24', '#6b7a4b', '#d8c58a'] },
  { id: 'retro',    label: 'Retro',    colors: ['#f2e8cf', '#d1495b', '#1d3557'] },
  { id: 'neon',     label: 'Neon',     colors: ['#0a0a0f', '#39ff14', '#ff2d95'] },
  { id: 'royal',    label: 'Royal',    colors: ['#1a0b3d', '#ffd700', '#ffffff'] },
  { id: 'mono',     label: 'Mono',     colors: ['#111111', '#ffffff', '#ff3b3b'] },
];

export const MOOD_IDS = MOODS.map((m) => m.id);

export const STYLES = [
  { id: 'minimal',    label: 'Minimal',    desc: 'One colour, a single stripe, lots of air.' },
  { id: 'clean',      label: 'Clean',      desc: 'Two-tone blocks, sharp edges, sponsor-ready.' },
  { id: 'bold',       label: 'Bold',       desc: 'Big shapes, heavy contrast, reads from the grandstand.' },
  { id: 'aggressive', label: 'Aggressive', desc: 'Slashes, splinters and speed lines.' },
  { id: 'classic',    label: 'Classic',    desc: 'Centre stripes and roundels, Le Mans heritage.' },
  { id: 'gradient',   label: 'Gradient',   desc: 'Colours melt into each other along the car.' },
];

export const STYLE_IDS = STYLES.map((s) => s.id);

export const FINISHES = [
  { id: 'gloss',    label: 'Gloss',    desc: 'Wet-look showroom shine' },
  { id: 'matte',    label: 'Matte',    desc: 'Flat, no reflections' },
  { id: 'satin',    label: 'Satin',    desc: 'Soft sheen between the two' },
  { id: 'metallic', label: 'Metallic', desc: 'Fine flake in the paint' },
  { id: 'pearl',    label: 'Pearl',    desc: 'Colour shifts with the angle' },
  { id: 'candy',    label: 'Candy',    desc: 'Deep tinted clear over metal' },
  { id: 'chrome',   label: 'Chrome',   desc: 'Mirror finish' },
];

export const FINISH_IDS = FINISHES.map((f) => f.id);

// Common iRacing endurance cars. Free text "other" is appended by the form.
export const CARS = [
  'Dallara P217',
  'Acura ARX-06 GTP',
  'BMW M Hybrid V8',
  'Cadillac V-Series.R GTP',
  'Ferrari 499P',
  'Porsche 963 GTP',
  'Ligier JS P320',
  'Audi R8 LMS EVO II GT3',
  'BMW M4 GT3',
  'Chevrolet Corvette Z06 GT3.R',
  'Ferrari 296 GT3',
  'Ford Mustang GT3',
  'Lamborghini Huracán GT3 EVO',
  'McLaren 720S GT3 EVO',
  'Mercedes-AMG GT3 2020',
  'Porsche 911 GT3 R (992)',
  'Aston Martin Vantage GT4',
  'BMW M4 G82 GT4',
  'Mercedes-AMG GT4',
  'Porsche 718 Cayman GT4 Clubsport MR',
  'Toyota GR86',
  'Global Mazda MX-5 Cup',
];

export const LOGO_MAX_EDGE = 1024;          // px, longest edge after downscale
export const LOGO_WARN_BYTES = 1.5 * 1024 * 1024;

// Downscale maths: fit (w, h) inside a square of `max` while preserving the
// aspect ratio, never upscaling, never returning less than 1 px.
export function fitWithin(w, h, max = LOGO_MAX_EDGE) {
  w = Math.max(1, Math.round(w || 1));
  h = Math.max(1, Math.round(h || 1));
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h, scale: 1 };
  const scale = max / longest;
  return {
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
    scale,
  };
}

// Approximate decoded byte size of a data: URL (base64 → bytes).
export function dataUrlBytes(url) {
  if (typeof url !== 'string') return 0;
  const comma = url.indexOf(',');
  if (comma < 0) return 0;
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  if (!/;base64/i.test(meta)) return payload.length;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

export function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const HEX_RE = /^#[0-9a-f]{6}$/i;

export function normalizeHex(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return HEX_RE.test(s) ? s : null;
}

// Field-level validation. Returns { field: message } — empty object = valid.
export function validateBrief(state) {
  const errors = {};
  const name = (state.driver?.name || '').trim();
  const number = (state.driver?.number || '').trim();
  const custid = (state.driver?.custid || '').trim();
  if (!name) errors.name = 'Your name goes on the car — fill it in.';
  if (!number) errors.number = 'Race number is required.';
  else if (!/^[0-9A-Za-z]{1,3}$/.test(number)) errors.number = '1 to 3 letters or digits.';
  if (custid && !/^[0-9]+$/.test(custid)) errors.custid = 'Digits only — it looks like 123456.';
  if (!(state.car || '').trim()) errors.car = 'Pick your car.';
  if (state.paletteMode === 'mood') {
    if (!MOOD_IDS.includes(state.mood)) errors.palette = 'Pick a mood.';
  } else {
    const c = state.colors || {};
    if (!normalizeHex(c.primary) || !normalizeHex(c.secondary) || !normalizeHex(c.accent)) {
      errors.palette = 'Three colours, please.';
    }
  }
  if (!STYLE_IDS.includes(state.style)) errors.style = 'Pick a style.';
  if (!FINISH_IDS.includes(state.finish)) errors.finish = 'Pick a finish.';
  return errors;
}

// Build the brief document from form state. Key order matters only for
// readability of the download; the validator checks shape, not order.
export function buildBrief(state) {
  const brief = { format: BRIEF_FORMAT };
  brief.car = (state.car || '').trim();
  const team = (state.team || '').trim();
  if (team) brief.team = team;
  const driver = {
    name: (state.driver?.name || '').trim(),
    number: (state.driver?.number || '').trim(),
  };
  const custid = (state.driver?.custid || '').trim();
  if (custid) driver.custid = custid;
  brief.driver = driver;
  if (state.paletteMode === 'mood') {
    brief.palette = { mood: state.mood };
  } else {
    brief.palette = {
      primary: normalizeHex(state.colors?.primary),
      secondary: normalizeHex(state.colors?.secondary),
      accent: normalizeHex(state.colors?.accent),
    };
  }
  brief.style = state.style;
  brief.finish = state.finish;
  brief.logos = (state.logos || []).map((l, i) => ({
    name: (l.name || `logo-${i + 1}`).trim(),
    src: l.src,
    priority: i + 1,
  }));
  brief.notes = (state.notes || '').trim();
  return brief;
}

// "<driver>-<number>.brief.json" — safe for every filesystem.
export function briefFilename(driverName, number) {
  const slug = (s) => String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const d = slug(driverName) || 'driver';
  const n = slug(number) || 'brief';
  return `${d}-${n}.brief.json`;
}

// Logo filename → display name ("OpMo_Logo-white.png" → "OpMo Logo white").
export function logoNameFromFile(filename) {
  return String(filename || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'logo';
}

// Immutable list move for reorder buttons / keyboard. Returns a new array.
export function moveItem(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}
