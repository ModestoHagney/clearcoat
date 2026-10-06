# Clearcoat — iRacing Livery Workbench

Photoshop-free iRacing livery editing in the browser, with **live preview on the real car** — Clearcoat saves directly into your iRacing paints folder and the sim showroom hot-reloads the paint within seconds.

**Live app:** https://oblivionspeak.github.io/clearcoat/

## How it works

1. **Load a template** — download your car's official template from [Trading Paints' template library](https://www.tradingpaints.com/cartemplates) (or in-sim via My Content → Car Manager → Download Template) and load the **PSD straight into Clearcoat** — it extracts the wireframe in the browser, no Photoshop needed. Plain PNG/JPG wireframes work too. The overlay is multiply-blended and never exported. A template PSD also brings the kit's **sponsor and number zones** in as a region map (twins paired, upside-down panels detected from the kit's own stock decals — fixable per region in the Template panel) so **Fit to zone** drops a logo into the official spot, sized, centred and turned the right way; its **Mask** layer powers a **bleed check** (a ⚠ badge on any layer that mostly lands on unpaintable area, and a **Show unpaintable** red tint).
2. **Build your livery in layers** — pick a base coat color, then drag-and-drop PNGs/JPGs/SVGs (sponsor logos, artwork) onto the canvas. **+ Text** adds names and numbers (Google Fonts or your own font file) with a **Curve** slider for arched text, **+ Fill** adds shapes and 2- or 3-stop gradients, **+ Library** inserts ready-made racing graphics (40 built in). Per-layer **Effects** add a contour outline, drop shadow, or glow to any logo or text, and **Halftone fade** dissolves any layer — stripes, textures, logos, text — into a screen of dots or bars along a chosen direction (the classic speed fade), or tear it off as a **Rip** (seeded torn-paper edge with shreds), thin it into **Scanlines**, or break it into a **Glitch** of shifted, dropping-out rows with an optional RGB split (the dice button rerolls the tear/glitch pattern) — one-click **From** arrows and **Flip** pick which side the dots run toward, since templates lay cars out nose-left or nose-right — with the spec map following the dots. Select two or more logos or text layers and **Row…** lines them up evenly (horizontal or vertical, even gaps or even centres, into the selection box or a region-map zone) with the same *visible* height — measured from each logo's opaque pixels, so a wide flat wordmark and a tall round crest read the same size. Move, scale, rotate, skew, flip, reorder, set opacity and per-layer **blend modes** (multiply for shading/weathering, screen for glows, overlay/soft-light for contrast) — with full undo/redo, multi-select (Ctrl+click the list, Shift+click or Shift+drag a marquee on the canvas) including **group scale/rotate** handles, and **snapping** to the sheet center/edges, region-map lines, and other layers' edges/centers (hold Alt to move freely). The **magic wand** (`W`) selects a color region on the finished livery and turns it into a material-only layer, recolors it outright, or — with **Pattern** armed — fills it with a tiling texture.
   - **+ Car pattern** — every official template PSD hides a *Car Patterns* group: ~24 of iRacing's own designs for that exact car, already correct across every panel of the sheet. Loading the PSD catalogues them (in your browser, per car) and **+ Car pattern** opens a picker: pick three colours, narrow by style (minimal / clean / bold / aggressive / classic / gradient), click a design and it drops in at the bottom of the stack as a panel-correct base livery — zero tracing. Swap or change the three colours any time in the inspector, put any material or fade on it like a fill.
3. **Pick materials, not spec maps** — every layer gets a finish: **gloss, matte, satin, metallic, chrome, candy, pearl, glaze, metal flake, glitter, brushed metal, carbon weave, or ghost**. Clearcoat bakes the iRacing spec map for you, including per-pixel micro-textures (flake sparkle, brushed grain, twill weave) that are effectively impossible to author by hand. **Ghost** layers are skipped in the paint map entirely — the design exists only in reflections. Toggle **Spec view** to inspect the result, or open **Studio** for an orbitable 3D proof (sphere / cylinder / door panel under showroom, neutral, or dusk lighting) — pearl, candy, flake and chrome only read truthfully on curvature.
4. **Tile seamless textures** — **+ Pattern** adds an image as a tiling fill across the whole sheet. **+ SimTex** opens [SimTex Pro](https://oblivionspeak.github.io/simtex-pro/) (500+ procedural textures) in bridge mode: design a texture there, hit **Send to Clearcoat**, and it lands straight in your layer stack — no export/import round-trip. Put any material on top.
5. **Know where you're painting** — load a **region map** for your car and the sheet's panels get hover labels, a **Regions** overlay, and one-click **Mirror** (drop a flipped copy of a layer onto the partner panel). No map for your car yet? **Annotate** mode lets you build one and export it as shareable JSON. Mirror pairs carry a `mirrorKind` (flip, flipV, rot180, same) so a twin panel that is mapped upside-down gets a rotated copy rather than a wrongly flipped one. Stuck on direction? The **Livery Advisor** turns a description of the look you want into concrete changes — fully local, no AI keys.
6. **Plays nice with Trading Paints** — saving to iRacing first snapshots whatever is already in the folder (your active Trading Paints livery) into `clearcoat-backup/`; one-click **Restore** swaps it back. **Import current car paint…** pulls the existing `car_<id>.tga` into the editor as a full-sheet layer so you can design on top of your TP livery instead of replacing it. The TP desktop app re-downloads your active TP livery over local files, so the sim can keep loading the TP paint instead of yours — turn on **TP Guard** and Clearcoat watches the files after every save and instantly writes your design back whenever TP clobbers them. For the permanent fix, **Send to TP** downloads the paint PNG and opens the Trading Paints upload page: upload it there and TP serves your Clearcoat livery instead of fighting it.
7. **Save to iRacing** — link your `Documents\iRacing\paints\` folder once (Chrome/Edge) and pick the car from the topbar dropdown (linking a single `paints\<car>\` folder directly still works), enter your customer ID, and hit **Save to iRacing**. Keep the sim showroom open on a second monitor: it reloads `car_<custid>.tga` automatically when the file changes. Turn on **Live Sync** and settled edits stream into the folder on their own (2.5 s debounce) — the showroom becomes your live preview. Helmets and suits are paint targets too (`helmet_<id>.tga` at 1024×1024, `suit_<id>.tga`), and a **Custom Number** toggle saves `car_num_<id>.tga` for number-rules series. Sharing one design across a team? Bind text layers to **Driver number** / **Driver name** (inspector → Text → Variable), list each driver in the **Drivers** panel, **Preview** any of them on the canvas without touching the master, and **Export all drivers** writes every driver's `car_<custid>.tga` + spec in one go.

8. **Start from a brief** — a driver fills in a short `.brief.json` (team, driver name/number/cust ID, three colours or a one-word mood, style, finish, sponsor logos in priority order) and **Brief** in the topbar — or dropping the file on the canvas — turns it into **three panel-correct livery candidates**, deterministically, with no AI: the base coat is one of the template's own hidden **Car Patterns** recoloured with the brief's palette, the main sponsor lands in the biggest sponsor zone *and* its mirror twin, the rest fill the zones by size, the number goes into every number zone (bound to **Driver number**), and the finish becomes the materials. Load the car's template PSD first so Clearcoat has its zones and patterns; **Use this** replaces the canvas as one undo step, and the brief's cust ID pre-fills the Drivers table. Try **Load sample** in the panel.

No install, no backend, no account. Everything runs client-side; projects autosave to your browser (IndexedDB) and can be exported/imported as `.clearcoat.json`.

Clearcoat is free. If it saves you time (or a Photoshop license), you can [support development on Ko-fi](https://ko-fi.com/metalprophecymedia). ♥

## Exports

| Output | Format |
|---|---|
| Car paint | `car_<custid>.tga` — 2048×2048, 24-bit uncompressed TGA (`car_num_<custid>.tga` with Custom Number on) |
| Spec map | `car_spec_<custid>.tga` — R = metallic, G = roughness, B = clearcoat (iRacing PBR convention) |
| Helmet / suit | `helmet_<custid>.tga` (1024×1024) / `suit_<custid>.tga` — no spec map, per iRacing |
| Spec MIPs | **Get MIPs** downloads the sim-generated `.mip` files for Trading Paints spec upload |
| Portable | PNG download (e.g. for Trading Paints upload) |
| Region map | Panel-label JSON, shareable with other painters of the same car |

## Brief form

Drivers who have never opened Clearcoat describe the livery they want at [`brief.html`](https://oblivionspeak.github.io/clearcoat/brief.html) — name, number, car, colours (or a mood), style, finish, sponsor logos — and download a `<driver>-<number>.brief.json` that the team's designer loads in Clearcoat to generate three livery candidates. Phone-friendly, works offline once cached, nothing is uploaded.

## Browser support

- **Chrome / Edge** — full experience including Save to iRacing (File System Access API).
- **Firefox / Safari** — editor and downloads work; direct folder save is unavailable.

## Shortcuts

| Key | Action |
|---|---|
| Drag / corner handles / teal handle | Move / scale / rotate (Shift = snap 15°) |
| Arrows (+ Shift) | Nudge layer 1px (10px) |
| `Delete` | Delete layer |
| `Ctrl+D` | Duplicate layer |
| `Ctrl+Shift+D` | Mirror Clone — copy the selection onto its mirrored partner panels (needs a region map) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+click` (layer list) | Multi-select — group move, delete, duplicate, nudge |
| `Shift+click` (canvas) | Add/remove a layer from the selection |
| `Shift+drag` (empty canvas) | Marquee-select layers |
| `Alt` (while moving) | Disable snapping |
| `W` | Magic wand — select a contiguous color (Shift+click: that color everywhere) |
| `S` | Toggle spec view |
| `L` | Toggle Shine view — a light sweeps the livery so finishes preview in-app (gloss flashes, flake sparkles, ghost layers appear) |
| `F` | Fit to window |
| `F1` or `?` | Help overlay — workflow, shortcuts, tips |
| `Esc` | Exit tool / deselect |
| Scroll / Space-drag or right-drag | Zoom / pan |

## Development

Pure static site — no build step. Serve the folder with anything (`python -m http.server`) and open `index.html`. ES modules require http(s), not `file://`.

Bump the `#app-version` stamp in `index.html` with every deploy — GitHub Pages caches assets for 10 minutes, and the visible version (top-left, next to the wordmark) is how users confirm they're on the latest build after a hard refresh (Ctrl+F5).

```
index.html
css/app.css
js/main.js        UI, viewport, interactions
js/engine.js      document model, paint + spec compositing
js/tga.js         TGA encoder/decoder (24/32-bit, uncompressed + RLE read)
js/persist.js     IndexedDB autosave + File System Access handles
js/psd.js         PSD template import — wireframe extraction, no Photoshop
js/advisor.js     Livery Advisor — local expert system, no AI keys
js/studio.js      Studio — orbitable 3D material proofing bench
js/regions.js     region maps — labeled panels, mirror pairs, pure data helpers
js/zones.js       template intelligence — zone extraction, twin/orientation inference, fit, bleed check
js/wand.js        magic wand — color-based selection over the composited paint
js/lightsweep.js  Shine view — WebGL per-pixel light sweep over the sheet
js/library.js     built-in starter graphics (inline SVGs)
js/shaderball.js  material picker swatches rendered as shaded spheres
js/vendor/        vendored ag-psd (pinned, no runtime CDN dependency)
icons/            PWA install icons (any + maskable)
```

Unit tests (node only, no dependencies): `npm test` runs `node --test` over `test/` — the pure TGA encode/decode paths and the region-map helpers.

## Roadmap

- Studio improvements — car-shaped geometry, more environments
- Project gallery / shareable templates
