# Path editing: a library or our own code?

Research for [#6](https://github.com/Carigon/pumpkin-carving-template/issues/6), done on 2026-10-23 for the hand-trace map [#4](https://github.com/Carigon/pumpkin-carving-template/issues/4). The question: should the hand-trace editor be built on an existing browser library for editable vector paths, or on our own code next to the existing SVG views?

## Answer

**Write our own code.** Make a small, pure path model and a set of edit rules, in the same style as `src/ringEdits.ts`. Put a thin SVG view on top of them, wired like `src/ui/blueprintViewSvg.ts`. Don't adopt a library for the editor.

The main reasons:

1. **No candidate has a pen tool.** None of them places points, keeps corner and smooth point kinds, or couples the handles of a smooth point. Paper.js comes closest: it has Bézier segments with handles, and hit tests for points and handles. Even there, the editing interaction is ours to write, and "smooth" is something it infers from the handles, not a stored point kind.
2. **None of them solves phone touch for us.** Paper.js turns touches into one mouse-style pointer and has no pinch. Konva shows pinch zoom only as a hand-written sandbox demo. Fabric's multi-touch gestures come in a separate add-on module. The hard touch parts are pinch-zoom over the photo and a precision aid (a loupe or an offset cursor). We'd write those ourselves anyway. The app already does pointer capture and `touch-action: none` in three places.
3. **Most of them would bring a second scene graph and a canvas.** Paper.js, Fabric and Konva draw to `<canvas>`, and each keeps its own mutable object model. The app's views are SVG. Its state is plain data, changed by pure rules and drawn with `render()`, and ADR 0001 lets those rules have their own tests. A library model would have to be kept in sync with ours, or it would replace ours.
4. **The hard back-end part already exists.** `src/input/svgDesign.ts` and `src/input/flattenPath.ts` (on `svgpath`) already turn SVG path data, cubic curves included, into a `Design`. So if our model can write a `d` string, it gets the conversion to a `Design` and the SVG download almost for free, now and once curves arrive.
5. **The cost is high for what it would buy.** The libraries are 50–99 KiB gzipped, and only Fabric is tree-shakeable. Our own v1 is probably a few hundred lines of code that would sit next to code the app already has.

Keep two libraries in mind for later, as **geometry helpers behind our model**, not as the editor: paper.js (`getNearestLocation`, `divideAt`, `smooth()`, boolean operations and the new `offset()`), or the much smaller `bezier-js`. They become relevant when curves (nearest point on a curve, splitting a curve) or overlap handling arrive.

## How the app does it today

- `src/ui/svg.ts` is a 21-line helper: `el(name, attrs, decimals)` creates an SVG element and rounds its numbers.
- `src/ui/blueprintViewSvg.ts` (696 lines) is the interaction model to copy. It handles `pointerdown` and `pointermove` on the `<svg>` and finds the target with `closest("[data-handle]")`, with a 22 px hit radius (`HIT_RADIUS`). It calls `setPointerCapture`, does one update per animation frame during a drag, and ends the drag on `pointerup` or `pointercancel`. It also handles zoom (buttons, wheel, keys) and keyboard nudges. The rules it applies (`dragRing`, `insertRing`, `deleteRing`…) are pure functions in `src/ringEdits.ts`. They are tested directly (`test/ring-edits.test.ts`), as [ADR 0001](../adr/0001-test-seams.md) allows.
- `src/ui/style.css` sets `touch-action: none` on the Blueprint view, its hit targets and the trace crop. `src/ui/tracePanel.ts` already drags a crop over the photo with pointer capture, on a `<canvas>`.
- `Design` (`src/core/types.ts`) is `{ paths: Point2[][]; bbox }`: closed polylines in design units, y up, with holes as nested paths filled even-odd.
- `readSvgDesign` (`src/input/svgDesign.ts`) parses an SVG and flattens every shape through `flattenPathData`. That uses `svgpath`'s `.unshort().unarc().abs()` and splits curves to a tolerance. Its output is a `Design`, so any `M/L/C/Z` path we write can be read back in.

## The candidates

Versions, licences and release dates come from the npm registry (`registry.npmjs.org/<pkg>`), read on 2026-10-23. Sizes are each package's own minified browser build from jsDelivr, gzipped at level 9. Bundlephobia's API agreed where it answered (paper 104 KiB, fabric 92 KiB, konva 56 KiB, svg.js 30 KiB gzipped for the main entry) before it rate-limited.

| | paper.js | Fabric.js | Konva | two.js | svg.js (+ plugins) |
|---|---|---|---|---|---|
| Latest | 0.16.0, 2026-10-21 | 7.4.0, 2026-05-18 | 10.9.0, 2026-10-15 | 0.8.24, 2026-08-29 | 3.2.8, 2026-08-04 |
| Licence | MIT | MIT | MIT | MIT | MIT |
| Renders to | canvas (exports SVG) | canvas (exports SVG) | canvas only | SVG, canvas or WebGL | SVG DOM |
| Size, min / gzip | 255 / 86 KiB (`paper-core`) | 292 / 89 KiB (whole ESM build) | 192 / 57 KiB | 201 / 49 KiB | 91 / 29 KiB |
| Tree-shaking | no: one bundle, no `module` or `exports` | yes: ESM, `sideEffects: false` | partly: `konva/lib/Core` plus single shapes | no: one module build | no: one bundle |
| Types | bundled `.d.ts` (needs TS ≥ 4.3) | written in TS | bundled | bundled | bundled |
| Bézier anchors and handles | yes: `Segment` has `point`, `handleIn`, `handleOut`, `isSmooth()`, `smooth()` | path commands; the `createPathControls` utility drags each point and each control point on its own | `Path` takes `d` data; no anchor model | yes: `Anchor` has `left` and `right` handles and a `command` | no |
| Point and handle hit tests | yes: `hitTest` with `segments`, `handles`, `curves` and `ends` | yes, through its controls | per shape; anchors are your own draggable circles | `contains()` per shape (added in 0.8.22) | no |
| Placing points (pen tool) | no | no | no | no | `svg.draw.js` draws polylines and polygons by click; no paths or curves |
| Touch | maps `touchstart/move/end` to its mouse events, one touch only; no pinch | pointer events opt-in; multi-touch gestures through the separate `westures` module (7.0.0) | pointer and touch events; pinch is a hand-written sandbox demo | none: bring your own events | `svg.draw.js` documents mouse only |
| Activity | very active: 0.12.20 to 0.16.0 between 18 and 21 Oct 2026; commits daily | active: monthly minors; 458 open issues | active: several releases a month | slow: a few releases a year | maintenance releases; `svg.draw.js` has about 900 downloads a week |

### paper.js

This is the closest fit on paper. Its `Segment` stores an anchor and two relative handles. `Path#hitTest` can return segments, handles, curve locations or open-path ends within a tolerance ([Project reference](http://paperjs.org/reference/project/), [Segment reference](http://paperjs.org/reference/segment/)). `exportSVG` writes `<path d>` with a precision option. It is also back in heavy development: the [changelog](https://github.com/paperjs/paper.js/blob/develop/CHANGELOG.md) and [commits](https://github.com/paperjs/paper.js/commits/develop) show 0.13 to 0.16 shipping in four days, boolean operations rebuilt on a planar graph (0.15), and `PathItem#offset()` / `#outline()` committed on 2026-10-22 but not released yet.

Where it falls short for us:

- There is no stored corner/smooth kind. `isSmooth()` is computed from whether the two handles are collinear. A "smooth" point whose handles stay coupled while one is dragged is the editor's job.
- Its input model is mouse events made from touch events. In `src/view/View.js`, `touchstart`/`touchmove`/`touchend` stand in for mouse events, and mouse listeners are dropped on mobile user agents. `src/dom/DomEvent.js` follows only the first touch on the target. There's no pinch and no pointer capture, so we'd handle two-finger zoom and pan ourselves, outside its event system.
- It draws only to canvas. The photo, the shapes, the mirrored side and the handles would all live in paper.js items. Saved work and undo would mean serialising paper.js items (`exportJSON`, or the new `Project#trackChanges` in 0.14) instead of our own data.
- At 86 KiB gzipped it's one untree-shakeable bundle. There's no `module` or `exports` field; `main` is `dist/paper-full.js`.

### Fabric.js

Fabric is an object model on canvas, with selection boxes and transform controls. Its path editing is [`createPathControls`](https://fabricjs.com/api/namespaces/controlsutils/functions/createpathcontrols) (added in 6.x, PR #9998). Reading [`pathControl.ts`](https://github.com/fabricjs/fabric.js/blob/master/packages/core/src/controls/pathControl.ts) shows it makes one control per command end point, plus one for each `C`/`Q` control point. Each control moves one coordinate pair in the path's command array. Nothing couples a smooth point's handles, and nothing adds or removes points (the controls are built once from the current commands). Multi-touch gestures came back in 7.0.0 through the external `westures` module ([CHANGELOG](https://github.com/fabricjs/fabric.js/blob/master/CHANGELOG.md)). It's the only candidate that tree-shakes. But a canvas, a `Path` and the controls still pull in most of the core, and the whole ESM build is 89 KiB gzipped.

### Konva

Konva is a fast canvas scene graph with events. It has no path editing. Its [anchor-editing example](https://konvajs.org/docs/sandbox/Modify_Curves_with_Anchor_Points.html) uses draggable circles with `dragmove` handlers that redraw the curve. Its [pinch example](https://konvajs.org/docs/sandbox/Multi-touch_Scale_Stage.html) reads the two touches and computes scale and position by hand. Konva can't write SVG: `toDataURL` is raster, and SVG export is third-party (`react-konva-to-svg`). We'd write the model, the editing and the SVG ourselves, and only borrow its drawing, which SVG already does for us.

### two.js

two.js has an SVG renderer and a [`Two.Anchor`](https://two.js.org/docs/anchor/) with `left` and `right` handles. Its [changelog](https://github.com/jonobr1/two.js/blob/dev/wiki/changelog/README.md) shows `contains()` hit testing was added only in 0.8.22 (Dec 2025). It has no input handling at all. What's left is a scene graph we'd drive from our own events: 49 KiB gzipped for a model we'd shape around anyway.

### svg.js and its plugins

`@svgdotjs/svg.js` is a fluent wrapper over the SVG DOM (29 KiB gzipped). [`svg.draw.js`](https://github.com/svgdotjs/svg.draw.js) draws "line, polyline, polygon, rect, image, circle, ellipse" point by point, using mouse events, and finishes with `done()`. It has no paths and no curves. [`svg.select.js`](https://github.com/svgdotjs/svg.select.js) has `pointSelect()` for polygon points, but no Bézier handles. What it would give us is roughly what `el()` in `src/ui/svg.ts` already gives us.

### Smaller libraries

An npm search for pen-tool, Bézier and SVG-path-editor packages found nothing usable as an interactive pen tool.

- **`svg-path-editor-lib`** (Apache-2.0, 2026-06-18) is the engine behind Yqnn's SvgPathEditor. It works on path data at the command level: parse, insert or delete items, change types, translate, scale, optimise, `asString()`. It has no anchor kinds and no interaction.
- **`bezier-js`** (MIT, 6.1.4, last release 2023-07; types in `@types/bezier-js`) does curve maths: `project()` for the nearest point, `split(t)`, bounding boxes and intersections. It's a good candidate for the curve maths once curves are in, and it needs nothing else.
- **SVG-Edit** (`svgedit` 7.4.2) is a whole editor app. Its licence mixes MIT, Apache-2.0, ISC, LGPL-3.0 and X11, and it unpacks to 50 MB. It's too big to embed for this.
- **Gesture libraries** (`interactjs` 1.10.28, `@use-gesture/vanilla` 10.3.1, last release 2024-03) cover drag and pinch but not paths. Two-pointer pinch is a small amount of Pointer Events code. A gesture library could still be a fallback if the phone prototype (#14) finds the hand-written version fiddly.

## What our own code needs to cover

Here's a sketch of the parts and roughly how big each is. It follows the existing split: pure rules in one module, view geometry in another, DOM wiring in `src/ui/`.

1. **Path model** (pure, no DOM): shapes in order, each a list of anchors and a `closed` flag. An anchor is `{ x, y, kind: "corner" | "smooth", in?: {dx, dy}, out?: {dx, dy} }`. In v1 every anchor is a corner with no handles, so curves arrive later without a migration. That's #10's decision; nothing in this research forces a different shape.
2. **To path data** (pure): anchors → `M … L … C … Z`, with `C` only where a handle is set. This one string gives the SVG download, the drawing, and (through `readSvgDesign` or `flattenPathData` directly) the `Design`. That's about 30 lines.
3. **Edit rules** (pure, tested like `ringEdits`): place a point, close a shape, move a point or a shape, insert a point on a segment, delete a point or a shape. Undo and redo are cheap because each edit returns new data. Inserting a point on a straight segment is a projection onto the segment. On a curve it's de Casteljau at the nearest `t`, which is the point where `bezier-js` or our own ~60 lines would come in. Those 60 lines are an estimate from the standard algorithms, not something we measured. Mirroring (#12) can be a function from the model to the drawn shapes.
4. **Hit tests**: anchors and handles by distance in screen px, as `HIT_RADIUS` does now; segments by distance to the segment. On SVG, `closest("[data-…]")` also works, as in the Blueprint view.
5. **View** (`src/ui/…Svg.ts`): an `<svg>` with the photo as `<image>`, a transformed `<g>` for zoom and pan, and the shapes, anchors and handles drawn with `el()`. Pointer handling would be copied from `blueprintViewSvg.ts`. On top of that comes tracking two active `pointerId`s for pinch-zoom and pan, which none of the libraries gives us in a usable form. The precision aid from the touch research and #14 (a loupe or an offset cursor) is custom whatever we choose.
6. **Keeping work**: the model is plain data, so it saves as JSON in `localStorage`, next to `src/settings.ts`, or as the SVG itself (#10).

## Effects on other tickets

- **#10, path model**: no library brings a model worth adopting, so #10 can design its own freely. Paper.js's `Segment` (point plus relative `handleIn`/`handleOut`) and two.js's `Anchor` (`left`/`right`) both confirm "anchor plus two relative handles" as the usual shape. Neither stores a corner/smooth kind. If #10 wants one, it's ours to add, and it's worth having, because coupling a smooth point's handles is what makes a pen tool feel right. The existing `svgpath` + `flattenPathData` already turns `C` segments into a `Design`, so curves need no new import code.
- **#11, v1 editing operations**: inserting a point on a segment is the only operation that needs non-trivial geometry, and only for curves (nearest point, split). Overlapping shapes would need boolean operations, if #11 wants merging instead of leaving overlaps alone or warning. Paper.js has the best open-source implementation of those (rebuilt in 0.15). Plan to keep overlaps as they are in v1, and revisit paper.js as a helper only if merging is wanted.
- **#12, live symmetry**: no library has mirroring that stays live. With our own model, the mirrored side can be generated at draw time, a simple reflection about x = centre, so "generated, not stored" costs nothing.
- **#14, phone prototype**: the prototype should be plain SVG with Pointer Events, not a library demo, so what it teaches carries over. The hard parts it should test are two-finger pinch and pan, and the precision aid. No candidate gives either.

## Sources

- npm registry metadata (version, licence, publish dates, entry points): `https://registry.npmjs.org/{paper,fabric,konva,two.js,@svgdotjs/svg.js,@svgdotjs/svg.draw.js,@svgdotjs/svg.select.js,svgedit,bezier-js,svgpath,interactjs,@use-gesture/vanilla,svg-path-editor-lib}`; weekly downloads from `api.npmjs.org/downloads/point/last-week/<pkg>`.
- Sizes: `cdn.jsdelivr.net/npm/paper@0.16.0/dist/paper-core.min.js`, `fabric@7.4.0/dist/index.min.mjs`, `konva@10.9.0/konva.min.js`, `two.js@0.8.24/build/two.module.min.js`, `@svgdotjs/svg.js@3.2.8/dist/svg.min.js`, gzipped locally; cross-checked against `bundlephobia.com/api/size`.
- paper.js: [CHANGELOG](https://github.com/paperjs/paper.js/blob/develop/CHANGELOG.md), [Project#hitTest / exportSVG](http://paperjs.org/reference/project/), [Segment](http://paperjs.org/reference/segment/), source [`src/view/View.js`](https://github.com/paperjs/paper.js/blob/develop/src/view/View.js) and [`src/dom/DomEvent.js`](https://github.com/paperjs/paper.js/blob/develop/src/dom/DomEvent.js), GitHub releases and commits API.
- Fabric.js: [`createPathControls` API](https://fabricjs.com/api/namespaces/controlsutils/functions/createpathcontrols), [`pathControl.ts`](https://github.com/fabricjs/fabric.js/blob/master/packages/core/src/controls/pathControl.ts), [CHANGELOG](https://github.com/fabricjs/fabric.js/blob/master/CHANGELOG.md).
- Konva: [README](https://github.com/konvajs/konva), [Modify Curves with Anchor Points](https://konvajs.org/docs/sandbox/Modify_Curves_with_Anchor_Points.html), [Multi-touch Scale Stage](https://konvajs.org/docs/sandbox/Multi-touch_Scale_Stage.html), [Stage Data URL](https://konvajs.org/docs/data_and_serialization/Stage_Data_URL.html).
- two.js: [Anchor docs](https://two.js.org/docs/anchor/), [changelog](https://github.com/jonobr1/two.js/blob/dev/wiki/changelog/README.md).
- svg.js: [svg.draw.js README](https://github.com/svgdotjs/svg.draw.js), [svg.select.js README](https://github.com/svgdotjs/svg.select.js).
- svg-path-editor-lib: npm README (`registry.npmjs.org/svg-path-editor-lib`).
