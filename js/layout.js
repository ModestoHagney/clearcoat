// Sponsor row auto-layout — pure math, no DOM.
//
// Logos come in every shape: a wide flat wordmark and a tall round crest
// should read the same size when they share a row, so layout works with each
// layer's *optical* box (its opaque-pixel bounds) rather than its canvas.

// Opaque-pixel bounding box of an image, in the image's own pixel units.
// `sample(img, w, h)` must return an ImageData-like { width, height, data }
// of the image drawn at w×h; the default draws on a scratch canvas. The
// measurement is done at a reduced size (maxDim) — a bbox does not need full
// resolution. A fully transparent image falls back to its full bounds.
export function measureOptical(img, { maxDim = 128, threshold = 8, sample = sampleCanvas } = {}) {
  const W = img.width, H = img.height;
  if (!W || !H) return { x: 0, y: 0, w: W || 0, h: H || 0 };
  const k = Math.min(1, maxDim / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * k)), sh = Math.max(1, Math.round(H * k));
  const id = sample(img, sw, sh);
  const data = id.data, w = id.width, h = id.height;
  let x1 = w, y1 = h, x2 = -1, y2 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return { x: 0, y: 0, w: W, h: H };
  // scale back up; +1 because the bbox is inclusive of the last sample pixel
  const fx = W / w, fy = H / h;
  return {
    x: x1 * fx, y: y1 * fy,
    w: Math.max(1, (x2 - x1 + 1) * fx),
    h: Math.max(1, (y2 - y1 + 1) * fy),
  };
}

function sampleCanvas(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Lay `items` out along a line inside `rect`.
//   items: [{ id, w, h, ox, oy, ow, oh, flipH?, flipV? }]
//          w,h = image size; ox,oy,ow,oh = optical box in image pixels
//   rect:  { x, y, w, h } doc-space target
//   opts:  direction 'horizontal' | 'vertical'
//          gap       'even' (equal gaps) | 'centres' (equal centre spacing)
//          align     'center' | 'start' | 'end'  (cross-axis: top/bottom or left/right)
//          minGap    minimum gap as a fraction of the shared optical size (default .3)
//          fill      slot fill fraction for 'centres' mode (default .85)
// Returns [{ id, x, y, scale }] — x,y is the layer centre (image centre), so
// it drops straight into layer.x / layer.y with scaleY = null.
export function layoutRow(items, rect, opts = {}) {
  const {
    direction = 'horizontal', gap = 'even', align = 'center',
    minGap = 0.3, fill = 0.85,
  } = opts;
  const n = items.length;
  if (!n) return [];
  const horiz = direction !== 'vertical';
  // main axis = along the row; cross axis = the shared optical size
  const mainLen = horiz ? rect.w : rect.h;
  const crossLen = horiz ? rect.h : rect.w;
  const mainStart = horiz ? rect.x : rect.y;
  const crossStart = horiz ? rect.y : rect.x;
  // aspect = optical main extent per unit of optical cross extent
  const aspects = items.map(it => {
    const om = horiz ? it.ow : it.oh, oc = horiz ? it.oh : it.ow;
    return Math.max(1e-6, om) / Math.max(1e-6, oc);
  });
  const sumAsp = aspects.reduce((a, b) => a + b, 0);

  // shared optical cross size S
  let S;
  if (gap === 'centres') {
    const slot = mainLen / n;
    S = Math.min(crossLen, ...aspects.map(a => (slot * fill) / a));
  } else {
    S = Math.min(crossLen, mainLen / (sumAsp + minGap * Math.max(0, n - 1)));
  }
  S = Math.max(1e-3, S);

  // main-axis positions of each optical centre
  const mains = aspects.map(a => a * S);
  const centres = [];
  if (gap === 'centres' || n === 1) {
    const slot = mainLen / n;
    for (let i = 0; i < n; i++) centres.push(mainStart + slot * (i + 0.5));
  } else {
    const total = mains.reduce((a, b) => a + b, 0);
    const g = (mainLen - total) / (n - 1);
    let cur = mainStart;
    for (let i = 0; i < n; i++) { centres.push(cur + mains[i] / 2); cur += mains[i] + g; }
  }
  const crossC = align === 'start' ? crossStart + S / 2
    : align === 'end' ? crossStart + crossLen - S / 2
    : crossStart + crossLen / 2;

  return items.map((it, i) => {
    const oc = horiz ? it.oh : it.ow;
    const scale = S / Math.max(1e-6, oc);
    // optical centre → image centre: undo the optical box's offset
    const offX = (it.ox + it.ow / 2 - it.w / 2) * (it.flipH ? -1 : 1) * scale;
    const offY = (it.oy + it.oh / 2 - it.h / 2) * (it.flipV ? -1 : 1) * scale;
    const optCx = horiz ? centres[i] : crossC;
    const optCy = horiz ? crossC : centres[i];
    return { id: it.id, x: optCx - offX, y: optCy - offY, scale };
  });
}

// doc-space bounding box of a set of corner lists → { x, y, w, h }
export function cornersRect(cornerLists) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const cs of cornerLists) for (const c of cs) {
    if (c.x < x1) x1 = c.x; if (c.x > x2) x2 = c.x;
    if (c.y < y1) y1 = c.y; if (c.y > y2) y2 = c.y;
  }
  if (!Number.isFinite(x1)) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
