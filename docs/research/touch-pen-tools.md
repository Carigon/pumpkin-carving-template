# Touch pen tools: placing points precisely with a finger

Research for [#5](https://github.com/Carigon/pumpkin-carving-template/issues/5), done on 2026-10-23, on the map [#4 Hand-tracing a photo into a design](https://github.com/Carigon/pumpkin-carving-template/issues/4). It asks how touch-first vector editors let someone place and adjust points precisely with a finger, which patterns carvers would expect, and what Apple and Google say about precise touch input. The prototype ticket [#14 Placing and adjusting points on a phone](https://github.com/Carigon/pumpkin-carving-template/issues/14) builds on it.

Sources are the vendors' own help pages and platform guidelines. Where a page couldn't be fetched directly, the note says so. Statements marked **(our inference)** are reasoning, not something a source says.

## Short answer

- **Tap places a corner point.** Every editor surveyed does this, and dragging while placing pulls out curve handles. A v1 drag should not mean something that clashes with that.
- **Precision comes from zooming, snapping and editing afterwards.** None of the big vector editors documents a loupe or offset cursor for the pen tool. On iPad they rely on Apple Pencil. Phones have no pencil, so the loupe comes from the OS text cursor and the fixed-reticle idea from Google Maps.
- **The conventions carvers will expect:**
  - tap the first point to close
  - tap a point to select it and drag it to move it
  - tap a segment to insert a point
  - delete with a button
  - pinch to zoom and two-finger drag to pan
  - two-finger tap to undo and three-finger tap to redo, plus visible buttons
- **Point hit areas should be about 44 pt (iOS) or 48 dp (Android) across, even when the dot is drawn much smaller.**

## The apps, and how much phone prior art there is

The ticket named six apps. Only some of them do vector point editing by finger on a phone:

| App | On a phone? | Point editing by finger? |
|---|---|---|
| Linearity Curve (was Vectornator) | Yes. The vendor lists Mac, iPad and iPhone ([Linearity](https://linearity.io/curve/curve-backup/)), and its gesture guide mentions "iPad or iPhone" ([canvas gestures](https://www.linearity.io/academy/curve/ipad/user-guide/shortcuts-and-gestures/canvas-gestures/)). | Yes: a full pen tool and node tool. The user guide is written for iPad. |
| Affinity Designer 2 | No, iPad only | Yes, but much of it assumes Apple Pencil (see below) |
| Adobe Illustrator | No, iPad only | Yes, through an on-screen "touch shortcut" modifier |
| Procreate / Procreate Pocket | Pocket runs on iPhone | It's a raster app, but its polygon selection is a tap-to-place point tool with closing |
| Concepts | iPhone and Android | Vector strokes, edited with Nudge and Select rather than a node pen tool |
| Figma | Mobile app | No. Figma support said in January 2024 that design files can't be edited in the mobile app, only viewed, commented on and presented ([Figma forum](https://forum.figma.com/t/why-cant-i-edit-my-figma-files-in-mobile-app/62244)). |
| Inkscape | No official Android app. A 2019 thread says a native one "would amount to a rewrite" and that the workarounds run a Linux sandbox ([F-Droid forum](https://forum.f-droid.org/t/inkscape-for-android/6419)). | Only third-party ports that run the desktop build |

**So there's little prior art for finger-only, phone-sized point editing.** The mature tools are tablet apps, and the tablet apps lean on a stylus. Affinity's iPad help even has a setting that limits finger touches to zooming, panning and rotating, so that editing is done only with Apple Pencil ([Affinity Photo 2 for iPad: Using an Apple Pencil](https://affinity.help/photo2ipad/English.lproj/pages/Extras/applePencil.html)). V1 called it "Touch for gestures only" ([Affinity Designer for iPad: Touch gestures](https://affinity.help/designeripad/en-US.lproj/pages/GetStarted/gestures.html)). To fill the gap, two patterns come from outside vector editing: the OS text-cursor magnifier and Google Maps' measuring tool.

## Patterns

### 1. Placing a point: tap vs drag

- **Linearity Curve:** tapping adds a node, and repeated taps make straight paths with sharp corners. "Tap and drag your finger (or Pencil) on the canvas to add a corner node" with handles, which makes a curve ([Linearity: drawing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/drawing-tools/)).
- **Affinity Designer 2 for iPad:** the Pen Tool has these modes ([Affinity: draw lines and shapes](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)):
  - **Pen:** drag to create each node, which sets its handles.
  - **Smart:** tap repeatedly and the app fits a curve without handles.
  - **Polygon:** tap repeatedly for straight segments with sharp nodes.
  - **Line:** draw a single segment.
- **Procreate Pocket:** polygon selection places corner nodes by tapping, and each one connects to the previous with a straight dashed line ([Procreate Pocket: Freehand selection](https://help.procreate.com/pocket/handbook/selections/selections-freehand)).

**What carvers will expect:** tap means a straight corner point. In the vector apps, dragging while placing means pulling out curve handles. **(our inference)** If v1 uses press-and-drag to fine-tune where a new point lands, a later curve gesture can't also be drag-to-place. Curves would have to arrive another way, for example by converting a placed point (see pattern 5) or a Smart-style mode.

**No hover on a finger.** Affinity's Rubber Band Mode previews the next segment before you place a node, but it needs Apple Pencil hover or a trackpad ([Affinity: draw lines and shapes](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)). **(our inference)** On a phone, the only time a preview can show is while the finger is down. That argues for touch down → show where the point will go → drag to adjust → lift to commit.

### 2. Precision aids: magnifier, reticle, offset cursor

**Magnifier (loupe).** This is the OS-level answer to a finger covering its own target.

- **iPhone:** "Touch and hold to magnify the insertion point, then drag it." iOS can also turn the keyboard into a trackpad by holding the Space bar, which moves the cursor indirectly ([Apple: Select, edit, and move text](https://support.apple.com/guide/iphone/select-edit-and-move-text-iph1a9cae52c/ios)).
- **Android:** ships a Magnifier widget whose APIs "aren't tied to text". The pane "appears above the center point of the content being copied", and the guide's example follows a finger over an image view ([Android: Magnifier](https://developer.android.com/develop/ui/views/text-and-emoji/magnifier)).
- **On the web:** neither of these is available. We'd draw our own loupe, for example a canvas showing the photo and path zoomed in around the touch point, placed above the finger.

**Fixed reticle, move the content.** Google Maps' Measure distance tool on Android doesn't place points under the finger. You "move the map" until the black circle sits on the next spot, then tap **Add point**. **Undo** removes the last point and **More → Clear** removes them all ([Google Maps Help: Measure distance](https://support.google.com/maps/answer/1628031?co=GENIE.Platform%3DAndroid)).

- **Pros:** the finger never covers the target, and it's easy one-handed.
- **Con:** each point takes two actions.

Millions of phone users already know it.

**Offset cursor** (a cursor drawn a fixed distance from the finger). I found it only in small drawing apps' store listings: Draw Companion, Draw XP and Picotap. No help page of a major vector editor documents it, so carvers won't expect it. The listings are sales copy, not docs, so this is weak evidence either way.

**Zoom and snapping are the main precision tools in the big apps:**

- Concepts has a Precision menu with "Grid, Snap, Measurement and Shape Guides" ([Concepts: gestures](https://concepts.app/en/ios/manual/gestures)).
- Linearity has Snap to Grid, and you can hold a finger on the canvas to constrain a path to horizontal or vertical ([Linearity: drawing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/drawing-tools/)).
- Affinity snaps to earlier curves' nodes and lets you reposition the last placed node with a four-finger hold ([Affinity: draw lines and shapes](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)).

**Fine control by moving away.** A Procreate Pocket slider adjusts in finer steps when you drag your finger away from it: "The further away from the slider you finger gets, the finer the control" ([Procreate Pocket: gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)). **(our inference)** This could suit a selected point: a drag that starts away from the point moves it at a reduced ratio.

### 3. Zooming and panning while placing

Two fingers move the view and one finger uses the tool, in every app surveyed:

- **Linearity:** two-finger drag pans "without moving any elements by accident", pinch zooms, and two-finger spin rotates ([Linearity: canvas gestures](https://www.linearity.io/academy/curve/ipad/user-guide/shortcuts-and-gestures/canvas-gestures/)).
- **Concepts:** the same gestures ([Concepts: gestures](https://concepts.app/en/ios/manual/gestures)).
- **Procreate Pocket:** pinch to zoom, plus a quick pinch that fits the canvas to the screen and a reverse quick pinch that goes back ([Procreate Pocket: gestures](https://help.procreate.com/pocket/handbook/interface-gestures/gestures)).
- **Procreate Pocket selection:** you can zoom, pan and rotate while a polygon selection is in progress, and lifting the finger doesn't close it ([Procreate Pocket: Freehand selection](https://help.procreate.com/pocket/handbook/selections/selections-freehand)).

**On the web.** `touch-action: none` on the drawing surface stops the browser's own pan and zoom. Otherwise an app using Pointer Events gets `pointercancel` as soon as the browser takes over a gesture ([MDN: touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)).

- **Safari on iOS:** supports `touch-action: none` from iOS 13, and only `auto` and `manipulation` before that (MDN browser-compat-data 6.0.0).
- **In this repo:** the app already uses `touch-action: none` and pointer capture for the Blueprint view and the crop canvas (`src/ui/style.css`, `src/ui/blueprintViewSvg.ts`, `src/ui/tracePanel.ts`).

**(our inference)** A pinch starts with one finger down, so a one-finger placement can't commit until the gesture is known to be one-finger. Commit on lift, and cancel the pending point if a second pointer arrives.

### 4. Closing a shape

- **Tap the starting point:**
  - Affinity: "tap the starting node" to join it to the final node ([Affinity: draw lines and shapes](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)).
  - Procreate Pocket: the origin is drawn as a grey circle, and tapping it closes ([Procreate Pocket: Freehand selection](https://help.procreate.com/pocket/handbook/selections/selections-freehand)).
  - Linearity: placing a point on the other endpoint closes a path you're continuing ([Linearity: drawing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/drawing-tools/)).
- **An explicit command:** Linearity has a Close Path option in the Style tab, and Affinity's Node Tool has a Close button ([Linearity](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/drawing-tools/), [Affinity](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)).
- **Finishing without closing:** double-tap the last node in both Affinity and Linearity, or use a Finish Path or Deselect button.

**For us:** carve areas are always closed. **(our inference)** So "finish" and "close" can be the same action. Tapping the marked first point and a visible **Close shape** button cover both habits.

### 5. Selecting, moving, inserting, deleting, converting

Each app has a separate edit tool (Node Tool or Direct Selection) next to the pen:

- **Select and move:** in Linearity's Node Tool, "To select one single point, tap on it", then drag it. Dragging a box selects several points ([Linearity: editing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/editing-tools/)).
- **Insert:** "Tap any space between two nodes directly on the vector path to add a new point" ([Linearity: editing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/editing-tools/)). Illustrator on iPad also adds points by tapping the path. The [Adobe help page](https://helpx.adobe.com/illustrator/ipad/draw-and-edit-objects/draw-edit-on-ipad.html) refused automated fetches, so this comes from its search-indexed text.
- **Delete:** none of the help pages shows a delete gesture. Linearity's Inspector has a Delete command for nodes ([Linearity: editing tools](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/editing-tools/)).
- **Convert corner and smooth:** double-tap a node, in both Illustrator on iPad ("Double-tap on points to convert points from corners to curves and vice versa") and Linearity.
- **Editing while drawing:** Affinity uses held multi-finger modifiers. Hold three fingers to edit nodes and handles mid-draw, and hold two fingers and drag to move an existing node ([Affinity: draw lines and shapes](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html)). Affinity's on-screen modifiers and Illustrator's touch shortcut circle exist because a touch screen has no Shift or Alt ([Affinity: on-screen modifiers](https://affinity.help/designeripad/en-US.lproj/pages/Workspace/onscreenModifiers.html)).

**(our inference)** With straight segments only, one mode could do it all:

- tap empty space to add a point
- tap or drag an existing point to select or move it
- tap a segment to insert a point

But "tap near a segment to add the next point" and "tap a segment to insert" collide. The apps avoid that with a pen/edit mode split. The prototype should try both:

- **A mode toggle.**
- **Insert handles:** insert only from a visible handle at each segment's midpoint, much like this app's ghost ring.

### 6. Undo

- **Two-finger tap undoes and three-finger tap redoes** in Procreate Pocket, Linearity and Concepts. In Procreate Pocket, holding the fingers down repeats the undo or redo ([Procreate Pocket](https://help.procreate.com/pocket/handbook/interface-gestures/gestures), [Linearity](https://www.linearity.io/academy/curve/ipad/user-guide/shortcuts-and-gestures/canvas-gestures/), [Concepts](https://concepts.app/en/ios/manual/gestures)).
- **On-screen buttons too:** Linearity has arrows in its Widget Area, and Concepts has buttons on its Tool Wheel.
- **Apple's system gestures** are a three-finger swipe or a shake ([HIG: Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)). The drawing apps use the tap instead.
- **Apple's rule for custom gestures:** they shouldn't be "the only way to perform an important action".

So: visible Undo and Redo buttons, with two- and three-finger taps as shortcuts. Google Maps' measuring tool gets by with just an Undo button.

### 7. Touch target sizes

| Source | Size | Spacing |
|---|---|---|
| Apple HIG, iOS ([Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)) | 44×44 pt default, 28×28 pt minimum | ~12 pt around bezelled elements, ~24 pt around elements without a bezel |
| Android / Material ([Touch target size](https://support.google.com/accessibility/android/answer/7101858)) | 48×48 dp (about 9 mm) | 8 dp or more |
| WCAG 2.2 SC 2.5.8, AA ([Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)) | 24×24 CSS px, or 24 px spacing | n/a |

Android's guidance says a 24 dp icon can sit inside a 48 dp touch target. **(our inference)** For points on the canvas:

- **Draw them small and hit them big:** a dot of about 8–12 CSS px with a hit radius of about 22–24 CSS px.
- **When hit areas overlap,** pick the nearest point.
- **Make the start point's hit area at least as big as the others,** and draw it distinctly, since closing depends on hitting it.
- **Don't scale the hit areas with zoom.** Zooming in is how the carver separates crowded points.

WCAG's essential exception, for example map pins whose spacing reflects real locations, covers points whose positions are the content.

### 8. Platform guidance on custom gestures

Apple's HIG ([Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)) says:

- "Add custom gestures only when necessary", naming drawing apps as a fair case.
- Custom gestures should be discoverable and easy to learn.
- They should never be the only way to do something important.
- Avoid conflicting with system gestures.
- "Handle gestures as responsively as possible," with feedback that shows the extent of movement needed.

**(our inference)** In Safari, edge swipes navigate back, so placing points right at the screen edges is unreliable. Leave a margin, or let the carver pan the photo away from the edge.

## Recommendation for the prototype (#14)

Build the **direct** interaction as the default, with the **reticle** as a switchable variant. Skip the offset cursor.

**Direct mode, one finger:**

- **Tap empty space** to place a straight corner point at the finger. It commits on lift and is cancelled if a second finger lands.
- **Touch and hold, then drag** to show a loupe above the finger with a crosshair and a preview of the segment. Lift to commit. This is the iOS insertion-point behaviour.
- **Drag an existing point** to move it, with the same loupe.
- **Tap the start point** to close the shape. It's drawn distinctly and has a generous hit area.
- **Tap a point** to select it. A **Delete point** button acts on the selection.
- **Insert** from a midpoint handle on each segment, or from a tap on the segment in an Edit mode. Try both.

**Two fingers:**

- pinch to zoom and drag to pan
- quick pinch to fit, if it's cheap
- two-finger tap to undo, three-finger tap to redo

**On screen:** Undo, Redo, Close shape and Delete point buttons, at least 44 pt.

**Hit areas:** about a 44 CSS px circle per point, not scaled with zoom.

**Reticle variant:** a fixed crosshair at the screen centre, one-finger drag pans the photo, and an **Add point** button places the point, as in Google Maps' Measure distance. It's cheap to add, and it answers whether one-handed carvers prefer it.

**Don't let drag-to-place mean anything else in v1.** Keep press-and-drag as "adjust before committing", not "pull out handles". When curves come, convert a placed point with a double-tap (Linearity, Illustrator) and drag its handles afterwards.

## Things that may affect other tickets

- **#10 Path model:**
  - Every app treats corner and smooth as a type on each point, switched after placing.
  - Affinity and Linearity use more types: Single, Mirrored, Asymmetrical and Disconnected.
  - Store a point type, even though v1 only writes "corner".
  - Keep "closed" as a property of the path.
- **#11 v1 editing operations:** the standard set is:
  - place
  - close by tapping the start point
  - select and move
  - insert on a segment
  - delete via a button
  - undo and redo

  Multi-select (box select) and continuing an open path also exist, but neither seems needed for always-closed carve areas.
- **#6 Path-editing library:** the touch layer is ours either way. The loupe, hit slop, two-finger tap undo, cancelling a pending point when a pinch starts and the reticle mode aren't in the apps' docs as library features. **(our inference)** A library would mostly save geometry and rendering work, not touch handling.
- **#14 Prototype:**
  - The surprise is how little phone-specific prior art exists. The big vector editors are iPad and Pencil first, so the prototype should borrow from the OS text loupe and Google Maps, not from Procreate-style apps.
  - Test the start-point hit area and the second-finger cancel early: those are the likeliest sources of stray points.
