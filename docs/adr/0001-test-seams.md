# 1. The template builder and the hand-trace editor are the test seams; thin helpers around them may have direct tests

Status: accepted

## Context

The spec (issue #1 in the archived `Carigon/sphereprojection`) names one test seam: the template builder (`buildTemplate`). Every core geometry test goes
through it and checks only its output, so the mesh, the ARAP solver, the ellipsoid fit, the cut-out
edge and slit placement can be rewritten freely. The spec also lists PDF layout, the UI and tracing as
"not tested automatically".

While building the layers around the core, a few small pure helpers got direct unit tests anyway:
PDF page layout and tiling (`test/pdf-layout.test.ts`), raster preparation before tracing
(`test/raster-prep.test.ts`), settings storage (`test/settings.test.ts`), the calibration grid's PDF
export (`test/calibration-grid.test.ts`), the unit-switching length fields
(`test/length-fields.test.ts`), the step model `steps` (`test/steps.test.ts`, `test/step-badges.test.ts`) and
the Paper view's geometry `paperView` (`test/paper-view.test.ts`), the Blueprint view's geometry `blueprintView`
(`test/blueprint-view.test.ts`) and the ring-edit rules that drags and typed values share (`dragRing`,
`dragHeight`, `dragBall`, `sortRings`, `canInsert`, `insertRing`, `deleteRing`, `nudgeLength` in `src/ringEdits.ts`: `test/ring-edits.test.ts`; the Measure form's typed
values, `typeRingHeight`, `typeCircumference` and `typeHeight`: `test/typed-edits.test.ts`; and which of its rows a
measurement warning marks, `placeMeasureWarnings`: `test/measure-warnings.test.ts`), and hand-tracing's gesture recognizer,
which turns pointer events into taps, double-taps, drags (saying when Alt was held), holds, pinches, multi-finger taps, Space- and middle-button pans, hovers and wheel turns (`createGestureRecognizer` in `src/handTrace`:
`test/gesture-recognizer.test.ts`), the record module, which keeps the loaded design and its work across reloads
(`createRecordKeeper`, `readRecord` and `writeRecord` in `src/designRecord.ts`, against an in-memory store:
`test/design-record.test.ts`), the hand-trace file's writer and reader with the SVG loader under it, which
reopen a downloaded hand-trace or load a changed one as an SVG design (`writeHandTraceFile`, `readHandTraceFile` and
`handTraceFileName` in `src/input/handTraceFile.ts`, and `readSvgDesign` in `src/input/svgDesign.ts`, in jsdom:
`test/hand-trace-file.test.ts`), the curve-keeping SVG reader behind Edit as hand-trace, which turns an SVG design
into a hand-trace's shapes on a page shaped to it (`readSvgHandTrace` in `src/input/svgHandTrace.ts`, in jsdom,
through the editor: `test/svg-hand-trace.test.ts`), and the cleanup frame, which squares up the part of a photo inside four dragged
corners (`cleanUp`, `moveCorner`, `turnFrame`, `rotateFrame`, `cornerAt`, `warpPhoto` and `exifFocal35Mm` in
`src/input/cleanupFrame.ts`: `test/cleanup-frame.test.ts`). They are cheap, fast, and have caught real mistakes (page tiling,
corrupt saved settings, unit drift).

Hand-tracing (the map Hand-tracing a photo into a design, issue #4 in `Carigon/pumpkin-carving-template`) adds a
path model, edit rules, live symmetry, curves, undo, points carried through photo cleanup, and the pointer and key
dispatch. That is not a thin helper: it is a second deep module whose internals (curve maths, reflection, hit tests)
should stay as free to change as the core's. Decided in Testing hand-tracing (issue #24). The editor lives in
`src/handTrace/` (`createHandTrace`), tested through its index in `test/hand-trace.test.ts` and, with random
sequences, `test/hand-trace-properties.test.ts`; outlines are compared by `test/outlines.ts`.

## Decision

- Core geometry is tested only through `buildTemplate`. No test imports from `src/core/` other than
  its public index. `fitProfile` (the profile alone, with no mesh, quick enough to refit during a drag) is part
  of that public index and is tested there: its profile and warnings match `buildTemplate`'s. So is `ringAt`
  (the circumference a new ring at a given height takes, read off the current fit): that `buildTemplate`'s shape
  doesn't change when such a ring is added, and that it blends the neighbouring rings when nothing fits. Where a
  new ring goes is the caller's choice. `createTemplateBuilder` (the same build, keeping the fitted surface between calls, plus the quick
  projection-only preview) is in the index too; its tests check it matches `buildTemplate` and when the mesh is reused.
  The Design warnings (crossings, floating pieces, carve areas under 5 mm on the skin) are core geometry, tested
  here with the position each warning carries in design coordinates.
- **The hand-trace editor** (`src/handTrace/`) is the second seam. Tests reach it only through its public index:
  commands (the pill's Close / End / Delete, Smooth / Corner, Symmetry, undo, Done, a cleanup change), gestures in
  screen coordinates with the current zoom and pan, and keys go in; what's drawn (shapes, points and handles, the
  selection, the pill, insert markers, the loupe), the `Design` and the stored record come out. Automatic handles,
  reflections and handles carried through a four-corner change are checked only through what's drawn and the
  `Design`. Like the core, it has no DOM and no packages, and imports the core only through its index; lint enforces
  both, and the test import rule.
- Outlines are compared as geometry (flattened paths within a tolerance, whatever their order, start point or
  direction), never as point lists or `d` text, through one shared test helper.
- Property-based tests (`fast-check`) are allowed at the seams, with a fixed seed and a run count that keeps the
  suite fast. At the hand-trace seam they run random command and gesture sequences and check invariants after each
  step; example tests stay the main tests.
- Thin, pure helpers in the layers around the core (input, PDF layout, settings, small UI helpers)
  may have direct unit tests at their own public functions, as long as those tests check behaviour
  you can see from outside the helper (page marks, stored values, field values) and not its internals.
  Hand-tracing's are the gesture recognizer (pointer events with timestamps in, gestures out), the cleanup frame
  (four corners, rotation and aspect in, the homography and output size out, plus the pixel warp on tiny synthetic
  images) and the record module (one validator shared by storage and the hand-trace file, with storage tested
  through a small in-memory interface). Each is added to the Context when it gains tests.
- Tests that read SVG text (the SVG loader, Edit as hand-trace, the hand-trace file) run in jsdom, set per file;
  every other test runs in Node.
- Rendering (pdf-lib drawing beyond "it produces a valid document"), the Three.js preview, Potrace
  itself and DOM wiring stay untested automatically, as do IndexedDB, the canvas that shrinks a photo, and drawing
  warning marks. The manual checks (the printed basketball grid; a hand-trace on a real phone and on a desktop) are
  listed in `docs/manual-checks.md`.

## Consequences

- The core and the hand-trace editor each keep one seam, so their internals stay free to change.
- The extra tests pin the public shape of a few small helpers (e.g. `layoutTemplatePdf`'s marks); a
  change to those shapes means updating those tests too.
- The hand-trace seam's inputs and outputs are pinned instead: a change to the commands, gestures or what's drawn
  means updating its tests.
- `jsdom` and `fast-check` become dev dependencies.
