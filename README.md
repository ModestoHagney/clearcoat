# Clearcoat

A livery builder for iRacing that runs in the browser. Paint on the flat
template panel by panel, set finishes, and see every change on the car.

This is a fork of [Clearcoat by OblivionsPeak](https://github.com/OblivionsPeak/clearcoat).
It keeps the original's plumbing (reading templates, drawing layers, writing
the paint files, the iRacing folder link) under a new screen. The original
screen and the features only it had are no longer in this fork; they are in
the original repo and in this one's history.

## Running it

It is a static site: no build step.

```
python -m http.server 8000
```

Then open `http://localhost:8000/` in Chrome or Edge. It has to be
`localhost` or https for the iRacing folder link to work. Saving to iRacing
and Live need Chrome or Edge; everything else works in other browsers.

## Where things are

- `next/` — the app: `index.html`, `app.js` (state, drawing, actions),
  `ui.js` (menus, panels, dialogs), `tools.js` (pointer and keys on the
  sheet), `map.js` (Map mode), `icons.js` (icon search, SVG shapes),
  `preview.js` (the finish preview).
- `js/` — everything with no page in it, so it runs under `node --test`:
  `engine.js` (the livery, painting it, the finish map, saving and loading),
  `shapes.js`, `mirror.js`, `finish.js`, `svgpath.js`, `regions.js`,
  `zones.js`, `template.js`, `psd.js`, `tga.js`, `iracing.js`, `persist.js`.
- `test/` — `npm test`.
- `index.html` — hands over to `next/`.
- `sw.js` — the service worker. Bump `VERSION` there and in `next/app.js`
  together on every deploy.

## Credits

Built on Clearcoat by OblivionsPeak. Icons found through the search come
from Game Icons (CC BY 3.0), Material Symbols and Material Design Icons
(Apache 2.0) and Bootstrap Icons (MIT), by way of Iconify; each one's credit
is kept with the livery and listed under Help › About.
