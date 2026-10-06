# Community region maps

Region maps label the panels of a car's 2048×2048 paint sheet — hood, doors,
bumpers — and record mirror pairs ("Left Door mirrors Right Door"). In
Clearcoat they power hover panel names, the **Regions** overlay, and one-click
**Mirror**. This folder is the shared library: one map per car, contributed
via pull request, loaded in-app with the **Get map…** button.

## Format

Each map is a JSON file in the `clearcoat-regions/1` format, exactly as
exported by Clearcoat itself:

```json
{
  "format": "clearcoat-regions/1",
  "car": "Mazda MX-5 Cup",
  "regions": [
    { "id": "hood",       "name": "Hood",       "x": 128, "y": 96,  "w": 480, "h": 360 },
    { "id": "left_door",  "name": "Left Door",  "x": 700, "y": 500, "w": 300, "h": 260, "mirror": "right_door" },
    { "id": "right_door", "name": "Right Door", "x": 1100, "y": 500, "w": 300, "h": 260, "mirror": "left_door" }
  ]
}
```

- All coordinates are in 2048-sheet space.
- `points` is optional: an outline of the region's real shape, as a list of
  `{ "x": …, "y": … }` corners (three or more). When present, `x`/`y`/`w`/`h`
  are the outline's bounding box. Versions of Clearcoat that predate outlines
  ignore `points` and use the box.
- `mirror` is optional and must reference another region's `id`.
- A map may also carry a top-level `links` list, recording which edges meet
  on the car even when the regions sit far apart or turned on the sheet:

  ```json
  "links": [
    { "a": { "region": "left_side",   "from": { "x": 1890, "y": 520 }, "to": { "x": 1930, "y": 760 } },
      "b": { "region": "rear_bumper", "from": { "x": 40,   "y": 300 }, "to": { "x": 60,   "y": 80 } } }
  ]
  ```

  Each side is a stretch of that region's edge. `a.from` meets `b.from` and
  `a.to` meets `b.to`. An edge that meets two regions carries two links.
  A side may add `"dir": 1` or `-1` to say which way round the outline it
  runs; without it the shorter way is meant.
  Versions of Clearcoat that predate links ignore them.

## Contributing a map

1. In Clearcoat, load your car's template and switch on **Annotate** mode
   (the warning-colored button in the viewport HUD). Drag rectangles over
   the panels, name them, and record mirror partners as prompted. If you
   loaded an official PSD, Clearcoat has already outlined the sheet's pieces
   as "Piece 1…N" — click one in Annotate mode to give it a real name (its
   id follows: "Left Door" becomes `left_door`). Not sure which piece is
   which? **Piece colors** adds a color-coded, labelled layer you can save
   to iRacing and look at on the car.
   **Link edges** records which edges meet: click the two ends of a shared
   stretch on one region, then the two ends it meets on the other (drag an
   end dot afterwards to adjust it). Linked
   edges show the same color bands in **Piece colors**, so on the car the
   same colors should face each other across the seam.
2. Click **Export map** in the Template panel to download the JSON.
3. Rename the file to `<car-folder-name>.json`, where `<car-folder-name>`
   is the car's subfolder name under your iRacing `paints` directory
   (e.g. `mx5 mx52016.json`, `ferrari296gt3.json`).
4. Add the file to this folder and add an entry to `index.json`:

   ```json
   { "car": "<car-folder-name>", "file": "<car-folder-name>.json", "label": "Human-readable car name" }
   ```

5. Open a pull request. One file per car — if a map already exists for your
   car, improve it instead of adding a duplicate.
