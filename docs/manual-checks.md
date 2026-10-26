# Manual checks

`npm run check` covers the geometry, the hand-trace editor and the thin helpers around them. [ADR 0001](adr/0001-test-seams.md) lists what it leaves out: DOM wiring and the canvas's SVG drawing, the loupe's pixels, IndexedDB, the canvas that shrinks a photo, the worker plumbing, the tone filter, drawing the warning marks, Potrace, PDF drawing and the 3D preview. These checks cover them by doing what a carver does, on real devices.

Run them before a release that touches any of those, and after retuning a starting value (below). Each check says what to do and what to look for; anything that doesn't match is a bug.

## What you need

- A real phone (touch only) and a desktop with a mouse and keyboard. Use the deployed site, or `npm run dev -- --host` and open the address it prints on the phone.
- A face drawn in pencil on paper: two eyes (one with a pupil drawn inside), a nose and a mouth that crosses the middle. Photograph it at a slight angle, with the sheet lying a little crooked.
- A printer that prints at 100%, a ruler, tape, a basketball and a pumpkin.

## 1. The printed basketball grid

This checks the whole method on a shape you already know: the fitted shape, projection, flattening, slits and the PDF.

1. In the header, pick **test grid for a ball**.
2. In Measure, enter the basketball's circumference (about 29.5 in).
3. In Grid, keep the defaults (6 squares across, 125 mm seen from the front) or set your own.
4. In Template, pick Letter or A4 and **Download PDF**. Print it at 100% (Actual size).
5. Measure the check square: it's 10 cm both ways, or the print was scaled; reprint before going on.
6. Cut the template out along its edge and its slits, and tape it to the ball, centred on the side facing you.
7. Step back about 2 m and look at the grid from the front, level with its middle.

Look for:

- The squares look square and even from the front, out to the grid's edge.
- The paper lies on the ball without bunching; the slits open to let it spread.
- The info block reads "Calibration grid for a 29.5 in ball" (in your display units).

## 2. A hand-trace on a real phone

Trace the face from its photo, with Symmetry and curves, then reload mid-trace, download and reopen.

**Cleanup**

1. In Design, tap **SVG file or photo** and pick the photo. The Photo view opens in Cleanup, inside the viewport as on a desktop; it goes full screen only once you're past Cleanup with Hand-trace chosen.
2. Drag each frame corner onto a corner of the sheet. The loupe shows above your finger, or beside it near the top edge, with a crosshair on the corner.
3. Try **Turn**, **Rotate 90°**, each Sheet chip, Brightness and Contrast, then **Reset** and frame the sheet again.
4. Press **Start tracing**.

Look for: the Tracing method switch shows above Cleanup the whole time; Cleanup's Undo takes back each released corner, Turn, Rotate 90° or chip, one at a time, and Redo puts it back; the cleaned-up photo comes out squared up a moment after each corner is released; the Sheet chip preselected matches the sheet you photographed; Brightness and Contrast change only the photo behind the hand-trace, not what auto-trace finds.

**Tracing**

1. Pick **Hand-trace** under Tracing method. Turn **Symmetry** on; its button shows pressed.
2. Draw one eye off the axis: tap round it and tap the first point to close. Its reflection is drawn dashed while it's open and becomes the other eye when it closes.
3. Draw half the mouth: start on the symmetry axis, tap along one half and land on the axis again. It closes on its own into one whole mouth. A point dragged near the axis snaps onto it and shows it's snapped.
4. Draw the pupil inside the drawn eye. Turn Symmetry off and draw the nose.
5. Curves: double-tap a mouth point to make it smooth, drag one of its handles, drag a corner's stub to pull a handle out, and drag a handle back onto its point to remove it. Select a shape and tap an insert marker to add a point.
6. Hold still on empty space: after about 300 ms the loupe shows, and lifting places the point under your finger, not beside it. Pinch to zoom and pan; drag empty space to pan.
7. Tap with two fingers to undo and three to redo. Land a second finger during a drag: the drag is undone.
8. With a shape half drawn, reload the page.

Look for: after the reload you're back in Design in the Photo view, with the half-drawn shape still open, Symmetry still on, and nothing to undo. The phone layout keeps Undo and Redo top left, Symmetry and Clear top right and the pill at the bottom, none of them under your thumb while drawing.

**Warning marks**

1. With the pupil inside the eye, the pupil's piece is tinted on the canvas, and on its reflection too.
2. Draw a figure-eight: a small ring shows at the crossing.
3. In Placement, make the Width small until rings show round the smallest carve areas, then put it back.

Look for: the marks stay put during a drag and move after it; the Design panel and its step badge list the same warnings; nothing is marked on the auto-trace result or in the 3D view.

**Straighten, auto-trace and Done**

1. On the phone, Done, Straighten photo and Download SVG sit in the Design card, under the full-screen canvas. Pick **3D** in the view switcher over the canvas: the canvas leaves full screen and the Design card shows them. Pick **Photo** to go back to the canvas as you left it.
2. Press **Straighten photo**. The shapes stay drawn over the photo. Drag a frame corner: they follow it live, and an off-centre frame makes the reflections drift. Undo and Redo the re-frame with Cleanup's own buttons, then press Start tracing and Undo and Redo it again from the canvas.
3. Flip to **Auto-trace**: the status reads "Auto-tracing…" until it has traced the cleaned-up photo. Flip back to Hand-trace: your shapes are there. Flip to Auto-trace again, then **Edit as hand-trace**: the points land on the auto-trace result's outlines.
4. Undo back to your own shapes, and press **Done**. The tools hide, the canvas stops taking taps, and Design opens on 3D with the face on the pumpkin.

**Download and reopen**

1. Press **Download SVG**. The file is named `<photo name>-hand-trace.svg`.
2. Open it in another app (a browser or a file viewer): it shows the face as black carve areas, both eyes and the whole mouth drawn out.
3. Back in the app, load the downloaded file with **SVG file or photo**, and accept the prompt to discard the loaded work.

Look for: the status reads "Reopened your hand-trace."; the photo, its frame and tone, the shapes, Symmetry and Done come back; there's nothing to undo; placement is unchanged. The file stays a few MB at most even from a large phone photo, since the photo in it is shrunk to 2048 px on its long edge.

## 3. The same on a desktop

Run check 2 again with a mouse and keys, and look for these instead of the touch-only parts:

- The canvas sits inside the viewport beside the controls, with the same buttons over it; each button's tooltip shows its key.
- Hover highlights what a click would hit and sets the cursor; while drawing, a dashed edge follows the cursor from the last point and shows the axis snap.
- A click places or selects; a press and hold with no movement is just a click, with no loupe. A drag on empty space pans, and on the selected shape moves it. Space + drag and a middle-button drag pan from anywhere.
- The mouse wheel, a trackpad pinch and a two-finger scroll all zoom at the cursor. Right-click shows no menu over the canvas.
- A double-click switches Smooth / Corner. Alt + drag on a smooth point's handle makes it a corner and moves that handle alone.
- Keys work once the canvas is clicked: Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; Enter closes (or ends a shape under 3 points, or carries on from a selected open end); Escape cancels a drag, else ends the shape open, else clears the selection; Delete deletes the selection, and Backspace while drawing takes off the last point; S switches Smooth / Corner; M switches Symmetry; + − and 0 zoom.
- The arrows nudge the selected point, handle or shape 1 px (10 with Shift), and a run of nudges is one undo step.
- In Cleanup, frame corners drag without a loupe; a click selects one, and the arrows nudge it. With the frame or Cleanup's controls focused, Ctrl/Cmd+Z undoes a released change and Ctrl/Cmd+Shift+Z or Ctrl+Y redoes it.

## 4. Print and carve-check one design

On each device, take the traced face to Template and print it.

1. **Download PDF**, print at 100% and check the 10 cm square.
2. Tape the template on the pumpkin, transfer the outlines and carve.
3. Look at the carved pumpkin from the front.

Look for: the face looks like the drawing from the front, at the Width you set; the pupil fell out, as the floating-piece warning said it would; any area warned as under 5 mm was hard to cut.

## Starting values to tune on real devices

These are guesses from the spec, to be tuned once the checks above have been run on real phones. A value too small makes things hard to grab or aim; too big, and the wrong thing gets grabbed.

| Value | What it sets | Where |
|---|---|---|
| 22 px | Hit radius for points, handles, stubs and insert markers, whatever the zoom | `HIT_RADIUS_PX`, `src/handTrace/editor.ts` |
| 22 px | Axis snap, the same radius (let go at 1.5 times it) | `HIT_RADIUS_PX`, `SNAP_RELEASE`, `src/handTrace/editor.ts` |
| 22 px | Frame corner hit radius in Cleanup, the same radius | `HIT_RADIUS_PX`, `src/handTrace/editor.ts` |
| 48 px | Edges shorter than this, along the curve, show no insert marker | `MARKER_MIN_EDGE_PX`, `src/handTrace/editor.ts` |
| 40 px | How far a stub reaches out along its edge | `STUB_PX`, `src/handTrace/editor.ts` |
| 10 px | A handle dragged this close to its point is removed | `RETRACT_PX`, `src/handTrace/editor.ts` |
| 300 ms | Hold before the loupe shows | `HOLD_MS`, `src/handTrace/gestures.ts` |
| 300 ms, 22 px | Double-tap: second tap within this time and distance | `DOUBLE_TAP_MS`, `DOUBLE_TAP_PX`, `src/handTrace/gestures.ts` |
| 130 px, ×3 | The loupe's size and magnification over the current zoom | `LOUPE_PX`, `LOUPE_MAGNIFICATION`, `src/handTrace/editor.ts` |
| about 200 | Undo steps kept | `UNDO_LIMIT`, `src/handTrace/editor.ts` |
| 2,000 points | Above this, Edit as hand-trace warns that editing may be slow | `MANY_POINTS`, `src/ui/designPanel.ts` |

Things to watch for while tuning:

- **The axis snap on a small mouth.** At the fitted zoom, 22 px catches points near the middle of a small mouth, so they jump onto the axis. Zooming in avoids it; a smaller radius may be the fix.
- **Short handles at the fitted zoom.** Points and handles compete for a tap and the nearest wins. If a short handle can't be grabbed because its point keeps winning, the fallback is "handle wins over point": any handle within the hit radius beats a point (`pointOrHandleAt` in `src/handTrace/editor.ts`).
- **Slow editing.** Edit as hand-trace on an SVG design with well over 2,000 points, and on the auto-trace result of a busy photo: if dragging lags on a phone, move the hint's threshold to where it starts.
