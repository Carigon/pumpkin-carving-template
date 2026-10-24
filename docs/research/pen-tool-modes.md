# Pen-tool modes: placing points vs editing existing geometry

Research done on 2026-10-24 for [#11 Hand-trace editing operations in v1](https://github.com/Carigon/pumpkin-carving-template/issues/11), on the map [#4 Hand-tracing a photo into a design](https://github.com/Carigon/pumpkin-carving-template/issues/4). It feeds the prototype [#14 Placing and adjusting points on a phone](https://github.com/Carigon/pumpkin-carving-template/issues/14).

It goes deeper on one question left open by [the earlier touch pen-tool survey](https://github.com/Carigon/pumpkin-carving-template/blob/research/touch-pen-tools/docs/research/touch-pen-tools.md) (#5). A tap can mean "place the next point here" or "act on the point or segment already here". How do vector editors, map-drawing libraries and annotation tools decide which one the carver meant? The earlier note said apps avoid the clash with separate pen and edit modes. This note checks that claim.

Sources are vendor help pages, API docs and library source code. Adobe's help pages refuse automated fetches, so they were read in a real browser. Statements marked **(our inference)** are reasoning, not something a source says.

## Short answer

There are five distinct designs. Most products combine two or three of them.

1. **Explicit modes** with automatic transitions: one mode draws, another selects and edits. Mapbox GL Draw, Leaflet.draw, Terra Draw, CVAT, QField, Linearity, Affinity and Inkscape all do this.
2. **One tool that hit-tests by context.** The drawing tool also inserts or deletes points when the click lands on existing geometry. Illustrator's Pen (Auto Add/Delete, on desktop and on iPad), Illustrator's Curvature tool, Figma's Pen inside vector edit mode, and Sketch's vector editing mode work this way.
3. **Quasi-modes**: a modifier held down temporarily switches the tool. Ctrl/Cmd gives direct selection in Illustrator and the Node Tool in Affinity, and Shift suppresses Illustrator's auto add. On touch this becomes an on-screen modifier button (Illustrator's touch shortcut, Affinity's on-screen modifiers) or multi-finger holds (Affinity).
4. **Dedicated insert handles**: a midpoint marker on every segment is the only way to insert. The "tap near a segment" ambiguity disappears because insertion has its own target. Mapbox GL Draw, Leaflet.draw, Terra Draw, tldraw and Excalidraw do this, usually only while a shape is selected.
5. **Indirect placement**: a crosshair plus an **Add** button. A tap on the canvas never places a point, so it can't be confused with editing. QField does this by default, and so does Google Maps' Measure tool, which the earlier note covers.

**The earlier note was half right.** Touch-first vector apps and every map library do split pen and edit. But Illustrator's own Pen tool inserts on a segment and deletes on a point, on both desktop and iPad. Figma and Sketch let you add points to the path and insert on segments in one editing mode. They don't avoid the clash. They resolve it by hit-test priority, with a modifier or preference as an escape hatch.

**Every library measures hit tolerance in screen pixels,** which stays constant as you zoom. Mapbox GL Draw is the only one that sets a separate touch radius: 25 px for touch against 2 px for a click.

## 1. Explicit modes with automatic transitions

### Mapbox GL Draw: the clearest state machine

Mapbox GL Draw has these modes: `simple_select` (the default), `direct_select`, `draw_line_string`, `draw_polygon` and `draw_point` ([API.md](https://github.com/mapbox/mapbox-gl-draw/blob/main/docs/API.md)).

**Transitions**, from the API docs and the mode source files ([draw_polygon.js](https://github.com/mapbox/mapbox-gl-draw/blob/main/src/modes/draw_polygon.js), [simple_select.js](https://github.com/mapbox/mapbox-gl-draw/blob/main/src/modes/simple_select.js), [direct_select.js](https://github.com/mapbox/mapbox-gl-draw/blob/main/src/modes/direct_select.js)):

- **Toolbar button → `draw_polygon`.** Each click or tap off a vertex adds a vertex. A rubber-band point follows the pointer.
- **Finishing.** In `draw_polygon`:
  - **Click on any rendered vertex.** The first vertex shows once the polygon has 3+ coordinates and the last placed one once it has more than 3. Clicking either finishes the polygon, and the handler doesn't check which one it was (`clickOnVertex` simply calls `changeMode(SIMPLE_SELECT, { featureIds: [polygon.id] })`).
  - **Click again on the previous vertex** (a double-click), or **Enter**: finishes the polygon. The polygon is kept and selected.
  - **Escape or Trash:** the polygon is deleted and nothing is selected. **Escape cancels; it does not finish.**
  - **Invalid shape:** a polygon with too few points is deleted silently when the mode ends.
- **`simple_select`:**
  - clicking a feature selects it
  - clicking an already-selected feature, or a vertex of one, enters `direct_select`
  - dragging a selected feature moves the whole thing
  - clicking empty map clears the selection
- **`direct_select`:**
  - press on a vertex selects it and starts a drag at once (Shift adds to the selection)
  - press on a **midpoint** turns it into a real vertex (`addCoordinate`) and selects it, so one gesture inserts and drags
  - dragging the feature body moves the whole feature when no vertex is selected
  - Trash, Backspace or Delete removes the selected vertices, and if the feature becomes invalid it is deleted
  - clicking empty map or another feature returns to `simple_select`
- **Resuming an open shape:** only line strings can be resumed, via `changeMode('draw_line_string', { featureId, from })`. Polygons can't be resumed ([API.md](https://github.com/mapbox/mapbox-gl-draw/blob/main/docs/API.md)).
- **Hit areas:** `clickBuffer` defaults to 2 px and `touchBuffer` to 25 px: the "pixels around a feature or vertex" that respond to a click or a touch.

So in Mapbox, **place and insert can never clash.** Placing exists only in `draw_polygon`, and inserting exists only in `direct_select`, through midpoint markers. The cost is mode hops. To insert a point on a polygon you just drew, you click it (enter `simple_select`), click it again (enter `direct_select`), then drag a midpoint.

### Leaflet.draw: draw handlers and a global edit mode

These details come from the default strings in [Leaflet.draw.js](https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js) and the handler sources:

- **Drawing.** The polygon tooltips say "Click to start drawing shape.", then "Click to continue drawing shape.", then "Click first point to close this shape." Polylines instead say "Click last point to finish line."
- **Draw toolbar actions:** "Finish", "Delete last point" and "Cancel".
- **Touch finishing.** On touch, a tap within 10 px of the last marker finishes the line (`if (lastPtDistance < 10 && L.Browser.touch)`), and markers switch to a larger 20×20 `touchIcon` ([Draw.Polyline.js](https://github.com/Leaflet/Leaflet.draw/blob/master/src/draw/handler/Draw.Polyline.js)).
- **Edit mode** is a separate toolbar mode for all layers at once. Its tooltip says "Drag handles or markers to edit features.", and it has "Save", "Cancel" ("discards all changes") and "Clear All" ([Leaflet.draw.js](https://github.com/Leaflet/Leaflet.draw/blob/master/src/Leaflet.draw.js)).
- **In edit mode** ([Edit.Poly.js](https://github.com/Leaflet/Leaflet.draw/blob/master/src/edit/handler/Edit.Poly.js)):
  - **Clicking a vertex marker deletes it** (`_onMarkerClick` → `_removeMarker`). It is refused if the polygon would drop below its minimum.
  - Semi-transparent "middle markers" sit at each segment midpoint. Dragging or clicking one inserts a vertex.
- **(our inference)** On touch, tap-to-delete would make every mis-tap on a vertex destructive. It also leaves no way to tap-select a point. Not a pattern to copy.

### Terra Draw

Terra Draw switches modes explicitly with `draw.setMode("polygon")`, `setMode("select")` and so on ([Terra Draw modes guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/4.MODES.md)):

- **Select mode:** what can be edited is set per geometry with `flags`: `draggable` feature, and `coordinates.midpoints`, `coordinates.draggable` and `coordinates.deletable`.
- **Polygon mode** has an `editable: true` option, a "lightweight version of the select mode" that lets users drag existing coordinates "without switching modes". **It's a step towards option 2 inside a modal library.**
- **Hit area:** `pointerDistance`, "measured in pixels", "defaults to 40px". It also governs "trying to close a geometry by its closing point".

### Annotation and GIS tools

- **CVAT** (image annotation):
  - **Drawing:** N starts a polygon, clicks place points (or hold Shift and drag to draw freehand), right-click removes the previous point, and N again or **Done** finishes ([manual drawing](https://docs.cvat.ai/docs/annotation/manual-annotation/shapes/annotation-with-polygons/manual-drawing/)).
  - **Editing after creation:** move points by dragging, and delete with Alt+click or right-click → Delete point.
  - **Reshaping:** **Shift+click on the polygon** opens a separate polygon editor. There you draw a new run of points from one existing point to another, which replaces that part of the outline. Esc cancels ([edit polygon](https://docs.cvat.ai/docs/annotation/manual-annotation/shapes/annotation-with-polygons/edit-polygon/)). It's a sixth, niche design: editing by redrawing a section.
- **QField** (GIS on phones):
  - **Digitizing is crosshair-based:** pan the map under a centre crosshair, tap **+** to add a vertex, **−** to remove the last, **Save** to finish, **✕** to cancel.
  - **Tapping the canvas** places vertices only if "Allow finger tap on canvas to add vertices" is turned on.
  - **Editing:** a separate **Edit geometry** entry leads to a Vertex Tool that can "Move or delete existing vertices, or insert new vertices along geometry segments" ([QField: digitize](https://docs.qfield.org/how-to/data-collection/digitize/)).
- **Google My Maps** (desktop): "Click each corner or bend of your line or shape", and "When you're finished drawing, double-click or complete the shape" ([My Maps help](https://support.google.com/mymaps/answer/3433053)).

### Touch-first vector apps

- **Linearity Curve:**
  - **Pen:** tap adds a corner node. Finish with **Finish Path**, a double-tap near the red end node, or Esc. A path closes when "the next point overlaps the other endpoint". To resume, "select the open path and then switch to the Pen Tool" ([drawing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/drawing-tools/)).
  - **Node Tool:** "To select one single point, tap on it", and "Tap any space between two nodes directly on the vector path to add a new point" ([editing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/editing-tools/)).
  - **Insert lives only in the Node Tool.** The Pen page doesn't say what tapping an existing path does.
- **Affinity Designer 2 for iPad:**
  - **Pen:** "tap on the starting node" to close. Finish open with "double-tap the last drawn node or choose the Deselect icon". To resume, select the end node with the Node Tool, then place more nodes with the Pen ([draw curves](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)).
  - **Node Tool:** "With the curve selected, tap at the point where you want the node to be added", and also "Tap anywhere on a line segment and drag" to reshape it. So a tap on a segment inserts and a drag on a segment reshapes: **tap vs drag picks the operation** ([edit curves](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/edit_linesAndShapes.html)).
  - **Entering editing:** double-tapping a shape switches from the Move Tool to the Node Tool, and double-tapping again switches back.
- **Inkscape** (desktop; no touch build):
  - **Pen (Bezier):** "click: create a sharp node".
    - **Finishing:** Enter, right-click or double-click finishes. "Enter or right-click finish the current line, discarding the last unfinished (red) segment." Shift+Enter finishes and closes.
    - **Cancelling:** Esc or Ctrl+Z cancels the current line, and Backspace erases its last segment.
  - **Node tool:** double-click on the path, or Ctrl+Alt+click, creates a node; Ctrl+Alt+click on a node deletes it. "Clicking on a selected path between the nodes selects the two nodes closest to the click point".
  - **Space** switches to the Selector temporarily ([Inkscape keys reference](https://inkscape.org/doc/keys.html)).
  - **(our inference)** In Inkscape's Node tool, a single click on a segment selects and a double-click inserts. That's another way to keep "select" and "insert" apart within one mode.

**How ending and resuming work under explicit modes.** Ending a shape ends the drawing mode, and most tools then select the new shape (Mapbox). Resuming means "select the open end, then re-enter the pen" (Affinity, Linearity), or it isn't possible at all (Mapbox polygons, Leaflet.draw).

## 2. One tool that hit-tests by context

### Illustrator's Pen (desktop)

- **Placing and finishing.** Click without dragging to place a corner anchor. To close, "Position the Pen tool over the first anchor point… a small circle appears next to the Pen tool pointer". To leave the path open, "Ctrl-click (Windows) or Command-click (macOS) anywhere away from the path", or "Select a different tool or select Select > Deselect" ([draw line segments with the Pen tool](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/draw-shapes/draw-line-segments-with-the-pen-tool.html)).
- **Auto Add/Delete.** The Pen tool switches to the Add or Delete Anchor Point tool "when hovering over a selected path".
  - **To add or delete:** "Select the Pen tool… Select anywhere on the path to add an anchor point", and "Select the anchor point… that you want to remove" ([add or remove anchor points](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/add-or-remove-anchor-points.html)).
  - **To override it:** "Press Shift as you hover the Pen tool over the selected path or an anchor point to temporarily turn off" auto add and delete. Or turn it off permanently with **Preferences > General > Disable Auto Add/Delete** ([turn off automatic addition or deletion](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/turn-off-automatic-addition-or-deletion-of-anchor-points.html)).
  - **Scope.** This applies only to a **selected** path, which is how Illustrator scopes the ambiguity. Unselected artwork never captures a pen click.
- **Hit tolerance:** "Sets how close the pointer must be to an anchor point for selection. The default value is 3 pixels" ([selection preferences](https://helpx.adobe.com/illustrator/desktop/manage-objects/select-objects/object-selection-methods-and-preferences.html)).
- **Quasi-modes**, from [default keyboard shortcuts](https://helpx.adobe.com/illustrator/using/default-keyboard-shortcuts.html):
  - Ctrl/Cmd switches to the last-used selection tool
  - Alt/Option switches the Pen to the Convert Anchor Point tool, and toggles between Add and Delete Anchor Point
  - Spacebar-drag moves the current anchor while drawing
- **The Curvature tool** is one tool for the whole job: it lets you "create, toggle, edit, add, or remove smooth or corner points".
  - Click to set points.
  - Double-click a point to toggle smooth or corner, and "Select a point and then drag the point to move it".
  - Select a point and press Delete to remove it.
  - "Alt-click… to continue adding points to an existing path or shape"
  - "Press Esc to stop drawing" ([Curvature tool](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/draw-shapes/draw-shapes-with-the-curvature-tool.html)).

### Illustrator on iPad: the same design under a finger

These quotes are from [draw and edit paths on iPad](https://helpx.adobe.com/illustrator/ipad/draw-and-edit-objects/draw-edit-on-ipad.html), in the **Pen tool** section:

- **Placing:** "tap on artboard to create corner points or tap and drag to create smooth points." You can "adjust the handles of a smooth point without changing to a different tool."
- **"Add anchor points: Tap anywhere on the path to add a point.** You can reposition the new anchor point using a secondary modifier."
- **"Convert corner to a curve: Double-tap on points** to convert points from corners to curves and vice versa."
- **The Direct Selection tool** is a separate tool. Selecting an anchor shows "a contextual widget" with Cut Path, Convert to Curve, Convert to corner, Join path, Simplify path, Smart delete ("delete the anchor point without breaking the path") and Delete.

**Touch shortcut** ([touch shortcuts and gestures](https://helpx.adobe.com/illustrator/ipad/get-started/shortcuts-and-gestures/touch-shortcuts-gestures.html)):

- **What it is:** an on-screen circle that stands in for modifier keys. "Tap and hold the center… with your other hand" for the primary modifier, or "slide to the outer edge" for the secondary.
- **Double-tapping it locks the modifier**, which turns the quasi-mode into a real mode.
- **For the Pen's handles:** the primary modifier breaks handle pairing, and the secondary moves the point.
- **Other gestures:**
  - two-finger tap undoes and three-finger tap redoes
  - "Double-tap on a selected object" → "Edit points"
  - a quick two-finger pinch fits the view

This contradicts the earlier note's framing. Illustrator on iPad doesn't keep insert out of the pen. **Its Pen tool inserts on a tap on the path,** exactly the clash the earlier note flagged. Nothing in the help says how near the path a tap has to be.

### Figma

- **Pen tool:** "position the Pen tool over another point in the vector network. A small circle appears next to the cursor, indicating that the path will be closed at that point." That's *any* point in the network, not just the first, because Figma paths can branch. "To leave the path open, press Escape to deselect the vector network" ([vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks)).
- **Vector edit mode** is entered with Enter. In it, "To move an existing point, select the Move tool… or press V", and "To add additional points, select the Pen tool… Then, click along the vector network's path" ([edit vector layers](https://help.figma.com/hc/en-us/articles/360039957634-Edit-vector-layers)).
- **Move vs Pen** is a sub-mode toggle inside edit mode, which puts Figma halfway between options 1 and 2.
- **On mobile, Figma is still view and comment only.** The App Store listing describes viewing, sharing and mirroring ([App Store](https://apps.apple.com/app/figma/id1152747299)).

### Sketch: one vector editing mode, and the close/select clash made explicit

These come from [vector editing](https://www.sketch.com/docs/designing/vector-editing/):

- **Drawing:** Press V, then click to add points. "To close the path, click the first point again."
- **Entering and leaving:** double-click a shape, or press Return, to enter vector editing mode. Press Return to leave it, which is how you make an open path.
- **Selecting and inserting:** "click on any point on the shape to select it", and "You can insert a new point anywhere along a path by clicking on it". Holding ⇧ inserts at the exact midpoint.
- **Resuming:** "The next time you edit this shape, you can continue where you left off and place your next point after the last or before the first point."
- **Closing vs selecting:** "When you're editing an open path and click on the opposite end point, you can choose in Settings > Layers whether that closes the path or selects that point."

So one Sketch mode places (on an open path), selects (on a point) and inserts (on a segment). **Sketch is the only product found that exposes the close-vs-select conflict as a user setting.**

**How the conflict is resolved in option 2 (our inference, from the products above):**

- **Hit priority** is point first, then segment within tolerance, then empty canvas.
- **The selection scopes it:** auto add/delete applies only to the selected path in Illustrator, and only inside vector edit mode in Figma and Sketch.
- **A hover cursor previews the outcome** on desktop: Illustrator's + / − and close-circle, Figma's close-circle.
- **An escape hatch:** Shift, or a preference.

Touch has no hover. Illustrator on iPad keeps the design anyway and doesn't document the tolerance.

## 3. Quasi-modes and on-screen modifiers

| Product | Held key or gesture | Effect while drawing |
|---|---|---|
| Illustrator desktop | Ctrl/Cmd | last-used selection tool, used both to edit mid-draw and to Ctrl-click away and end an open path ([shortcuts](https://helpx.adobe.com/illustrator/using/default-keyboard-shortcuts.html), [Pen](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/draw-shapes/draw-line-segments-with-the-pen-tool.html)) |
| Illustrator desktop | Shift over a selected path | suppress auto add/delete ([source](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/turn-off-automatic-addition-or-deletion-of-anchor-points.html)) |
| Illustrator iPad | touch shortcut circle, held or locked | primary or secondary alternate behaviour ([source](https://helpx.adobe.com/illustrator/ipad/get-started/shortcuts-and-gestures/touch-shortcuts-gestures.html)) |
| Affinity desktop | Cmd/Ctrl | "temporarily activates the Node Tool". Esc completes the curve without closing ([draw curves](https://affinity.help/designer2/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)) |
| Affinity iPad | on-screen modifiers for the Pen: "Constrain", "Node Tool", "Ignore Snapping" | same as the keys ([on-screen modifiers](https://affinity.help/designeripad/en-US.lproj/pages/Workspace/onscreenModifiers.html)) |
| Affinity iPad | 2-finger hold + drag | "drag an existing node to reposition it" |
| Affinity iPad | 3-finger hold | "adjust segments, nodes and control handles" (edit while drawing) |
| Affinity iPad | 4-finger hold | "repositions the last placed active node" ([source](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)) |
| Inkscape | Space | Selector, temporarily ([keys](https://inkscape.org/doc/keys.html)) |
| Excalidraw | Alt+click in the line editor | add a new point at the end. The hint says "hold Alt and click to add new points" ([en.json](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/locales/en.json), [HintViewer.tsx](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/HintViewer.tsx), [linearElementEditor.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/linearElementEditor.ts)) |
| OpenLayers Modify | Alt+click | delete a vertex (the default `deleteCondition`) ([Modify API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Modify-Modify.html)) |

**Touch, pros and cons (our inference):**

- **Pros:**
  - Keeps one primary tool.
  - Lets an experienced user edit mid-shape without leaving the drawing session.
- **Cons:**
  - Needs a second hand or an on-screen button.
  - Undiscoverable without hints.
  - Multi-finger holds collide with pinch-zoom and two- and three-finger undo/redo.
  - Illustrator's lock mode shows that on touch, a quasi-mode tends to collapse back into a mode.

## 4. Dedicated insert handles (midpoint markers)

| Product | Insert affordance | When visible |
|---|---|---|
| Mapbox GL Draw | midpoint marker; a press converts it to a vertex and drags it | `direct_select` only ([direct_select.js](https://github.com/mapbox/mapbox-gl-draw/blob/main/src/modes/direct_select.js)) |
| Leaflet.draw | semi-transparent middle marker; drag or click inserts | edit mode only ([Edit.Poly.js](https://github.com/Leaflet/Leaflet.draw/blob/master/src/edit/handler/Edit.Poly.js)) |
| Terra Draw | `coordinates.midpoints` flag | select mode ([modes guide](https://github.com/JamesLMilner/terra-draw/blob/main/guides/4.MODES.md)) |
| tldraw | `create` handles: "the line shape uses `create` handles to let users add points between vertices" | when the line is selected ([handles](https://tldraw.dev/sdk-features/handles)) |
| Excalidraw | segment midpoint knobs | in the line editor for lines of 3+ points |

**Excalidraw's code shows two details that matter on a zoomable canvas** ([linearElementEditor.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/linearElementEditor.ts)):

- **The midpoint hit radius stays constant on screen:** `(POINT_HANDLE_SIZE + 1) / zoom`, with `POINT_HANDLE_SIZE = 10`.
- **A midpoint is hidden when its segment is shorter than 4 × the handle size on screen** (`distance * zoom < POINT_HANDLE_SIZE * 4`). Zooming in brings it back.
- **A vertex hit wins over a midpoint hit:** `getSegmentMidpointHitCoords` returns null when a point is under the cursor.

**Ending and resuming:** midpoint handles change neither. They're a disambiguation technique layered onto option 1 or 2.

**Touch (our inference):**

- **Pros:**
  - The best fit for a finger, because insert has its own large target.
  - Tapping *near* a segment can still mean "place".
  - It works without modifiers.
- **Cons:**
  - Clutter.
  - Only one insert location per segment. The carver drags the new point where it belongs, which is fine for straight segments.
  - The handles must be hidden on short segments, or they swallow taps meant for vertices.

## 5. Running the interactions side by side: OpenLayers

OpenLayers has no modes. Draw, Modify and Snap are independent interactions, and the official example adds all three to the map together ([draw and modify features](https://openlayers.org/en/latest/examples/draw-and-modify-features.html)).

**Draw** ([Draw API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Draw-Draw.html), [Draw.js](https://github.com/openlayers/openlayers/blob/main/src/ol/interaction/Draw.js)):

- **Finishing:**
  - A polygon finishes when a click lands within `snapTolerance` of the ring's **first or last** vertex. The default is 12 px, measured in screen pixels.
  - A line string finishes only on its last vertex.
  - There's no separate double-click handler. A double-click finishes because its second click lands on the last vertex.
- **Click vs drag:** a press that moves more than `clickTolerance` (6 px) before release doesn't add a point, so one-finger drags pan the map.
- **Multi-touch:**
  - sketch updates run only when `getPointerCount() < 2`
  - drawing finalizes only when the pointer count is back to 0
- **Moving the last vertex:** a long press (`dragVertexDelay`, 500 ms) lets you drag the current vertex.
- **No keyboard handling.** The host app calls `finishDrawing()`, `abortDrawing()` and `removeLastPoint()`. `extend(feature)` resumes drawing from an existing geometry.
- **Doesn't block other interactions:** Draw sets `stopDown = FALSE`, so it never stops a pointer-down from reaching the others.

**Modify** ([Modify API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Modify-Modify.html), [Modify.js](https://github.com/openlayers/openlayers/blob/main/src/ol/interaction/Modify.js)):

- **Hit area:** `pixelTolerance` is 10 px. The candidate search is in map units scaled by resolution, but the final test is in pixels.
- **On a vertex:** pointer-down drags it.
- **On a segment interior:** **pointer-down inserts a vertex immediately** (`insertVertexCondition` defaults to `always`) and drags it.
- **Deleting:** `deleteCondition` defaults to Alt+single-click.

**Snap:** its `pixelTolerance` is also 10 px, with vertex and edge snapping on ([Snap API](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Snap-Snap.html)). The map hands events to interactions starting with the last one added ([Map.js](https://github.com/openlayers/openlayers/blob/main/src/ol/Map.js)).

**(our inference, from the source, not tested)** With Draw and Modify both active, a short tap on an existing segment while drawing would do two things:

1. Modify inserts a vertex on pointer-down.
2. Draw adds a sketch point on pointer-up, because the pointer barely moved.

That's the clash in its purest form. Composition only works when the app turns one interaction off, for example deactivating Modify while a sketch is in progress.

## 6. Indirect placement: crosshair and button

These come from [QField: digitize](https://docs.qfield.org/how-to/data-collection/digitize/), plus Google Maps' Measure distance, covered in the earlier note:

- **How it works:** the carver positions the crosshair by panning, and a button commits the point.
- **Taps never place,** so they're free to mean select or edit.
- **(our inference)** It removes the place/insert ambiguity entirely, at the cost of two actions per point. QField keeps an opt-in "tap to place" for people who want it.

## Hit-testing and zoom

Every value found is in **screen pixels**, so on-screen hit areas stay the same size at any zoom:

| Product | Value |
|---|---|
| Illustrator | 3 px anchor tolerance |
| Mapbox GL Draw | 2 px click / **25 px touch** |
| OpenLayers | 12 px finish snap, 10 px Modify and Snap, 6 px click-vs-drag |
| Terra Draw | 40 px pointer distance |
| Leaflet.draw | 10 px touch finish, 20×20 touch icons |
| Excalidraw | 11 px ÷ zoom (constant on screen) |
| QField / QGIS snapping | 20 px recommended |
| Geoman (Leaflet) | `snapDistance` 20, no unit given ([Geoman draw mode](https://geoman.io/docs/leaflet/modes/draw-mode)) |

**Zoom figures in the guidance as the user's precision tool,** not as something that scales the targets:

- Inkscape notes that nudges by "pixel" depend on zoom: "Zoom in for finer movement" ([keys](https://inkscape.org/doc/keys.html)).
- Excalidraw hides insert handles until you zoom in far enough.

This matches the earlier note's advice not to scale hit areas with zoom.

## Surprises, and corrections to the earlier note

1. **"Apps avoid the clash with separate pen and edit modes" is only true of the touch-first apps and the map libraries.** Illustrator's Pen inserts on a tap on a selected path, on desktop and on iPad. Sketch places, selects and inserts in one mode. Figma inserts with its Pen inside vector edit mode. They rely on hit priority, scoping to the selection, hover cursors, and a Shift or preference override.
2. **The earlier note filed Illustrator on iPad's "tap the path to add a point" under editing.** The help page lists it under the **Pen tool**.
3. **Escape means opposite things.** Affinity and Linearity use Esc to *finish* an open shape, Figma to deselect and leave the shape open, and Inkscape and Mapbox GL Draw to *cancel*, discarding the shape in progress.
4. **Mapbox GL Draw and OpenLayers finish a polygon on the last vertex as well as the first.** Figma closes on *any* point.
5. **Sketch makes "click the opposite endpoint: close or select?" a setting.** It's the only product that admits the conflict in its UI.
6. **Leaflet.draw's edit mode deletes a vertex on a single click.** It's a hazard on touch.
7. **Mapbox GL Draw's touch hit area is 12.5× its mouse one** (25 px vs 2 px). It's the only library found with separate values.
8. **Polygon resume is rare.** Mapbox only resumes line strings. Sketch, Affinity, Linearity and OpenLayers (`extend`) support it.

## What this suggests for #11 and #14 (our inference)

- **A carve area is always closed, and v1 only places corner points.** So the riskiest clash is "tap near a segment while drawing". Midpoint insert handles (option 4) settle it without modes or modifiers, which suits a phone. Show them only on the selected shape, and only on segments long enough on screen. Hide them on the shape being drawn.
- **Use an implicit drawing session** (Mapbox's `draw_polygon` and Inkscape's red segment are the model). While a shape is open, a tap on empty canvas adds a point, a tap on the first point closes, and a tap on the last point or an explicit **Done** ends the shape open. With no open shape, a tap on a point or shape selects it, and a tap on empty canvas starts a new shape.
  - **When does a tap on an *existing* point while drawing mean "select" instead of "add"?** Hit priority (point, then midpoint handle, then empty canvas) answers most of it.
  - **The last-vertex double-tap**, found in Mapbox and OpenLayers, is cheap to support.
- **Resume:** select an open shape's end point, then tap empty canvas to continue. Sketch and Linearity do this. It avoids a separate mode.
- **Esc on desktop:** pick one meaning and label it, since apps disagree. For always-closed carve areas, "end the shape open" with undo is safer than "discard".
- **Don't copy:** Leaflet.draw's tap-to-delete, or multi-finger modifier holds, which collide with pinch, pan and two- or three-finger undo/redo.
- **Prototype variants worth A/B-ing in #14:**
  - (a) the session above, with midpoint handles
  - (b) an explicit **Draw / Edit** toggle, the Mapbox and Linearity way
  - (c) the reticle-plus-**Add** variant from the earlier note
